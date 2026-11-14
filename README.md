# AI Trading League

Five independent paper-trading teams share live Aster prices for BTCUSDT and ETHUSDT. Each team starts with 2,000 USDT of a 10,000 USDT pool, uses its own strategy, and keeps its own ledger. The risk engine can veto a trade. The kill switch flattens every team. This program does not connect a wallet and it cannot place, cancel, transfer, or withdraw on Aster.

The page in a cloud workspace is not reachable from your browser. Run it on your own computer.

## Run on your computer

Install Node.js 22 or newer. In a terminal:

```bash
git clone <your-repo-url>
cd <your-repo-directory>
npm install
npm test
```

Then start the two processes in two terminals, from that same directory:

```bash
npm run dev:desk
```

```bash
npm run dev:web
```

Open [http://127.0.0.1:47223](http://127.0.0.1:47223) on that computer. The desk API is [http://127.0.0.1:47221](http://127.0.0.1:47221) and only accepts connections from the same machine.

`STAND_DOWN=1 npm run dev:desk` blocks new paper entries. The kill switch on the page does the same and also closes open paper positions. Resume returns the desk to research. Enable paper is a separate step.

What you should see: five teams (Alpha, Beta, Gamma, Delta, Epsilon), each with a paper equity near 2,000 until a setup passes the risk check. The latest 15-minute candle often produces no trade. That is a real result.

What this build does not do yet: a scored leaderboard, weekly capital reallocation, a regime agent, MetaMask, or live Aster orders. See [docs/LEAGUE_DESIGN.md](docs/LEAGUE_DESIGN.md).

The earlier single-desk design is in [docs/DESIGN.md](docs/DESIGN.md). The league architecture is in [docs/LEAGUE_DESIGN.md](docs/LEAGUE_DESIGN.md). Verified Aster API notes are in [docs/ASTER_API_NOTES.md](docs/ASTER_API_NOTES.md).

## Check Aster's public API

```bash
python3 scripts/verify_aster_public.py
```

No key and no wallet. The script calls public futures endpoints only.
