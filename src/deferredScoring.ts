import { db } from './database';
import { getMarketResolution, refreshResolvedMarkets } from './polymarketAPI';
import { getWalletPolymarketHistory } from './polygonscanAPI';

export function runDeferredScoring() {
    console.log("Running deferred scoring sweep (Dimensions C, E, F)...");

    const nowTs = Math.floor(Date.now() / 1000);

    // Dimenstion C: Quick entry/exit (< 72h duration)
    // For every wallet, find if they bought and sold the same market within 72h
    // Since we only track OrderFilled, we need to find pairs of trades:
    // Buying YES vs Buying NO is not selling. Selling is basically takerAssetId = Token and makerAssetId = USDC
    // Wait, the Polymarket CTF Exchange uses a unique OrderFilled mechanic. To sell, you usually bet on the opposing side or use the conditional token router.
    // Let's use a simpler heuristic for now: A wallet that trades YES and YES on the same market, but implies an exit?
    // Actually, on Polymarket, selling a YES position means either merging YES+NO to get USDC back, or selling YES for USDC on the CLOB.
    // If selling on CLOB, makerAssetId is the Condition Token, and taker is USDC. But in our listener, we assume makerAssetId is always the Condition Token (so they are BUYING USDC and SELLING the Token? No, if makerAssetId is the token, they are offering the token, meaning they are SELLING it).
    // In our `pipeline.ts`: `makerAssetId` is assumed to be the token they are receiving. We need to be careful.
    // Let's stick to the simplest Heuristics:

    // 1. Dimension F: Faux Hedge (Irrational Cover)
    // Look for wallets that bought YES and NO on the *same market* with an irrational ratio
    runFalseHedgeAnalysis();

    // 2. Dimension E: Historical Performance
    // To do this, we need to update resolved markets first
    runHistoricalPerformanceAnalysis();

    // 3. Dimension C: Time-shifted entry (Price Spikes)
    runPriceSpikeAnalysis();

    // 4. Dimension B: Multiple tranches on same market
    runTrancheAnalysis();

    // 5. Dimension C: US-hours-only trading
    runUSHoursAnalysis();

    // 6. Dimension C: Quick flip < 72h
    runQuickFlipAnalysis();

    // 7. Dimension E: Cumulative gains > $500k
    runCumulativeGainsAnalysis();

    // 8. Dimension E: Surgical performance (Pol vs Non-Pol)
    runSurgicalPerformanceAnalysis().catch(console.error);
}

function runFalseHedgeAnalysis() {
    // A false hedge is buying the extremely likely outcome (e.g. 94%) to cover a massive bet on the unlikely one (6%)
    // But buying @ 94% destroys value. 
    // We look for wallets that have TWO trades on the same market_id, but different outcomes, where one implied_prob > 0.90 and the other < 0.10.

    const query = `
        SELECT t1.wallet, t1.market_id,
               t1.usdc_spent as amount1, t1.implied_prob as prob1, t1.outcome as out1,
               t2.usdc_spent as amount2, t2.implied_prob as prob2, t2.outcome as out2
        FROM trades t1
        JOIN trades t2 ON t1.wallet = t2.wallet AND t1.market_id = t2.market_id AND t1.tx_hash != t2.tx_hash
        WHERE t1.outcome != t2.outcome
    `;

    const hedges = db.prepare(query).all() as any[];
    const flaggedWallets = new Set<string>();

    for (const h of hedges) {
        if (flaggedWallets.has(h.wallet)) continue;

        // One prob must be very high and the other very low
        const hasLowProb = h.prob1 < 0.15 || h.prob2 < 0.15;
        const hasHighProb = h.prob1 > 0.85 || h.prob2 > 0.85;

        // The high prob bet is the "fake hedge". The low prob is the real bet.
        // Also the amount of the fake hedge should be smaller but noticeable (e.g., to create a 90/10 ratio on capital)
        // For example, 450k on 6% and 50k on 94%.

        if (hasLowProb && hasHighProb) {
            console.log(`[DEFERRED] Detected False Hedge for ${h.wallet} on market ${h.market_id}`);
            
            // Flag wallet
            try {
                // Add 20 points for faux hedge
                db.prepare(`UPDATE wallets SET cumulative_score = cumulative_score + 20 WHERE address = ?`).run(h.wallet);
                flaggedWallets.add(h.wallet);
            } catch (e) {
                console.error('Error updating faux hedge score', e);
            }
        }
    }
}

