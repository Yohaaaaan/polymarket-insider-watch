# Contributing

This is a **private, proprietary** repository (see [LICENSE](LICENSE)).
Contributions are limited to authorized collaborators. If you have access,
please follow the conventions below.

## Local setup

The repository ships **without** vendored dependencies — `node_modules/`,
`vendor/`, `venv/`, `data/`, and `dist/` are gitignored. Install them locally
before running anything:

```bash
# TypeScript detection engine
npm install

# PHP provisioner (optional, only needed for index.php)
composer install
```

Then create your local secrets file (never commit it):

```bash
cp .env.example .env
# edit .env with your own keys — see the Configuration section of the README
```

## Branching & commits

- Work on a feature branch, open a pull request against `main`.
- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`.
- Keep commits focused and atomic; write imperative, present-tense subjects.

## Code conventions

- **TypeScript** (`src/`): target/settings come from `tsconfig.json`.
  Verify a clean build before pushing:
  ```bash
  npm run build      # tsc
  ```
- **PHP** (`index.php`, `*.php`): PSR-4 autoloading under the `src/`
  namespace declared in `composer.json`. Check syntax with:
  ```bash
  php -l index.php
  ```
- Prefer small, self-describing functions; match the surrounding style.

## Before you push — secret hygiene

Never commit real credentials. Confirm the working tree is clean of secrets:

```bash
git ls-files | grep -E '\.env$|\.pem$|\.key$|node_modules|vendor/|venv/|/data/'
# (must return nothing)
```

If you accidentally staged a secret, unstage it and rotate the key immediately.
See [SECURITY.md](SECURITY.md) for reporting.
