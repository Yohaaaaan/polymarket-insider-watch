# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue, and
do not disclose the problem publicly until it has been addressed.

Email: **yohanmichau1@gmail.com**

Include, where possible:

- A description of the issue and its potential impact.
- Steps to reproduce or a proof of concept.
- Any relevant logs (with secrets redacted).

You can expect an acknowledgement within a reasonable delay. Please act in
good faith and avoid privacy violations, data destruction, or service
disruption while investigating.

## Secret handling — critical

This project relies on API keys and tokens (blockchain RPC, PolygonScan,
Telegram bot, Oracle Cloud API key). Treat all of them as sensitive.

- **Never commit `.env`.** It is gitignored on purpose. Only `.env.example`
  (placeholders, no real values) is tracked.
- **Never commit private keys** (`*.pem`, `*.key`). These are gitignored too.
- Before every commit, verify nothing sensitive is staged:

  ```bash
  git ls-files | grep -E '\.env$|\.pem$|\.key$|node_modules|vendor/|venv/|/data/'
  # (must return nothing)
  ```

- If a secret is ever exposed in a commit, **rotate the affected credential
  immediately** (it must be considered compromised even after removal), then
  purge it from history.

## Scope

This tool observes **public** on-chain data and public prediction-market
activity. It must not be used to target private individuals' non-public data,
and any use must comply with applicable laws and the terms of the third-party
APIs it consumes.
