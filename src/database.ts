import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'polymarket.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS wallets (
    address          TEXT PRIMARY KEY,
    first_tx_ts      INTEGER,
    total_tx_count   INTEGER,
    funded_by        TEXT,
    fund_source_type TEXT,   -- 'cex'|'swap_service'|'bridge'|'wallet'
    bridge_count     INTEGER DEFAULT 0,
    cumulative_score INTEGER DEFAULT 0,
    alert_level      TEXT DEFAULT 'NORMAL',
    last_updated     INTEGER,
    flags            TEXT DEFAULT '[]' -- JSON array of wallet-level flags (e.g., HIGH_WIN_RATE)
  );

  CREATE TABLE IF NOT EXISTS trades (
    tx_hash       TEXT PRIMARY KEY,
    wallet        TEXT REFERENCES wallets(address),
    market_id     TEXT,
    market_q      TEXT,
    outcome       TEXT,   -- 'YES'|'NO'
    usdc_spent    REAL,
    implied_prob  REAL,
    block_ts      INTEGER,
    score         INTEGER,
    flags         TEXT    -- JSON array des flags déclenchés
  );

  CREATE TABLE IF NOT EXISTS clusters (
    cluster_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_a      TEXT,
    wallet_b      TEXT,
    reason        TEXT,   -- heuristique déclenchée
    confidence    REAL,
    detected_ts   INTEGER
  );

  CREATE TABLE IF NOT EXISTS monitored_markets (
    token_id        TEXT PRIMARY KEY,
    question       TEXT,
    outcome        TEXT,
    resolution_date TEXT,
    volume         REAL,
    last_seen      INTEGER,
    resolved       INTEGER DEFAULT 0, -- 0 for unresolved, 1 for resolved
    winning_outcome TEXT              -- The winning outcome (YES/NO/etc.) if resolved
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id      TEXT,
    timestamp     INTEGER,
    price         REAL,
    volume        REAL
  );

  CREATE TABLE IF NOT EXISTS system_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  DROP VIEW IF EXISTS cluster_positions;
  CREATE VIEW cluster_positions AS
    SELECT c.cluster_id, t.market_id, t.market_q, t.outcome,
           SUM(t.usdc_spent) as total_usdc, COUNT(*) as nb_wallets
    FROM clusters c JOIN trades t ON (t.wallet = c.wallet_a OR t.wallet = c.wallet_b)
    GROUP BY c.cluster_id, t.market_id, t.outcome;
`);

// Safety migrations for existing databases
const migrations = [
    { table: 'wallets', column: 'flags', type: "TEXT DEFAULT '[]'" },
    { table: 'trades', column: 'score', type: "INTEGER DEFAULT 0" },
    { table: 'trades', column: 'flags', type: "TEXT DEFAULT '[]'" },
    { table: 'monitored_markets', column: 'resolved', type: "INTEGER DEFAULT 0" },
    { table: 'monitored_markets', column: 'winning_outcome', type: "TEXT" }
];

for (const m of migrations) {
    try {
        db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`);
        console.log(`[DB Migration] Added column ${m.column} to ${m.table}`);
    } catch (e: any) {
        // Most likely the column already exists, ignore
    }
}

console.log('Database initialized at', dbPath);
