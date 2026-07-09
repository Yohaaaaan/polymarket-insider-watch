# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Polymarket insider trading detection system. Monitors political prediction markets on Polymarket (Polygon blockchain) for suspicious trading patterns and alerts via Telegram. Despite the directory name, this is a blockchain analytics tool, not a politician database.

## Commands

```bash
# Run in development (ts-node, no build step needed)
npm start

# Build TypeScript to dist/
npm run build

# Run compiled output
node dist/index.js

# Utility scripts (run directly with ts-node)
npx ts-node test_telegram.ts     # Test Telegram connectivity
npx ts-node list_samples.ts      # Query DB samples
npx ts-node purge_db.ts          # Wipe the SQLite database

# PHP infrastructure (Oracle Cloud provisioner)
composer install
php index.php
```

No test suite exists. There is no lint configuration.

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- `ALCHEMY_API_KEY` — Polygon WebSocket endpoint (system runs in dry mode without it)
- `ETHERSCAN_API_KEY` — PolygonScan API for wallet profiling
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — Alert delivery
- OCI variables — only needed for `index.php` provisioner

## Architecture

The system has two independent components:

### TypeScript Detection Engine (`src/`)

Data flows: **blockchain event → pipeline → scoring → Telegram alert**

- `blockchainListener.ts` — Alchemy WebSocket, listens for `OrderFilled` events on the CTF Exchange contract (`0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`). Auto-reconnects.
- `pipeline.ts` — Entry point for each trade event. Filters trades <$10k USDC, profiles the wallet, runs immediate scoring, triggers alerts.
- `polymarketAPI.ts` — Discovers political markets via Gamma API using keyword filtering. Stores them in `monitored_markets` DB table.
- `polygonscanAPI.ts` — Profiles wallets: funding source (CEX/bridge/privacy swap), age, TX count, DeFi activity.
- `scoringEngine.ts` — Scores trades across dimensions A (wallet profile), B (trade structure), C (temporal/timing), F (obfuscation). Alert threshold: score ≥ 40, max is 250+.
- `deferredScoring.ts` — Runs every 5 minutes to detect patterns requiring history: false hedges, quick flips (<72h), win rate on resolved markets, price spikes.
- `clusterAnalysis.ts` — Detects wallets funded from the same source (coordinated trading).
- `database.ts` — SQLite schema. Tables: `wallets`, `trades`, `clusters`, `monitored_markets`, `price_history`. WAL mode enabled. Schema is created automatically on first run.
- `constants.ts` — Canonical lists of known entity addresses: privacy swaps (SideShift, ChangeNOW, etc.), bridges (Hop, Stargate, etc.), CEX hot wallets (Binance, Kraken, etc.).
- `telegramBot.ts` — Sends alerts and periodic dashboard (every 30s).
- `index.ts` — Orchestrates startup: initializes DB, fetches markets, starts listener, schedules all intervals.

### PHP Provisioner (`index.php`)

Standalone Oracle Cloud script that polls OCI API every 5 minutes attempting to create an ARM instance when capacity is available. Unrelated to the detection logic.