function runHistoricalPerformanceAnalysis() {
    // Get all wallets that have traded on RESOLVED markets
    // If a wallet has won 100% of their resolved political markets (min 3 markets), it's highly suspect.
    
    // First, find wallets and their trades on resolved markets
    const query = `
        SELECT t.wallet, t.market_id, t.outcome as guessed_outcome, m.winning_outcome
        FROM trades t
        JOIN monitored_markets m ON t.market_id = m.token_id
        WHERE m.resolved = 1 AND m.winning_outcome IS NOT NULL
    `;

    const rows = db.prepare(query).all() as any[];
    
    // Aggregate by wallet
    const walletStats = new Map<string, { total: number, won: number }>();

    for (const row of rows) {
        const stats = walletStats.get(row.wallet) || { total: 0, won: 0 };
        stats.total++;
        if (row.guessed_outcome === row.winning_outcome) {
            stats.won++;
        }
        walletStats.set(row.wallet, stats);
    }

    // Apply scoring
    for (const [wallet, stats] of walletStats.entries()) {
        const winRate = stats.won / stats.total;
        let pnlScore = 0;

        if (stats.total >= 5 && winRate > 0.75) {
            pnlScore = 30; // High success rate
        } else if (stats.total >= 10 && winRate > 0.65) {
            pnlScore = 20;
        }

        if (stats.total >= 3 && stats.won === stats.total) { // Perfect streak
            pnlScore = Math.max(pnlScore, 35);
        }

        if (pnlScore > 0) {
            // Read flags from DB to prevent re-applying the score
            const walletData = db.prepare('SELECT flags, cumulative_score FROM wallets WHERE address = ?').get(wallet) as any;
            
            let flags: string[] = [];
            try {
                if (walletData && walletData.flags) {
                    flags = JSON.parse(walletData.flags);
                }
            } catch(e) {}

            if (!flags.includes('HIGH_WIN_RATE')) {
                console.log(`[DEFERRED] Wallet ${wallet} has win rate ${(winRate*100).toFixed(1)}% over ${stats.total} trades. Applying +${pnlScore} PNL score.`);
                flags.push('HIGH_WIN_RATE');
                
                try {
                    db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + ?, flags = ? WHERE address = ?')
                        .run(pnlScore, JSON.stringify(flags), wallet);
                } catch (e) {
                    console.error('Error updating PNL score', e);
                }
            }
        }
    }
}

function runPriceSpikeAnalysis() {
    const now = Math.floor(Date.now() / 1000);
    const twoDaysAgo = now - 48 * 3600;

    const querySpikes = `
        SELECT token_id, MIN(price) as min_p, MAX(price) as max_p
        FROM price_history
        WHERE timestamp >= ?
        GROUP BY token_id
        HAVING max_p > min_p * 3 AND (max_p - min_p) > 0.15
    `;
    const spikes = db.prepare(querySpikes).all(twoDaysAgo) as any[];

    for (const s of spikes) {
        const maxRow = db.prepare('SELECT timestamp FROM price_history WHERE token_id = ? AND timestamp >= ? ORDER BY price DESC LIMIT 1').get(s.token_id, twoDaysAgo) as any;
        const minRow = db.prepare('SELECT timestamp FROM price_history WHERE token_id = ? AND timestamp >= ? AND timestamp < ? ORDER BY price ASC LIMIT 1').get(s.token_id, twoDaysAgo, maxRow?.timestamp || now) as any;

        if (!minRow || !maxRow) continue;

        const susTrades = db.prepare(`
            SELECT wallet, tx_hash, implied_prob 
            FROM trades 
            WHERE market_id = ? AND block_ts >= ? AND block_ts <= ? AND implied_prob <= 0.20
        `).all(s.token_id, minRow.timestamp - (3600 * 24), maxRow.timestamp) as any[];

        for (const t of susTrades) {
            const walletData = db.prepare('SELECT flags FROM wallets WHERE address = ?').get(t.wallet) as any;
            let flags: string[] = [];
            try { 
                if (walletData && walletData.flags) flags = JSON.parse(walletData.flags); 
            } catch(e) {}
            
            if (!flags.includes('SPIKE_INITIATOR')) {
                console.log(`[DEFERRED] Wallet ${t.wallet} bought ${s.token_id} at ${t.implied_prob.toFixed(2)} before a spike to ${s.max_p.toFixed(2)}. +35 pts.`);
                flags.push('SPIKE_INITIATOR');
                try {
                    db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + 35, flags = ? WHERE address = ?').run(JSON.stringify(flags), t.wallet);
                } catch(e) {}
            }
        }
    }
}

