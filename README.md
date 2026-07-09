# Polymarket Insider-Trading Detector

On-chain surveillance tool that monitors political prediction markets on
[Polymarket](https://polymarket.com) (Polygon) in real time and flags trading
patterns consistent with insider activity — then alerts a human operator over
Telegram. The goal is factual: watch public on-chain activity around
politically sensitive markets and surface statistically suspicious behaviour
for manual review.

![PHP](https://img.shields.io/badge/PHP-%3E%3D7.4-777BB4?logo=php&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-Proprietary-red)

> **Private & proprietary.** This repository is not open source. See
> [LICENSE](LICENSE).

## Table of contents

- [What it does](#what-it-does)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Data sources](#data-sources)
- [Architecture](#architecture)
- [Security](#security)
- [License](#license)

## What it does

The system listens to the Polymarket CTF Exchange contract on Polygon, profiles
the wallets behind large trades, and scores each trade for "insider-like"
signals — freshly funded wallets, funds routed through no-KYC swap services,
suspicious timing relative to market resolution, coordinated clusters, and
obfuscation. Trades that cross an alert threshold are pushed to a Telegram
channel, alongside a live dashboard.

It observes **public** blockchain and prediction-market data only. It is a
signal-generation and triage aid for a human analyst, not an automated
accusation engine.

## How it works

```
blockchain event  →  pipeline  →  scoring engine  →  Telegram alert
   (OrderFilled)      (filter &      (dimensions        (+ live
                       profile)       A/B/C/F)           dashboard)
```

1. **Listen** — a WebSocket subscription to `OrderFilled` events on the CTF
   Exchange contract.
2. **Filter & profile** — each trade is filtered by size, then the maker wallet
   is profiled (funding source, age, transaction count, DeFi footprint).
3. **Score** — an immediate score is computed across several dimensions; a
   deferred pass runs every few minutes to catch patterns that need history
   (quick flips, false hedges, win rate on resolved markets, price spikes).
4. **Cluster** — wallets funded from the same source are linked as potential
   coordinated actors.
5. **Alert** — trades above the threshold trigger a Telegram alert; a dashboard
   message is edited in place with running statistics.

## Tech stack

| Layer                 | Technology                                             |
| --------------------- | ------------------------------------------------------ |
| Detection engine      | TypeScript (Node.js, `ts-node`)                        |
| Blockchain access     | `ethers` v6, Alchemy Polygon WebSocket                 |
| Wallet profiling      | PolygonScan (Etherscan-compatible) API                 |
| Market discovery      | Polymarket Gamma API                                   |
| Storage               | SQLite via `better-sqlite3` (WAL mode)                 |
| Alerts                | Telegram Bot API                                       |
| Historical backfill   | Dune Analytics (SQL, see `dune_queries.sql`)           |
| Infra provisioner     | PHP (`index.php`) + Composer, Oracle Cloud (OCI) API   |

## Project structure

```
.
├── src/                     # TypeScript detection engine
│   ├── index.ts             # Startup orchestration & schedulers
│   ├── blockchainListener.ts# Alchemy WS listener (OrderFilled)
│   ├── pipeline.ts          # Per-trade entry point (filter/profile/score)
│   ├── polymarketAPI.ts     # Political-market discovery (Gamma API)
│   ├── polygonscanAPI.ts    # Wallet profiling
│   ├── scoringEngine.ts     # Immediate scoring (dimensions A/B/C/F)
│   ├── deferredScoring.ts   # History-dependent scoring (every 5 min)
│   ├── clusterAnalysis.ts   # Same-source funding clusters
│   ├── priceTracker.ts      # Market price history
│   ├── telegramBot.ts       # Alerts & live dashboard
│   ├── database.ts          # SQLite schema & migrations
│   └── constants.ts         # Known bridge/swap/CEX addresses
├── index.php                # Oracle Cloud ARM provisioner (independent)
├── dune_queries.sql         # Dune backfill / hypothesis-testing queries
├── *.ts (root)              # Utility scripts (see Usage)
├── .env.example             # Configuration template (no secrets)
├── composer.json            # PHP dependencies
└── package.json             # Node dependencies
```

## Installation

Dependencies are **not** vendored. `node_modules/`, `vendor/`, `venv/`, and
`data/` are gitignored, so you must install them yourself after cloning:

```bash
# 1. TypeScript detection engine
npm install

# 2. PHP provisioner (optional — only if you use index.php)
composer install
```

Requirements:

- Node.js 18+ and npm
- PHP 7.4+ and Composer (only for the OCI provisioner)

## Configuration

Copy the template and fill in your own values. **Never commit `.env`.**

```bash
cp .env.example .env
```

The detection engine reads the following variables (leave a key empty to run in
degraded / dry mode):

| Variable             | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `ALCHEMY_API_KEY`    | Polygon WebSocket endpoint. Without it, real-time listening is disabled (dry mode). |
| `ETHERSCAN_API_KEY`  | PolygonScan API key for wallet profiling. Without it, profiling is mocked. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token used to deliver alerts and the dashboard.  |
| `TELEGRAM_CHAT_ID`   | Target Telegram chat/channel ID for alerts.                   |

The `OCI_*` variables in `.env.example` are only used by the PHP provisioner
(`index.php`) and are unrelated to the detection engine.

See [`.env.example`](.env.example) for the full, commented list.

## Usage

Detection engine:

```bash
# Run in development (no build step, uses ts-node)
npm start

# Compile to dist/ and run the compiled output
npm run build
node dist/index.js
```

On startup it initializes the SQLite database, discovers political markets,
starts the blockchain listener, and schedules periodic refreshes. Alerts and a
self-updating dashboard are posted to your Telegram chat. If no keys are
provided, it initializes in dry mode and reports readiness without listening.

Utility scripts (run directly with `ts-node`):

```bash
npx ts-node test_telegram.ts   # Verify Telegram connectivity
npx ts-node list_samples.ts    # Inspect DB samples
npx ts-node purge_db.ts        # Wipe the SQLite database
```

Historical backfill / hypothesis testing is done in Dune Analytics using the
queries in [`dune_queries.sql`](dune_queries.sql) (large bets, wallet age at
trade time, same-source funding clusters).

Oracle Cloud provisioner (independent infrastructure helper):

```bash
php index.php
```

> There is no automated test suite and no lint configuration.

## Data sources

- **Polymarket Gamma API** — discovers political prediction markets by keyword.
- **Polygon (Alchemy)** — real-time `OrderFilled` events from the CTF Exchange.
- **PolygonScan** — wallet history, funding source, and DeFi activity.
- **Dune Analytics** — offline backfill and historical validation.
- **Telegram** — human-facing alert delivery and dashboard.

## Architecture

The repository contains **two independent components**:

1. **TypeScript detection engine (`src/`)** — the core product. Data flows from
   a blockchain event through the pipeline and scoring engine to a Telegram
   alert. State lives in a local SQLite database (`wallets`, `trades`,
   `clusters`, `monitored_markets`, `price_history`, `system_state`), created
   automatically on first run.

2. **PHP provisioner (`index.php`)** — a standalone Oracle Cloud helper that
   polls the OCI API to create an ARM instance when free-tier capacity becomes
   available. It shares no logic with the detection engine and is included only
   as deployment infrastructure.

## Security

- Report vulnerabilities privately to **yohanmichau1@gmail.com** — see
  [SECURITY.md](SECURITY.md).
- Secrets belong in `.env` (gitignored). Only `.env.example` is tracked, and it
  contains placeholders only.
- Contribution conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Proprietary — All rights reserved, © 2026 Yohan Michau. See [LICENSE](LICENSE).
