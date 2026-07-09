import { refreshMonitoredTokens, refreshResolvedMarkets } from './polymarketAPI';
import { trackMarketPrices } from './priceTracker';
import { runDeferredScoring } from './deferredScoring';
import { startBlockchainListener } from './blockchainListener';
import { sendTelegramAlert, updateTelegramDashboard } from './telegramBot';
import { getPipelineStats } from './pipeline';
import { db } from './database';

import dotenv from 'dotenv';
dotenv.config();

const startTime = Date.now();

// Track scan progress globally for the dashboard
export let currentScanFound = 0;
export function updateScanProgress(count: number) {
    currentScanFound = count;
}

async function updateDashboard() {
    const stats = db.prepare('SELECT COUNT(*) as count FROM monitored_markets').get() as { count: number };
    const pStats = getPipelineStats();
    
    const uptimeMin = Math.floor((Date.now() - startTime) / 60000);
    
    const dashboardMsg = `📊 **Polymarket Monitor Dashboard**\n` +
        `--------------------------------\n` +
        `🔍 **Tokens Surveillés**: ${stats.count.toLocaleString()}\n` +
        `✨ **Nouveaux (Scan)**: ${currentScanFound.toLocaleString()}\n` +
        `🚀 **Uptime**: ${uptimeMin} min\n` +
        `📝 **Trades Analysés**: ${pStats.totalTrades}\n` +
        `⚠️ **Alertes Détectées**: ${pStats.detectedHighScores}\n` +
        `👤 **Dernier Suspect**: \`${pStats.lastSuspiciousWallet}\`\n\n` +
        `🔄 _Dernière mise à jour: ${new Date().toLocaleTimeString()}_`;

    await updateTelegramDashboard(dashboardMsg);
}

async function main() {
    console.log("=========================================");
    console.log(" Polymarket Insider Trading Detector v1.0");
    console.log("=========================================\n");

    if (!process.env.ALCHEMY_API_KEY) {
        console.warn("WARNING: ALCHEMY_API_KEY is missing. Real-time listening will not work!");
    }
    if (!process.env.ETHERSCAN_API_KEY) {
        console.warn("WARNING: ETHERSCAN_API_KEY is missing. Wallet profiling will be mocked.");
    }

    // 1. Initial Dashboard
    await sendTelegramAlert("🚀 **Polymarket Monitor Initializing...**");
    await updateDashboard();

    // 2. Initial market fetch/discovery
    refreshMonitoredTokens();

    // 3. Set up periodic refresh every 2 hours
    setInterval(() => {
        console.log("\n[⏳] Triggering periodic market refresh...");
        refreshMonitoredTokens().catch(console.error);
    }, 2 * 60 * 60 * 1000);

    // 4. Update Dashboard every 30 seconds
    setInterval(updateDashboard, 30000);

    // Track market prices every 30 minutes
    setInterval(() => {
        trackMarketPrices().catch(console.error);
    }, 30 * 60 * 1000);

    // 5. Periodic deferred updates (every 5 minutes for resolutions & scoring)
    setInterval(() => {
        refreshResolvedMarkets()
            .then(() => runDeferredScoring())
            .catch(console.error);
    }, 5 * 60 * 1000);

    // 6. Start listener
    if (process.env.ALCHEMY_API_KEY) {
        await startBlockchainListener();
    } else {
        console.log("System initialized in dry mode (no keys provided). Ready to analyze.");
    }
}

main().catch(console.error);
