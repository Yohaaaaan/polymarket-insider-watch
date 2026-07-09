# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Purpose

Polymarket insider-trading detection system. Monitors political prediction
markets on Polymarket (Polygon blockchain) for suspicious trading patterns and
alerts via Telegram. The project is named `polymarket-insider-watch`;
this is a blockchain-analytics tool, not a politician database.

## Stack

- **Detection engine**: TypeScript on Node.js (18+), run via `ts-node`. No build
  is required to run. `ethers` v6 for blockchain access, `better-sqlite3` for
  storage.
- **Provisioner**: PHP (>=7.4) + Composer. A standalone Oracle Cloud (OCI)
  instance provisioner. Independent from the engine — do not conflate them.

## Commands

```bash
# --- TypeScript detection engine ---
npm install                      # install deps (node_modules/ is gitignored)
npm start                        # run in dev via ts-node (no build step)
npm run build                    # compile TypeScript to dist/
node dist/index.js               # run compiled output (see pitfall on stale dist/)

# Utility scripts (run directly with ts-node)
npx ts-node test_telegram.ts     # Test Telegram connectivity
npx ts-node list_samples.ts      # Query DB samples
npx ts-node purge_db.ts          # Wipe the SQLite database

# --- PHP Oracle Cloud provisioner (independent) ---
composer install                 # install PHP deps (vendor/ is gitignored)
php verify_resources.php         # read-only: discover OCID values for .env
php index.php                    # daemon: poll OCI to create an ARM instance
composer provision               # same as `php index.php`
```

No test suite exists. There is no lint configuration.

## Environment Setup

Copy `.env.example` to `.env` and fill in values. The two components read
**disjoint** sets of variables.

Detection engine (`src/`) reads exactly four vars via `process.env`:
- `ALCHEMY_API_KEY` — Polygon WebSocket endpoint (engine runs in dry mode
  without it; read in `blockchainListener.ts` and `index.ts`).
- `ETHERSCAN_API_KEY` — Etherscan V2 multichain API for wallet profiling
  (`polygonscanAPI.ts`, `clusterAnalysis.ts`).
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — alert/dashboard delivery
  (`telegramBot.ts`).

Provisioner (`index.php`) reads only `OCI_*` vars (region, user/tenancy OCIDs,
key fingerprint, private key path, subnet/image OCIDs, SSH public key, plus
optional shape/ocpus/memory/max-instances/AD/display-name). These are never read
by `src/`.

## Architecture

The system has two independent components sharing one directory. There is no
code-level integration between them; the only link is operational (the
provisioner creates the host the engine is meant to run on).

### TypeScript Detection Engine (`src/`)

Data flows: **blockchain event → pipeline → scoring → Telegram alert**

- `index.ts` — Entry point (`main()`). Initializes DB (side effect of importing
  `./database`), sends a Telegram init message, discovers markets, starts the
  listener, and owns all schedulers: markets refresh every **2h**, dashboard
  every **30s**, price tracking every **30min**, and
  `refreshResolvedMarkets → runDeferredScoring` every **5min**. If
  `ALCHEMY_API_KEY` is unset it stays in dry mode (no listener).
- `blockchainListener.ts` — Alchemy WebSocket (`ethers.WebSocketProvider`).
  Listens for `OrderFilled` on the CTF Exchange contract
  (`0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`), fetches the block timestamp via
  RPC, builds a trade object, and calls `processTrade`. Auto-reconnects after 5s
  on socket close.
- `pipeline.ts` — `processTrade()`, the per-event core. Drops the trade unless
  its token is in `monitored_markets` and USDC spent ≥ **$10,000**. Profiles the
  maker wallet (cached in `wallets`, else `getWalletProfile`), checks an all-in
  ratio (>0.95 of USDC balance), computes the immediate score, persists a row to
  `trades` and increments `wallets.cumulative_score`, then alerts.
- `polymarketAPI.ts` — Discovers political markets via Gamma API keyword
  filtering into `monitored_markets`; `refreshResolvedMarkets()` marks closed
  markets; `getMarketResolution()` reads a market's winning outcome.
- `polygonscanAPI.ts` — Wallet profiling via Etherscan **V2** multichain
  endpoint (`api.etherscan.io/v2/api`, `chainid=137` — this is not
  polygonscan.com). Derives funding source (CEX / bridge / privacy swap), first-tx
  age, tx count, and DeFi footprint.
