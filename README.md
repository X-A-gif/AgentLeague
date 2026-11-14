# Aster research desk

A single-operator desk for Aster USDT-margined perpetuals. This build is **research mode only**. It reads public market data for BTCUSDT and ETHUSDT, calculates indicators, writes an append-only decision log, and shows what the risk engine would do. It does not connect a wallet and it cannot place, cancel, transfer, or withdraw.

The design is in [docs/DESIGN.md](docs/DESIGN.md). Verified API notes are in [docs/ASTER_API_NOTES.md](docs/ASTER_API_NOTES.md).

## Run

Requires Node 22.

```bash
npm install
npm test
npm run dev:desk
npm run dev:web
```

The desk listens on [http://127.0.0.1:47221](http://127.0.0.1:47221). The research page is [http://127.0.0.1:47223](http://127.0.0.1:47223).

`STAND_DOWN=1 npm run dev:desk` keeps the news flag at stand-down, so the strategy agent emits no tickets.

## Check Aster's public API

```bash
python3 scripts/verify_aster_public.py
```

No key and no wallet. The script calls public futures endpoints only.
