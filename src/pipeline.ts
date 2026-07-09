import { TrackedToken } from './polymarketAPI';
import { getWalletProfile, getTokenBalance } from './polygonscanAPI';
import { calculateImmediateScore } from './scoringEngine';
import { db } from './database';
import { formatUnits } from 'ethers';
import { sendTelegramAlert } from './telegramBot';

let totalTrades = 0;
let detectedHighScores = 0;
let lastSuspiciousWallet = 'None';

export function getPipelineStats() {
    return { totalTrades, detectedHighScores, lastSuspiciousWallet };
}

export async function processTrade(tradeData: any) {
    totalTrades++;
    // 1. Convert condition token ID hex back to decimal string to match Gamma API
    let tokenIdDecimal: string;
    try {
        tokenIdDecimal = BigInt(tradeData.makerAssetId).toString();
    } catch {
        tokenIdDecimal = tradeData.makerAssetId;
    }

    // Lookup token in DB instead of RAM Map
    const marketInfo = db.prepare('SELECT * FROM monitored_markets WHERE token_id = ?').get(tokenIdDecimal) as any;
    if (!marketInfo) {
        // Not a monitored political market
        return;
    }

    // USDC has 6 decimals, Polymarket CTF Tokens also 6 decimals.
    const usdcSpentStr = formatUnits(tradeData.takerAmountFilled, 6);
    const usdcSpent = parseFloat(usdcSpentStr);

    const tokensReceivedStr = formatUnits(tradeData.makerAmountFilled, 6);
    const tokensReceived = parseFloat(tokensReceivedStr);

    // 2. Filter: Amount > 10,000 USDC
    if (usdcSpent < 10000) {
        return; 
    }

    const impliedProb = usdcSpent / tokensReceived;
    console.log(`[*] Potential match detected: $${usdcSpent} on ${marketInfo.question} @ ${impliedProb.toFixed(2)} prob.`);

    // 3. Profile wallet via Polygonscan if absent from memory/DB
    const wallet = tradeData.maker.toLowerCase();
    
    const existingWallet = db.prepare('SELECT * FROM wallets WHERE address = ?').get(wallet) as any;
    
    let firstTxTs = null;
    let totalTxCount = 0;
    let hasCoverBehavior = false;
    let fundedBy = null;
    let fundSourceType = null;
    let hasNoDeFiInteraction = false;
    let isPolymarketOnly = false;

    if (!existingWallet) {
        try {
            const profile = await getWalletProfile(wallet);
            firstTxTs = profile.firstTxTs;
            totalTxCount = profile.totalTxCount;
            hasCoverBehavior = profile.hasCoverBehavior;
            fundedBy = profile.fundedBy;
            fundSourceType = profile.fundSourceType;
            hasNoDeFiInteraction = profile.hasNoDeFiInteraction;
            isPolymarketOnly = profile.isPolymarketOnly;
            
            const insertWallet = db.prepare(`
                INSERT INTO wallets (address, first_tx_ts, total_tx_count, funded_by, fund_source_type, last_updated, flags)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const initFlags = hasCoverBehavior ? JSON.stringify(['COVER_BEHAVIOR']) : '[]';
            insertWallet.run(wallet, firstTxTs, totalTxCount, fundedBy, fundSourceType, Math.floor(Date.now() / 1000), initFlags);
        } catch (error) {
            console.error(`Error fetching/storing wallet profile for ${wallet}:`, error);
            // Continue with null values to not break the pipeline
        }
    } else {
        firstTxTs = existingWallet.first_tx_ts;
        totalTxCount = existingWallet.total_tx_count;
        fundedBy = existingWallet.funded_by;
        fundSourceType = existingWallet.fund_source_type;
        try {
            const flags = JSON.parse(existingWallet.flags || '[]');
            hasCoverBehavior = flags.includes('COVER_BEHAVIOR');
            hasNoDeFiInteraction = flags.includes('NO_DEFI');
            isPolymarketOnly = flags.includes('MONO_USAGE');
        } catch(e) {}
    }

    // DIMENSION B: "All-In" heuristic (capital commitment)
    // usdcSpent + remainingBalance = total capital approximately.
    const remainingBalance = await getTokenBalance(wallet, '0x2791bca1f2de4661ed88a30c99a7a9449aa84174');
    const isAllIn = (usdcSpent / (usdcSpent + remainingBalance)) > 0.95;

    // 4. Scoring (Dimensions A & B & C-Immediate & F)
    const scoringResult = calculateImmediateScore(
        { firstTxTs, totalTxCount, hasCoverBehavior, fundSourceType, hasNoDeFiInteraction, isPolymarketOnly },
        { usdcSpent, impliedProb, isMonoOutcome: true, isAllIn, blockTs: tradeData.timestamp },
        { resolutionDateIso: marketInfo.resolution_date }
    );

    const score = scoringResult.score;
    const flagsJs = JSON.stringify(scoringResult.flags);

    // Use a transaction for atomic updates if possible, or simple error wrapping
    try {
        const updateWallet = db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + ?, last_updated = ? WHERE address = ?');
        updateWallet.run(score, Math.floor(Date.now() / 1000), wallet);
    } catch (error) {
        console.error(`Database error updating wallet ${wallet}:`, error);
    }

    // Persist trade
    try {
        db.prepare(`
            INSERT INTO trades (tx_hash, wallet, market_id, market_q, outcome, usdc_spent, implied_prob, block_ts, score, flags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(tradeData.txHash, wallet, tokenIdDecimal, marketInfo.question, marketInfo.outcome, usdcSpent, impliedProb, tradeData.timestamp, score, flagsJs);
    } catch (e) {
        // Ignore duplicate key error on re-broadcasts
    }

    // 5. Alerting based on score
    if (scoringResult.score >= 85) {
        detectedHighScores++;
        lastSuspiciousWallet = wallet;
        sendTelegramAlert(`🚨 **ALERTE ROUGE (Score: ${scoringResult.score})**\n` +
            `👤 Wallet: \`${wallet}\`\n` +
            `🎯 Marché: ${marketInfo.question}\n` +
            `🎲 Position: **${marketInfo.outcome}**\n` +
            `💰 Montant: $${Math.round(usdcSpent).toLocaleString()}\n` +
            `🚩 Flags: ${scoringResult.flags.join(', ')}`);
    } 
    else if (scoringResult.score >= 40) { // Lowered to 40 per user request
        detectedHighScores++;
        lastSuspiciousWallet = wallet;
        sendTelegramAlert(`⚠️ **ALERTE SUSPICION (Score: ${scoringResult.score})**\n` +
            `👤 Wallet: \`${wallet}\`\n` +
            `🎯 Marché: ${marketInfo.question}\n` +
            `🎲 Position: **${marketInfo.outcome}**\n` +
            `💰 Montant: $${Math.round(usdcSpent).toLocaleString()}\n` +
            `🚩 Flags: ${scoringResult.flags.join(', ')}`);
    }
    else if (scoringResult.score > 35) {
        console.log(`[LOG] Suspect trade detected (Score: ${scoringResult.score}) by ${wallet}`);
    }
}
