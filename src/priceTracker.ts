import axios from 'axios';
import { db } from './database';

const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com/markets';

// Fetch the status of all currently monitored markets to save their prices
export async function trackMarketPrices() {
    console.log("Tracking current market prices...");
    
    // Get all un-resolved monitored markets
    const activeMarkets = db.prepare('SELECT DISTINCT token_id, question FROM monitored_markets WHERE resolved = 0').all() as any[];
    
    if (activeMarkets.length === 0) return;

    try {
        // Just fetch all active markets from Polymarket and find the ones we are monitoring
        // A single call might be sufficient if we pass them somehow, but Gamma API doesn't allow bulk by condition_id easily 
        // We can just fetch the first few pages of active markets, or do an individual check if the list is small.
        // For performance, doing it via a few API calls is better.
        // Let's get active markets in a loop or since our tracked list is likely < 100, we could query them.
        
        let url = `${GAMMA_BASE_URL}?active=true&closed=false&limit=500`;
        const response = await axios.get(url);
        if (response.data) {
            const markets = response.data;
            const now = Math.floor(Date.now() / 1000);
            
            let count = 0;
            const insertStmt = db.prepare('INSERT INTO price_history (token_id, timestamp, price, volume) VALUES (?, ?, ?, ?)');

            for (const am of activeMarkets) {
                // Find market in Gamma response containing our token
                const gammaMarket = markets.find((m: any) => m.tokens && m.tokens.some((t: any) => t.token_id === am.token_id));
                if (gammaMarket) {
                    const token = gammaMarket.tokens.find((t: any) => t.token_id === am.token_id);
                    if (token) {
                        const price = token.price || 0; // The current price representing prob in Gamma
                        const volume = parseFloat(gammaMarket.volume) || 0;
                        
                        try {
                            insertStmt.run(am.token_id, now, price, volume);
                            count++;
                        } catch (e) {
                            console.error(`Error saving price for ${am.token_id}`, e);
                        }
                    }
                }
            }
            console.log(`Saved ${count} price data points.`);
        }
    } catch (e) {
        console.error("Error tracking market prices:", e);
    }
}
