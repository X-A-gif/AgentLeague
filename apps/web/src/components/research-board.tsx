"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Decision = {
  ticket: {
    side: "LONG" | "SHORT";
    setup: string;
    entry: number;
    stop: number;
    targets: number[];
  };
  risk: {
    action: "approve" | "reject";
    reason: string;
    qty: number | null;
    leverage: number | null;
    rewardRisk: number | null;
  };
  headNote: string;
};

type SymbolView = {
  symbol: string;
  quote: {
    mark: number;
    index: number;
    fundingRate: number;
    nextFundingTime: number;
    bid: number;
    ask: number;
  } | null;
  lastPrice: number | null;
  pass: {
    market: { regime?: string; spreadBps?: number | null; summary?: string };
    technical: {
      summary?: string;
      rsiByTimeframe?: Record<string, number | null>;
      ema20?: number;
      ema50?: number;
      vwap?: number;
      macdHistogram?: number;
    };
    news: { summary?: string; flag?: string };
    decisions: Decision[];
  } | null;
  error: string | null;
};

type PaperPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  entryPrice: number;
  mark: number | null;
  leverage: number;
  unrealizedPnl: number;
  fees: number;
  funding: number;
};

type PaperOrder = {
  symbol: string;
  positionSide: "LONG" | "SHORT";
  type: string;
  qty: number;
  stopPrice: number | null;
  limitPrice: number | null;
  status: string;
};

type Snapshot = {
  mode: string;
  ordersEnabled: boolean;
  headTrader: string;
  updatedAt: number | null;
  hypotheticalEquity: number;
  equityNote: string;
  league?: {
    pool: number;
    teamCapital: number;
    equity: number;
    teams: Array<{
      id: string;
      name: string;
      mandate: string;
      strategyId: string;
      strategyVersion: number;
      equity: number;
      startingEquity: number;
      unrealizedPnl: number;
      positions: PaperPosition[];
      orders: PaperOrder[];
      lastSummary: string;
    }>;
  };
  paper?: {
    equity: number;
    unrealizedPnl: number;
    realizedPnl: number;
    fees: number;
    funding: number;
    slippageBps: number;
    takerFeeRate: number;
    makerFeeRate: number;
    positions: PaperPosition[];
    orders: PaperOrder[];
    note: string;
  };
  limits: { version: number; values: Record<string, number> } | null;
  symbols: SymbolView[];
  error: string | null;
};

type FeedEvent = {
  id: string;
  ts: number;
  agent: string;
  kind: string;
  payload: { summary?: string };
};

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"];

