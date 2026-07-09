export interface ScoringFlags {
    isNewWallet: boolean;
    isAllIn: boolean;
    isLess10Percent: boolean;
}

export function calculateImmediateScore(
    walletStats: { firstTxTs: number | null, totalTxCount: number, hasCoverBehavior: boolean, fundSourceType: string | null, hasNoDeFiInteraction: boolean, isPolymarketOnly: boolean },
    tradeDetails: { usdcSpent: number, impliedProb: number, isMonoOutcome: boolean, isAllIn: boolean, blockTs: number },
    marketMeta: { resolutionDateIso: string | null }
): { score: number, flags: string[] } {
    let score = 0;
    const flags: string[] = [];

    // Dim A: Profile
    if (walletStats.firstTxTs) {
        const ageDays = (Date.now() / 1000 - walletStats.firstTxTs) / 86400;
        if (ageDays < 7) {
            score += 30;
            flags.push('AGE_7D');
        } else if (ageDays <= 30) {
            score += 18;
            flags.push('AGE_30D');
        }
    } else {
        // No firstTxTs implies extremely new / no prior tx (or failure to fetch)
        score += 30;
        flags.push('AGE_UNKNOWN');
    }

    if (walletStats.totalTxCount < 10) {
        score += 20;
        flags.push('TX_LT_10');
    }

    // Dim A: Zero DeFi interaction before bet
    if (walletStats.hasNoDeFiInteraction) {
        score += 10;
        flags.push('NO_DEFI');
    }

    // Dim F: Active Obfuscation
    if (walletStats.hasCoverBehavior) {
        score += 15;
        flags.push('COVER_BEHAVIOR');
    }

    // Dim A & F: Fund Source Obfuscation
    if (walletStats.fundSourceType === 'swap_service') {
        score += 40; // Dim A: 15, Dim F: 25
        flags.push('FUNDED_BY_SWAP');
    } else if (walletStats.fundSourceType === 'bridge') {
        score += 40; // Dim A: 20, Dim F: 20
        flags.push('FUNDED_BY_BRIDGE');
    }

    // Dim B: Trade structure
    if (tradeDetails.usdcSpent > 500000) {
        score += 35;
        flags.push('HUGE_SIZE');
    } else if (tradeDetails.usdcSpent >= 100000) {
        score += 20;
        flags.push('LARGE_SIZE');
    }

    if (tradeDetails.impliedProb < 0.05) {
        score += 40;
        flags.push('PROB_LT_5');
    } else if (tradeDetails.impliedProb < 0.10) {
        score += 25;
        flags.push('PROB_LT_10');
    }

    if (tradeDetails.isAllIn) {
        score += 30; // 100% of capital on one outcome
        flags.push('ALL_IN');
    }

    // Mono-outcome heuristic based on no known NO positions
    if (tradeDetails.isMonoOutcome) {
        score += 30;
        flags.push('MONO_OUTCOME');
    }

    // Dim C: Temporal behavior (Immediate)
    if (marketMeta.resolutionDateIso) {
        const resolutionTs = new Date(marketMeta.resolutionDateIso).getTime() / 1000;
        const timeToResolution = resolutionTs - tradeDetails.blockTs;

        if (timeToResolution > 0) { // Check if market hasn't resolved yet
            const hoursToResolution = timeToResolution / 3600;
            if (hoursToResolution <= 48) {
                score += 40;
                flags.push('TIME_LT_48H');
            } else if (hoursToResolution <= 168) { // 7 days = 168h
                score += 25;
                flags.push('TIME_LT_7D');
            }
        }
    }

    // Dim F: Suspect delay 7-14 days between wallet creation and first big bet
    if (walletStats.firstTxTs && tradeDetails.usdcSpent >= 10000) {
        const delayDays = (tradeDetails.blockTs - walletStats.firstTxTs) / 86400;
        if (delayDays >= 7 && delayDays <= 14) {
            score += 10;
            flags.push('SUSPECT_DELAY');
        }
    }

    // Dim F: Mono-usage Polymarket (wallet only interacts with PM contracts)
    if (walletStats.isPolymarketOnly && walletStats.totalTxCount >= 2) {
        score += 20;
        flags.push('MONO_USAGE');
    }

    // Note: Dimensions D, E require deeper temporal analysis and cluster detection
    // which are implemented as deferred jobs sweeping the DB.

    return { score, flags };
}
