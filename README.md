# Polymarket Insider-Trading Detector

On-chain surveillance tool that monitors political prediction markets on
[Polymarket](https://polymarket.com) (Polygon) in real time and flags trading
patterns consistent with insider activity — then alerts a human operator over
Telegram. The goal is factual: watch **public** on-chain activity around
politically sensitive markets and surface statistically suspicious behaviour for
manual review.

![PHP](https://img.shields.io/badge/PHP-%3E%3D7.4-777BB4?logo=php&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)
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
signals — freshly funded wallets, funds routed through no-KYC swap services or
bridges, all-in position sizing, extreme implied probabilities, and suspicious
timing relative to market resolution. Trades that cross an alert threshold are
pushed to a Telegram chat, alongside a live, self-updating dashboard.

It observes **public** blockchain and prediction-market data only. It is a
signal-generation and triage aid for a human analyst, not an automated
accusation engine.

## How it works

```
blockchain event  →  pipeline        →  scoring          →  Telegram alert
   (OrderFilled)      (filter &          (immediate +        (+ live
                       profile)           deferred/history)   dashboard)
```

1. **Discover** — political markets are pulled from the Polymarket Gamma API by
   keyword and stored in `monitored_markets` (refreshed every 2 hours).
2. **Listen** — a WebSocket subscription to `OrderFilled` events on the CTF
   Exchange contract streams every fill in real time.
3. **Filter & profile** — trades are dropped unless they touch a monitored
   market and spend at least $10k USDC; the maker wallet is then profiled
   (funding source, age, transaction count, DeFi footprint).
4. **Score (immediate)** — a synchronous score is computed across four
   dimensions (wallet profile, trade structure, timing, obfuscation).
5. **Score (deferred)** — every 5 minutes a history pass re-scores wallets for
   patterns that need context: false hedges, quick flips, win rate on resolved
   markets, price spikes, tranche buying, US-hours-only activity, and large
   cumulative political gains.
6. **Alert** — trades above threshold trigger a Telegram alert; a single
   dashboard message is edited in place with running statistics (every 30s).

The `clusters` table and same-source coordinated-wallet analysis
(`clusterAnalysis.ts`) exist in the codebase as a component but are not wired
into the current runtime scheduler.

## Tech stack

| Layer               | Technology                                                    |
| ------------------- | ------------------------------------------------------------- |
| Detection engine    | TypeScript on Node.js, run via `ts-node`                      |
| Blockchain access   | `ethers` v6, Alchemy Polygon WebSocket + RPC                  |
| Wallet profiling    | Etherscan V2 multichain API (Polygon, `chainid=137`)          |
| Market discovery    | Polymarket Gamma API                                          |
| Storage             | SQLite via `better-sqlite3` (WAL mode)                        |
| Alerts              | Telegram Bot API                                              |
| Historical backfill | Dune Analytics (SQL, see `dune_queries.sql`) — offline        |
| Infra provisioner   | PHP (`index.php`) + Composer, Oracle Cloud (OCI) REST API     |

## Project structure

```
.
├── src/                      # TypeScript detection engine
│   ├── index.ts              # Startup orchestration & schedulers
│   ├── blockchainListener.ts # Alchemy WS listener (OrderFilled) + reconnect
│   ├── pipeline.ts           # Per-trade entry point (filter/profile/score/alert)
│   ├── polymarketAPI.ts      # Political-market discovery & resolution (Gamma API)
│   ├── polygonscanAPI.ts     # Wallet profiling (Etherscan V2, chainid 137)
│   ├── scoringEngine.ts      # Immediate scoring (dimensions A/B/C/F)
│   ├── deferredScoring.ts    # History-dependent scoring (every 5 min)
│   ├── clusterAnalysis.ts    # Same-source funding clusters (not wired in)
│   ├── priceTracker.ts       # Market price history (every 30 min)
│   ├── telegramBot.ts        # Alerts & live dashboard
│   ├── database.ts           # SQLite schema & migrations
│   └── constants.ts          # Known bridge/swap/CEX addresses
├── index.php                 # Oracle Cloud ARM provisioner (independent)
├── verify_resources.php      # Read-only OCI credential / resource discovery
├── test_ssl.php              # OCI HTTPS reachability smoke test
├── dune_queries.sql          # Dune backfill / hypothesis-testing queries
├── list_samples.ts           # Utility: inspect DB samples
├── purge_db.ts               # Utility: wipe the SQLite database
├── test_telegram.ts          # Utility: verify Telegram connectivity
├── .env.example              # Configuration template (no secrets)
├── composer.json             # PHP dependencies (provisioner)
└── package.json              # Node dependencies (detection engine)
```

Not tracked (gitignored, created locally): `node_modules/`, `vendor/`, `venv/`,
`dist/`, `data/` (the SQLite database), and `*.log`.

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

| Variable             | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `ALCHEMY_API_KEY`    | Polygon WebSocket endpoint. Without it, real-time listening is disabled (dry mode).  |
| `ETHERSCAN_API_KEY`  | Etherscan V2 (Polygon) API key for wallet profiling. Without it, profiling degrades. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token used to deliver alerts and the dashboard.                         |
| `TELEGRAM_CHAT_ID`   | Target Telegram chat/channel ID for alerts.                                          |

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
starts the blockchain listener, and schedules periodic refreshes (markets every
2h, dashboard every 30s, prices every 30min, deferred scoring every 5min).
Alerts and a self-updating dashboard are posted to your Telegram chat. If no
keys are provided, it initializes in dry mode and reports readiness without
listening.

Utility scripts (run directly with `ts-node`):

```bash
npx ts-node test_telegram.ts   # Verify Telegram connectivity
npx ts-node list_samples.ts    # Inspect DB samples
npx ts-node purge_db.ts        # Wipe the SQLite database
```

Historical backfill / hypothesis testing is done in Dune Analytics using the
queries in [`dune_queries.sql`](dune_queries.sql) (large bets, wallet age at
trade time, same-source funding clusters). These run in the Dune web UI and are
not part of the live pipeline.

Oracle Cloud provisioner (independent infrastructure helper):

```bash
php verify_resources.php   # Discover OCID values to put in .env (read-only)
php index.php              # Poll OCI to create an ARM instance when free
```

> There is no automated test suite and no lint configuration.

## Data sources

- **Polymarket Gamma API** — discovers political prediction markets by keyword
  and reads market resolution/prices (`gamma-api.polymarket.com`).
- **Polygon (Alchemy)** — real-time `OrderFilled` events from the CTF Exchange,
  plus block-timestamp lookups (`wss://polygon-mainnet.g.alchemy.com`).
- **Etherscan V2 (Polygon)** — wallet transaction history, funding source, and
  DeFi activity via the multichain endpoint (`api.etherscan.io/v2/api`,
  `chainid=137`).
- **Dune Analytics** — offline backfill and historical validation only.
- **Telegram** — human-facing alert delivery and dashboard.

## Architecture

The repository contains **two independent components** that share a directory
but have no code-level integration.

### 1. TypeScript detection engine (`src/`) — the core product

Data flows from a blockchain event through the pipeline and scoring engine to a
Telegram alert. State lives in a local SQLite database at `data/polymarket.db`
(created automatically on first run) with tables `wallets`, `trades`,
`clusters`, `monitored_markets`, `price_history`, and `system_state`.

`index.ts` orchestrates startup and owns all schedulers. `pipeline.ts` is the
per-trade entry point: it filters by market and size, profiles the wallet
(`polygonscanAPI.ts`), scores it immediately (`scoringEngine.ts`), persists to
SQLite, and alerts via `telegramBot.ts` when the score crosses a tier
(suspicion at ≥40, red alert at ≥85). `deferredScoring.ts` runs on a timer to
add history-dependent signals.

### 2. PHP provisioner (`index.php`) — deployment infrastructure

A standalone Oracle Cloud helper (a fork of the `hitrov/oci-arm-host-capacity`
approach) that polls the OCI REST API to create an "Always Free" ARM instance
(`VM.Standard.A1.Flex`) when free-tier capacity becomes available. It signs
requests with `hitrov/oci-api-php-request-sign` and loads config from `.env` via
`phpdotenv`. Its only relationship to the detection engine is operational: it
provisions the always-on host the engine is intended to run on. It shares no
logic, no runtime, and no config variables with `src/`. `verify_resources.php`
and `test_ssl.php` are read-only helpers for validating OCI credentials and
connectivity.

## Security

- Report vulnerabilities privately to **yohanmichau1@gmail.com** — see
  [SECURITY.md](SECURITY.md).
- Secrets belong in `.env` (gitignored). Only `.env.example` is tracked, and it
  contains placeholders only.
- The detection engine and provisioner handle live API keys and an OCI private
  key; keep both out of version control.
- Contribution conventions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Proprietary — All rights reserved, © 2026 Yohan Michau. See [LICENSE](LICENSE).
