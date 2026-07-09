import { db } from './src/database';

async function purge() {
    console.log("Purging monitored_markets table...");
    db.prepare('DELETE FROM monitored_markets').run();
    console.log("Purge complete.");
}

purge().catch(console.error);
