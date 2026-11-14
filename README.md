# Aster trading desk

Stage 0 is a design for a single-operator desk that researches crypto perpetuals and, later, trades them on Aster. The dashboard and the worker are not built yet. Review the design before any application code.

- [Design](docs/DESIGN.md) — architecture, stack, agents, MetaMask, Aster, security, and the staged build.
- [Aster API notes](docs/ASTER_API_NOTES.md) — what the official docs say, what a live public call returned on 2026-11-14, and what is still unresolved.

## Check the public API

No key and no wallet:

```bash
python3 scripts/verify_aster_public.py
```

The script calls Aster's public futures market-data endpoints and one public mark-price websocket. It prints a JSON report and exits 0 when those checks return HTTP 200 or a websocket `101`.

## What this stage does not do

It does not place orders, ask for a seed phrase, or start a web server. Live trading stays out of the product until the later stage described in the design, and it stays off by default even then.
