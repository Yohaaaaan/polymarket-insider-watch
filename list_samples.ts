import { db } from './src/database';

async function listSamples() {
    console.log("--- Random Samples from Monitored Markets ---");
    const rows = db.prepare('SELECT DISTINCT question FROM monitored_markets ORDER BY RANDOM() LIMIT 20').all() as { question: string }[];
    
    rows.forEach((row, idx) => {
        console.log(`${idx + 1}. ${row.question}`);
    });
    console.log("-------------------------------------------");
}

listSamples().catch(console.error);
