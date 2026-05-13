# Security Policy

This project can interact with Ethereum mainnet if `RUN_TX=true`. Treat it as high risk.

## Rules

- Use a burner wallet only.
- Never use a wallet with valuable assets.
- Never share private keys in chat, issues, screenshots, logs, or commits.
- Keep private keys only in local `.env` on your VPS.
- Keep `RUN_TX=false` for read-only and dry-run testing.
- Start with a tiny `BUDGET_ETH`.
- Keep `REPORT=off` unless you explicitly opt in to telemetry.

## Reporting issues

Do not include secrets or private keys in bug reports. Redact RPC keys, wallet keys, and transaction signing data.
