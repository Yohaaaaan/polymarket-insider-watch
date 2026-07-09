import { db } from './database';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.ETHERSCAN_API_KEY;
const BASE_URL = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = '137';

export async function runClusterAnalysis() {
    console.log("Running cluster analysis sweep...");

    // Heuristics 4 & 5: Find wallets created at almost the same time,
    // that bet on the same market in the same direction, with similar amounts.
    
    // We compare pairs of trades on the exact same token outcome
    const query = `
        SELECT t1.wallet as w1, t2.wallet as w2, t1.market_id, t1.usdc_spent as val1, t2.usdc_spent as val2,
               w1_profile.first_tx_ts as ts1, w2_profile.first_tx_ts as ts2,
               w1_profile.funded_by as funded1, w2_profile.funded_by as funded2,
               w1_profile.fund_source_type as ftype1, w2_profile.fund_source_type as ftype2
        FROM trades t1
        JOIN trades t2 ON t1.market_id = t2.market_id AND t1.outcome = t2.outcome AND t1.wallet < t2.wallet
        JOIN wallets w1_profile ON t1.wallet = w1_profile.address
        JOIN wallets w2_profile ON t2.wallet = w2_profile.address
    `;
    
    const pairs = db.prepare(query).all() as any[];

    for (const p of pairs) {
        let confidence = 0;
        let reasons = [];

        // H1 & H2: Shared funding source
        // If it's a personal wallet (not a giant CEX/Bridge), confidence goes through the roof.
        if (p.funded1 && p.funded2 && p.funded1 === p.funded2) {
            if (p.ftype1 === 'wallet') {
                confidence += 90;
                reasons.push(`Shared personal funding source (${p.funded1.substring(0, 8)}...)`);
            } else {
                confidence += 20;
                reasons.push(`Both funded by the same service (${p.ftype1})`);
            }
        }

        // H4: Same creation window (48h = 172800s)
        if (p.ts1 && p.ts2 && Math.abs(p.ts1 - p.ts2) < 172800) {
            confidence += 40;
            reasons.push('Created within 48h of each other');
        }

        // H5: Similar amounts (variance < 15%)
        const maxVal = Math.max(p.val1, p.val2);
        const minVal = Math.min(p.val1, p.val2);
        const diffRatio = (maxVal - minVal) / maxVal;
        
        if (diffRatio < 0.15) {
            confidence += 35;
            reasons.push('Highly similar trade amounts (variance < 15%)');
        }

        if (confidence >= 75) {
            // Check if cluster already logged
            const existing = db.prepare('SELECT 1 FROM clusters WHERE wallet_a = ? AND wallet_b = ?').get(p.w1, p.w2);
            if (!existing) {
                try {
                    db.prepare(`
                        INSERT INTO clusters (wallet_a, wallet_b, reason, confidence, detected_ts)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(p.w1, p.w2, reasons.join(', '), confidence, Math.floor(Date.now() / 1000));
                    
                    console.log(`[CLUSTER DETECTED] ${p.w1} & ${p.w2} -> ${reasons.join(', ')}`);

                    // Dim D: Apply score to both wallets in the cluster
                    const clusterScore = confidence >= 90 ? 30 : 25;
                    applyClusterScore(p.w1, clusterScore);
                    applyClusterScore(p.w2, clusterScore);
                } catch (e) {
                    console.error('Cluster insert error', e); 
                }
            }
        }
    }

    // H3: Common gain destination analysis
    await runGainDestinationAnalysis();
}

function applyClusterScore(wallet: string, points: number) {
    const walletData = db.prepare('SELECT flags FROM wallets WHERE address = ?').get(wallet) as any;
    let flags: string[] = [];
    try { if (walletData?.flags) flags = JSON.parse(walletData.flags); } catch(e) {}

    if (!flags.includes('CLUSTER_MEMBER')) {
        flags.push('CLUSTER_MEMBER');
        try {
            db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + ?, flags = ? WHERE address = ?')
                .run(points, JSON.stringify(flags), wallet);
            console.log(`[CLUSTER SCORE] ${wallet} +${points} pts (CLUSTER_MEMBER)`);
        } catch(e) {}
    }
}

/**
 * H3: Common destination of the gains.
 * For all suspect wallets (score >= 35), check their outgoing USDC transfers.
 * If multiple wallets send gains to the same third-party address, cluster them.
 */
async function runGainDestinationAnalysis() {
    if (!API_KEY) return;

    const suspectWallets = db.prepare('SELECT address FROM wallets WHERE cumulative_score >= 35').all() as any[];
    if (suspectWallets.length < 2) return;

    // Map: destination address -> list of suspect wallets that sent USDC there
    const destinationMap = new Map<string, string[]>();

    for (const w of suspectWallets) {
        try {
            // Fetch ERC-20 token transfers for this wallet (USDC outgoing)
            const url = `${BASE_URL}?chainid=${CHAIN_ID}&module=account&action=tokentx&contractaddress=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174&address=${w.address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc&apikey=${API_KEY}`;
            const response = await axios.get(url);
            
            if (response.data?.status === '1' && Array.isArray(response.data.result)) {
                for (const tx of response.data.result) {
                    // Outgoing USDC transfers from this wallet
                    if (tx.from?.toLowerCase() === w.address.toLowerCase()) {
                        const dest = tx.to?.toLowerCase();
                        if (dest && dest !== w.address.toLowerCase()) {
                            const existing = destinationMap.get(dest) || [];
                            if (!existing.includes(w.address)) {
                                existing.push(w.address);
                            }
                            destinationMap.set(dest, existing);
                        }
                    }
                }
            }

            // Rate limit: small delay between calls
            await new Promise(r => setTimeout(r, 250));
        } catch (e) {
            // Skip this wallet on error
        }
    }

    // Find destinations that received from >= 2 suspect wallets
    for (const [dest, senders] of destinationMap.entries()) {
        if (senders.length >= 2) {
            console.log(`[CLUSTER H3] ${senders.length} suspect wallets sent gains to ${dest}`);
            
            // Create cluster entries for each pair
            for (let i = 0; i < senders.length; i++) {
                for (let j = i + 1; j < senders.length; j++) {
                    const wa = senders[i] < senders[j] ? senders[i] : senders[j];
                    const wb = senders[i] < senders[j] ? senders[j] : senders[i];
                    
                    const existing = db.prepare('SELECT 1 FROM clusters WHERE wallet_a = ? AND wallet_b = ?').get(wa, wb);
                    if (!existing) {
                        const reason = `Common gain destination (${dest.substring(0, 8)}...)`;
                        try {
                            db.prepare('INSERT INTO clusters (wallet_a, wallet_b, reason, confidence, detected_ts) VALUES (?, ?, ?, ?, ?)')
                                .run(wa, wb, reason, 85, Math.floor(Date.now() / 1000));
                            applyClusterScore(wa, 30);
                            applyClusterScore(wb, 30);
                        } catch(e) {}
                    }
                }
            }
        }
    }
}