/**
 * Dim B: Detect wallets entering positions in multiple tranches on the same market/outcome.
 * If a wallet has >= 3 trades on the same market+outcome, that's a fragmented entry pattern.
 */
function runTrancheAnalysis() {
    const query = `
        SELECT wallet, market_id, outcome, COUNT(*) as trade_count
        FROM trades
        GROUP BY wallet, market_id, outcome
        HAVING trade_count >= 3
    `;
    const rows = db.prepare(query).all() as any[];

    for (const r of rows) {
        const walletData = db.prepare('SELECT flags FROM wallets WHERE address = ?').get(r.wallet) as any;
        let flags: string[] = [];
        try { if (walletData?.flags) flags = JSON.parse(walletData.flags); } catch(e) {}

        const flagKey = `TRANCHE_${r.market_id.substring(0, 8)}`;
        if (!flags.includes(flagKey)) {
            console.log(`[DEFERRED] Wallet ${r.wallet} entered ${r.trade_count} tranches on market ${r.market_id} (${r.outcome}). +15 pts.`);
            flags.push(flagKey);
            try {
                db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + 15, flags = ? WHERE address = ?').run(JSON.stringify(flags), r.wallet);
            } catch(e) {}
        }
    }
}

/**
 * Dim C: Detect if a wallet trades ONLY during US business hours (9h-18h EST = 14h-23h UTC).
 * This is suspicious because it implies the operator is in a US timezone and follows office hours.
 */
function runUSHoursAnalysis() {
    const wallets = db.prepare('SELECT DISTINCT wallet FROM trades').all() as any[];

    for (const w of wallets) {
        const trades = db.prepare('SELECT block_ts FROM trades WHERE wallet = ?').all(w.wallet) as any[];
        if (trades.length < 3) continue; // Need at least 3 trades to see a pattern

        let allInUSHours = true;
        for (const t of trades) {
            const d = new Date(t.block_ts * 1000);
            const utcHour = d.getUTCHours();
            // US business hours: 9AM-6PM EST = 14:00-23:00 UTC
            if (utcHour < 14 || utcHour >= 23) {
                allInUSHours = false;
                break;
            }
        }

        if (allInUSHours) {
            const walletData = db.prepare('SELECT flags FROM wallets WHERE address = ?').get(w.wallet) as any;
            let flags: string[] = [];
            try { if (walletData?.flags) flags = JSON.parse(walletData.flags); } catch(e) {}

            if (!flags.includes('US_HOURS_ONLY')) {
                console.log(`[DEFERRED] Wallet ${w.wallet} trades ONLY during US business hours. +10 pts.`);
                flags.push('US_HOURS_ONLY');
                try {
                    db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + 10, flags = ? WHERE address = ?').run(JSON.stringify(flags), w.wallet);
                } catch(e) {}
            }
        }
    }
}

/**
 * Dim C: Detect quick-flip positions (entry AND exit within 72h).
 * Since we track buys only, we approximate: if a wallet buys YES on market A, then later
 * buys NO on the same market (which is essentially selling YES), within 72h, that's a quick flip.
 */