- `scoringEngine.ts` — `calculateImmediateScore()`. Additive score with named
  flags across dimension **A** (wallet profile: age, tx count, no-DeFi),
  **B** (trade structure: size, implied probability, all-in, mono-outcome),
  **C** (timing to resolution), **F** (obfuscation: swap/bridge funding,
  creation delay, mono usage). No cap; can exceed 250.
- `deferredScoring.ts` — `runDeferredScoring()` every 5 min. History-dependent
  passes that mutate `wallets.cumulative_score` and append flags: false hedge,
  historical win rate, price-spike initiator, tranche buying, US-hours-only,
  quick flip (<72h), cumulative political gains, and surgical performance.
- `priceTracker.ts` — `trackMarketPrices()` polls Gamma prices into
  `price_history` (feeds the spike analysis).
- `clusterAnalysis.ts` — Same-source funding-cluster detection (dimension D).
  **Present but orphaned**: not imported or invoked by the runtime scheduler.
- `telegramBot.ts` — `sendTelegramAlert()` posts alerts; `updateTelegramDashboard()`
  edits one persistent dashboard message (its `message_id` is stored in
  `system_state`).
- `database.ts` — `better-sqlite3`, WAL mode. DB file at `data/polymarket.db`
  (i.e. `../data/polymarket.db` relative to `src/`). Schema + idempotent `ALTER`
  migrations run on import. Tables: `wallets`, `trades`, `clusters`,
  `monitored_markets`, `price_history`, `system_state` (+ `cluster_positions`
  view).
- `constants.ts` — `KNOWN_ENTITIES` map + `identifyEntity()`: privacy swaps
  (SideShift, ChangeNOW, FixedFloat, …), bridges (Hop, Stargate, Across, …), and
  CEX hot wallets (Binance, Kraken, Coinbase, …). Drives the funding-source
  scoring.

**Alert tiers (`pipeline.ts`)**: immediate score ≥ **85** → red alert; ≥ **40** →
suspicion alert; > 35 → console log only.

### PHP Provisioner (`index.php`)

Standalone Oracle Cloud script (fork of the `hitrov/oci-arm-host-capacity`
approach). An infinite loop that polls the OCI REST API every 5 minutes, calling
LaunchInstance to create an "Always Free" ARM VM (`VM.Standard.A1.Flex`, 4 OCPU /
24 GB) when capacity is available, then exits on success. Signs requests with
`hitrov/oci-api-php-request-sign`; loads `.env` via `phpdotenv`.
`verify_resources.php` (read-only credential/resource discovery) and
`test_ssl.php` (HTTPS reachability, 401 = OK) are helpers. Unrelated to the
detection logic.

## Key files

- `src/index.ts` — schedulers & startup
- `src/pipeline.ts` — trade filtering, profiling, scoring, alerting
- `src/scoringEngine.ts` + `src/deferredScoring.ts` — the two scoring stages
- `src/database.ts` — schema and DB location
- `index.php` — OCI provisioner (independent)
- `.env.example` — full commented config template
- `dune_queries.sql` — offline Dune backfill queries (not wired into `src/`)

## Pitfalls

- **Never commit `.env`.** It is gitignored and holds live secrets (API keys, an
  OCI private key path). Only `.env.example` (placeholders) is tracked. Verify
  before every commit: `git ls-files | grep -E '\.env$|node_modules|vendor/|/data/'`
  must be empty.
- `node_modules/`, `vendor/`, `venv/`, `dist/`, `data/`, and `*.log` are
  gitignored and created locally — never assume they are present after a clone.
- The SQLite DB (`data/polymarket.db`) is gitignored. `purge_db.ts` wipes it.
- **Stale `dist/`**: the compiled `dist/` on disk may not match `src/`. Prefer
  `npm start` (ts-node) or rebuild with `npm run build` before `node dist/index.js`.
- Wallet profiling uses the **Etherscan V2** multichain endpoint with
  `chainid=137`, not polygonscan.com — do not "correct" the URL.
- `clusterAnalysis.ts` is not invoked by the runtime; changes there have no live
  effect unless it is wired into `index.ts`.
- The two components are independent: `OCI_*` config belongs to `index.php` only;
  `ALCHEMY`/`ETHERSCAN`/`TELEGRAM` belong to `src/` only.
- The `composer.json` PSR-4 autoload (`OracleArmCapacity\ → src/`) is inert —
  `src/` contains TypeScript, not PHP classes.