export function ResearchBoard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [offline, setOffline] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const [snapshotResponse, eventsResponse] = await Promise.all([
          fetch("/desk/snapshot", { cache: "no-store" }),
          fetch("/desk/events?limit=40", { cache: "no-store" }),
        ]);
        if (!snapshotResponse.ok || !eventsResponse.ok) {
          throw new Error(`Desk responded ${snapshotResponse.status}`);
        }
        const nextSnapshot = (await snapshotResponse.json()) as Snapshot;
        const nextEvents = (await eventsResponse.json()) as { events: FeedEvent[] };
        if (!stopped) {
          setSnapshot(nextSnapshot);
          setEvents(nextEvents.events);
          setOffline(null);
        }
      } catch (error) {
        if (!stopped) setOffline(error instanceof Error ? error.message : "Desk is unreachable");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refreshToken]);

  if (!snapshot && offline) {
    return (
      <StatusCard
        title="The research desk is not running"
        body="Start it with npm run dev:desk, then refresh. This page only reads the local desk. It cannot place an order."
      />
    );
  }

  if (!snapshot) {
    return <StatusCard title="Connecting to the desk" body="Waiting for the first snapshot." />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">Aster perpetuals</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">AI Trading League</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Five paper teams share BTCUSDT and ETHUSDT, the same 2,000 USDT book, the same costs, and the same risk
            veto. They do not see each other’s decisions. Nothing is sent to Aster except public market data.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={snapshot.mode === "halted" ? "destructive" : "default"}>{modeLabel(snapshot.mode)}</Badge>
            <Badge variant="outline">Aster orders disabled</Badge>
            <Badge variant="secondary">Head trader off</Badge>
          </div>
          <DeskControls mode={snapshot.mode} onChanged={() => setRefreshToken((value) => value + 1)} />
        </div>
      </header>
      {snapshot.mode === "halted" ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Desk halted</CardTitle>
            <CardDescription>
              Paper positions were flattened and resting paper orders were cancelled. New trades stay blocked until you
              resume. Resume returns to research and does not turn paper back on by itself.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {offline || snapshot.error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Market data problem</CardTitle>
            <CardDescription>{offline ?? snapshot.error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {snapshot.league ? (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {snapshot.league.teams.map((team) => (
            <Card key={team.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{team.name}</CardTitle>
                    <CardDescription>
                      {team.strategyId} v{team.strategyVersion}. {team.mandate}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{money(team.equity)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm">{team.lastSummary}</p>
                {team.positions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No open paper position. Allocated {money(team.startingEquity)}.</p>
                ) : (
                  team.positions.map((position) => (
                    <p key={`${team.id}-${position.symbol}-${position.side}`} className="font-mono text-xs">
                      {position.side} {position.qty} {position.symbol} @ {priceFmt(position.entryPrice)} uPnL{" "}
                      {signed(position.unrealizedPnl)}
                    </p>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paper pool</CardTitle>
          <CardDescription>{snapshot.paper?.note ?? snapshot.equityNote}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="font-mono text-2xl">{money(snapshot.paper?.equity ?? snapshot.hypotheticalEquity)} USDT</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Limit label="Unrealized" value={signed(snapshot.paper?.unrealizedPnl)} />
            <Limit label="Realized" value={signed(snapshot.paper?.realizedPnl)} />
            <Limit label="Fees" value={signed(snapshot.paper ? -snapshot.paper.fees : undefined)} />
            <Limit label="Funding" value={signed(snapshot.paper?.funding)} />
            <Limit label="Max leverage" value={`${snapshot.limits?.values.maxLeverage ?? "—"}x`} />
            <Limit label="Risk / trade" value={percent(snapshot.limits?.values.riskPerTrade)} />
            <Limit
              label="Updated"
              value={snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : "waiting"}
            />
          </div>
          <PaperLists paper={snapshot.paper} />
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {snapshot.symbols.map((symbol) => (
          <SymbolCard key={symbol.symbol} view={symbol} />
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent log</CardTitle>
          <CardDescription>Newest first. Each row is an append-only decision record.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No observations yet. The first pass runs as soon as candles load.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {events.map((event) => (
                <li key={event.id} className="grid grid-cols-1 gap-1 border-b border-border pb-3 sm:grid-cols-[7.5rem_6rem_1fr]">
                  <span className="font-mono text-xs text-muted-foreground">{new Date(event.ts).toLocaleTimeString()}</span>
                  <span className="text-xs font-medium tracking-wide uppercase">{event.agent}</span>
                  <span className="text-sm">{event.payload.summary ?? event.kind}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SymbolCard({ view }: { view: SymbolView }) {
  const quote = view.quote;
  const technical = view.pass?.technical;
  const price = view.lastPrice ?? quote?.mark;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{view.symbol}</CardTitle>
            <CardDescription>{view.pass?.market.summary ?? "Waiting for the first candle pass."}</CardDescription>
          </div>
          {view.pass?.market.regime ? <Badge variant="secondary">{labelRegime(view.pass.market.regime)}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="font-mono text-3xl">{price ? priceFmt(price) : "—"}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Fact label="Mark" value={quote ? priceFmt(quote.mark) : "—"} />
          <Fact label="Index" value={quote ? priceFmt(quote.index) : "—"} />
          <Fact label="Funding" value={quote ? `${(quote.fundingRate * 100).toFixed(4)}%` : "—"} />
          <Fact label="Next funding" value={quote ? new Date(quote.nextFundingTime).toLocaleTimeString() : "—"} />
          <Fact label="Bid / ask" value={quote ? `${priceFmt(quote.bid)} / ${priceFmt(quote.ask)}` : "—"} />
          <Fact label="Spread" value={bps(view.pass?.market.spreadBps)} />
        </dl>
        <div className="grid grid-cols-5 gap-2">
          {TIMEFRAMES.map((timeframe) => (
            <div key={timeframe} className="rounded-md bg-muted px-2 py-2">
              <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{timeframe} RSI</p>
              <p className="font-mono text-sm">{num(technical?.rsiByTimeframe?.[timeframe])}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{technical?.summary ?? "Indicators have not been calculated."}</p>
        <p className="font-mono text-xs text-muted-foreground">
          EMA20 {num(technical?.ema20)} · EMA50 {num(technical?.ema50)} · VWAP {num(technical?.vwap)} · MACD hist{" "}
          {num(technical?.macdHistogram)}
        </p>
        <div className="flex flex-col gap-2">
          {(view.pass?.decisions.length ?? 0) === 0 ? (
            <p className="text-sm">No ticket on the latest closed 15-minute candle.</p>
          ) : (
            view.pass?.decisions.map((decision) => (
              <div key={`${decision.ticket.side}-${decision.ticket.setup}`} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={decision.ticket.side === "LONG" ? "default" : "destructive"}>{decision.ticket.side}</Badge>
                  <span className="text-sm font-medium">{decision.ticket.setup.replaceAll("_", " ")}</span>
                  <Badge variant={decision.risk.action === "approve" ? "secondary" : "outline"}>
                    Risk would {decision.risk.action}
                  </Badge>
                </div>
                <p className="mt-2 text-sm">
                  Reference entry {priceFmt(decision.ticket.entry)}, stop {priceFmt(decision.ticket.stop)}, target{" "}
                  {priceFmt(decision.ticket.targets[0] ?? 0)}.
                  {decision.risk.action === "approve"
                    ? ` Paper size ${decision.risk.qty} at ${decision.risk.leverage}x.`
                    : ` ${decision.risk.reason}.`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{decision.headNote}</p>
              </div>
            ))
          )}
        </div>
        <p className="text-xs text-muted-foreground">{view.pass?.news.summary}</p>
      </CardContent>
    </Card>
  );
}

function DeskControls({ mode, onChanged }: { mode: string; onChanged: () => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function post(path: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { reason?: string };
        setMessage(body.reason ?? "The desk refused that control.");
      }
      onChanged();
    } catch {
      setMessage("The desk did not answer.");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {mode === "halted" ? (
          <Button disabled={busy} onClick={() => void post("/desk/resume")}>
            Resume to research
          </Button>
        ) : armed ? (
          <Button variant="destructive" disabled={busy} onClick={() => void post("/desk/kill")}>
            Confirm flatten
          </Button>
        ) : (
          <Button variant="destructive" disabled={busy} onClick={() => setArmed(true)}>
            Kill switch
          </Button>
        )}
        {mode === "research" ? (
          <Button variant="outline" disabled={busy} onClick={() => void post("/desk/paper")}>
            Enable paper
          </Button>
        ) : null}
      </div>
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </div>
  );
}

function modeLabel(mode: string): string {
  if (mode === "halted") return "Halted";
  if (mode === "research") return "Research";
  return "Paper";
}

function PaperLists({ paper }: { paper: Snapshot["paper"] }) {
  if (!paper || (paper.positions.length === 0 && paper.orders.length === 0)) {
    return (
      <p className="text-sm text-muted-foreground">
        No paper position yet. The next approved 15-minute setup opens one. Until then this book stays flat.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {paper.positions.map((position) => (
        <div key={`${position.symbol}-${position.side}`} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={position.side === "LONG" ? "default" : "destructive"}>{position.side}</Badge>
            <span className="text-sm font-medium">{position.symbol}</span>
            <span className="font-mono text-sm">{position.qty}</span>
            <span className="text-xs text-muted-foreground">{position.leverage}x paper</span>
          </div>
          <p className="mt-2 text-sm">
            Entry {priceFmt(position.entryPrice)} · mark {position.mark === null ? "—" : priceFmt(position.mark)} ·
            unrealized {signed(position.unrealizedPnl)}
          </p>
        </div>
      ))}
      {paper.orders.map((order, index) => (
        <p key={`${order.symbol}-${order.type}-${index}`} className="font-mono text-xs text-muted-foreground">
          Resting {order.type.replaceAll("_", " ").toLowerCase()} {order.positionSide} {order.symbol} qty {order.qty}
          {order.stopPrice !== null ? ` at ${priceFmt(order.stopPrice)}` : ""}
          {order.limitPrice !== null ? ` limit ${priceFmt(order.limitPrice)}` : ""}
        </p>
      ))}
    </div>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">
      {label} <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

function money(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function priceFmt(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 1 : 2,
    maximumFractionDigits: value >= 1000 ? 1 : 2,
  });
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function signed(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const formatted = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function percent(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function bps(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)} bps`;
}

function labelRegime(regime: string): string {
  return regime.replaceAll("_", " ");
}