function runQuickFlipAnalysis() {
    const query = `
        SELECT t1.wallet, t1.market_id, t1.block_ts as buy_ts, t2.block_ts as flip_ts,
               (t2.block_ts - t1.block_ts) as duration
        FROM trades t1
        JOIN trades t2 ON t1.wallet = t2.wallet AND t1.market_id = t2.market_id 
            AND t1.outcome != t2.outcome AND t2.block_ts > t1.block_ts
        WHERE (t2.block_ts - t1.block_ts) < 259200
    `;
    const flips = db.prepare(query).all() as any[];
    const seen = new Set<string>();

    for (const f of flips) {
        const key = `${f.wallet}_${f.market_id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const walletData = db.prepare('SELECT flags FROM wallets WHERE address = ?').get(f.wallet) as any;
        let flags: string[] = [];
        try { if (walletData?.flags) flags = JSON.parse(walletData.flags); } catch(e) {}

        if (!flags.includes('QUICK_FLIP')) {
            const hours = Math.round(f.duration / 3600);
            console.log(`[DEFERRED] Wallet ${f.wallet} did a quick flip on ${f.market_id} in ${hours}h. +20 pts.`);
            flags.push('QUICK_FLIP');
            try {
                db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + 20, flags = ? WHERE address = ?').run(JSON.stringify(flags), f.wallet);
            } catch(e) {}
        }
    }
}

/**
 * Dim E: Cumulative gains > $500k on political markets.
 * Since we don't track exact PnL (no sell data), we approximate by summing usdcSpent on
 * winning bets (where outcome = winning_outcome on resolved markets).
 * The potential gain is usdcSpent / impliedProb (tokens received * $1 if they win).
 */
function runCumulativeGainsAnalysis() {
    const query = `
        SELECT t.wallet, SUM(t.usdc_spent / t.implied_prob - t.usdc_spent) as estimated_profit
        FROM trades t
        JOIN monitored_markets m ON t.market_id = m.token_id
        WHERE m.resolved = 1 AND m.winning_outcome IS NOT NULL AND t.outcome = m.winning_outcome
        GROUP BY t.wallet
        HAVING estimated_profit > 500000
    `;
    const bigWinners = db.prepare(query).all() as any[];

    for (const w of bigWinners) {
        const walletData = db.prepare('SELECT flags FROM wallets WHERE address = ?').get(w.wallet) as any;
        let flags: string[] = [];
        try { if (walletData?.flags) flags = JSON.parse(walletData.flags); } catch(e) {}

        if (!flags.includes('BIG_POLITICAL_GAINS')) {
            console.log(`[DEFERRED] Wallet ${w.wallet} has estimated $${Math.round(w.estimated_profit).toLocaleString()} in political market gains. +25 pts.`);
            flags.push('BIG_POLITICAL_GAINS');
            try {
                db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + 25, flags = ? WHERE address = ?').run(JSON.stringify(flags), w.wallet);
            } catch(e) {}
        }
    }
}

/**
 * Dim E: Surgical Performance.
 * Identifies "specialists" who have high win rates on political markets
 * but average or poor performance on everything else.
 */
async function runSurgicalPerformanceAnalysis() {
    const suspectWallets = db.prepare('SELECT address, cumulative_score, flags FROM wallets WHERE cumulative_score >= 35').all() as any[];

    for (const w of suspectWallets) {
        let flags: string[] = [];
        try { if (w.flags) flags = JSON.parse(w.flags); } catch(e) {}
        if (flags.includes('SURGICAL_PERF')) continue;

        // 1. Get political performance (from DB)
        const polTrades = db.prepare(`
            SELECT t.outcome, m.winning_outcome, t.usdc_spent, t.implied_prob
            FROM trades t
            JOIN monitored_markets m ON t.market_id = m.token_id
            WHERE t.wallet = ? AND m.resolved = 1
        `).all(w.address) as any[];

        if (polTrades.length < 3) continue; // Need sample size

        const polWins = polTrades.filter(t => t.outcome === t.winning_outcome).length;
        const polWinRate = polWins / polTrades.length;

        if (polWinRate < 0.70) continue; // Must be very good at politics first

        // 2. Get non-political historical data from Polygonscan
        const history = await getWalletPolymarketHistory(w.address);
        const nonPolTokenIds = new Set<string>();
        
        for (const log of history) {
            const data = log.data.substring(2);
            const makerAssetId = '0x' + data.substring(0, 64);
            
            const isMonitored = db.prepare('SELECT 1 FROM monitored_markets WHERE token_id = ?').get(makerAssetId);
            if (!isMonitored) {
                nonPolTokenIds.add(makerAssetId);
            }
        }

        if (nonPolTokenIds.size < 3) continue; // Need non-pol activity to compare

        // 3. Sample non-political resolutions
        let nonPolWins = 0;
        let nonPolResolved = 0;
        const samples = Array.from(nonPolTokenIds).slice(0, 10);

        for (const tid of samples) {
            const res = await getMarketResolution(tid);
            if (res.resolved) {
                nonPolResolved++;
                if (res.winner === tid) {
                    nonPolWins++;
                }
            }
        }

        if (nonPolResolved >= 3) {
            const nonPolWinRate = nonPolWins / nonPolResolved;
            if (nonPolWinRate < 0.55) {
                console.log(`[DEFERRED] Wallet ${w.address} is SURGICAL: Pol WinRate ${(polWinRate*100).toFixed(0)}% vs Non-Pol ${(nonPolWinRate*100).toFixed(0)}%. +20 pts.`);
                flags.push('SURGICAL_PERF');
                db.prepare('UPDATE wallets SET cumulative_score = cumulative_score + 20, flags = ? WHERE address = ?')
                    .run(JSON.stringify(flags), w.address);
            }
        }
    }
}
