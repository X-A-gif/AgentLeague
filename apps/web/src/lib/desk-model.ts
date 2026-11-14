export type Side = "LONG" | "SHORT";

export type Decision = {
  ticket: {
    side: Side;
    setup: string;
    entry: number;
    stop: number;
    targets: number[];
  };
  risk: {
    action: "approve" | "reject";
    reason: string;
    code?: string;
    qty: number | null;
    leverage: number | null;
    rewardRisk: number | null;
  };
  headNote: string;
};

export type SymbolView = {
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

export type PaperPosition = {
  symbol: string;
  side: Side;
  qty: number;
  entryPrice: number;
  mark: number | null;
  leverage: number;
  unrealizedPnl: number;
  fees: number;
  funding: number;
};

export type PaperOrder = {
  symbol: string;
  positionSide: Side;
  type: string;
  qty: number;
  stopPrice: number | null;
  limitPrice: number | null;
  status: string;
};

export type TeamView = {
  id: string;
  name: string;
  mandate: string;
  strategyId: string;
  strategyVersion: number;
  equity: number;
  startingEquity: number;
  unrealizedPnl: number;
  realizedPnl?: number;
  fees?: number;
  funding?: number;
  positions: PaperPosition[];
  orders: PaperOrder[];
  lastSummary: string;
};

export type Snapshot = {
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
    teams: TeamView[];
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
    startingEquity?: number;
    positions: PaperPosition[];
    orders: PaperOrder[];
    note: string;
  };
  limits: { version: number; values: Record<string, number> } | null;
  rateLimits?: Array<{ rateLimitType: string; interval: string; intervalNum: number; limit: number }>;
  symbols: SymbolView[];
  error: string | null;
};

export type FeedEvent = {
  id: string;
  ts: number;
  agent: string;
  kind: string;
  payload: Record<string, unknown>;
};

export type Tone = "ok" | "bad" | "warn" | "mute";

export type ModePill = {
  label: "RESEARCH" | "PAPER" | "LIVE" | "HALTED" | "LIVE DISABLED";
  tone: Tone | "live";
};

export const TABS = ["monitor", "teams", "fills", "pnl", "risk", "regime", "log"] as const;
export type TabId = (typeof TABS)[number];

export const TAB_LABELS: Record<TabId, string> = {
  monitor: "1) MONITOR",
  teams: "2) TEAMS",
  fills: "3) FILLS",
  pnl: "4) P&L",
  risk: "5) RISK",
  regime: "6) REGIME",
  log: "7) LOG",
};

export type FeedRow = {
  id: string;
  time: string;
  who: string;
  detail: string;
  badge: string;
  tone: Tone;
};

export type ChartLevel = {
  price: number;
  label: string;
  tone: "entry" | "stop" | "target" | "exit";
};

export type Funnel = {
  windowLabel: string;
  signals: number;
  passedFilters: number;
  passedRisk: number;
  filled: number;
};

const LIMIT_LABELS: Record<string, string> = {
  maxLeverage: "Max leverage",
  riskPerTrade: "Risk per trade",
  maxPositionNotionalPct: "Max position",
  maxGrossExposurePct: "Max gross exposure",
  maxDailyLossPct: "Max daily loss",
  maxConsecutiveLosses: "Max loss streak",
  maxDrawdownPct: "Max drawdown",
  minRewardRisk: "Min reward / risk",
  slippageAbortBps: "Slippage abort",
};

export function modePill(input: { mode: string; ordersEnabled: boolean }): ModePill {
  if (input.mode === "halted") return { label: "HALTED", tone: "bad" };
  if (input.ordersEnabled) return { label: "LIVE", tone: "live" };
  if (input.mode === "paper") return { label: "PAPER", tone: "ok" };
  if (input.mode === "research") return { label: "RESEARCH", tone: "warn" };
  return { label: "LIVE DISABLED", tone: "warn" };
}

export function eventText(event: FeedEvent): string {
  const summary = event.payload.summary;
  if (typeof summary === "string" && summary.trim()) return summary;
  const reasoning = event.payload.reasoning;
  if (typeof reasoning === "string" && reasoning.trim()) return reasoning;
  return event.kind;
}

export function utcClock(now: number | null): string {
  if (now === null) return "--:--:--";
  return new Date(now).toISOString().slice(11, 19);
}

export function utcTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

export function money(value: number, digits = 2): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(value: number, digits = 2): string {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function toneOf(value: number): Tone {
  if (value > 0) return "ok";
  if (value < 0) return "bad";
  return "mute";
}

export function priceFmt(value: number): string {
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function qtyFmt(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function percent(value: number | undefined, digits = 2): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function bps(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)} bps`;
}

export function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function teamsOf(snapshot: Snapshot): TeamView[] {
  return snapshot.league?.teams ?? [];
}

export function sessionPnl(snapshot: Snapshot): {
  start: number;
  equity: number;
  pnl: number;
  realized: number;
  unrealized: number;
  fees: number;
  funding: number;
  openPositions: number;
} | null {
  const league = snapshot.league;
  if (!league) return null;
  const teams = league.teams;
  const realized = teams.reduce((sum, team) => sum + (team.realizedPnl ?? 0), 0);
  const unrealized = teams.reduce((sum, team) => sum + team.unrealizedPnl, 0);
  const fees = teams.reduce((sum, team) => sum + (team.fees ?? 0), 0);
  const funding = teams.reduce((sum, team) => sum + (team.funding ?? 0), 0);
  const openPositions = teams.reduce((sum, team) => sum + team.positions.length, 0);
  return {
    start: league.pool,
    equity: league.equity,
    pnl: league.equity - league.pool,
    realized,
    unrealized,
    fees,
    funding,
    openPositions,
  };
}

export function grossNotional(snapshot: Snapshot): number {
  return teamsOf(snapshot).reduce(
    (sum, team) =>
      sum +
      team.positions.reduce((inner, position) => {
        const mark = position.mark ?? position.entryPrice;
        return inner + Math.abs(position.qty * mark);
      }, 0),
    0,
  );
}

export function limitRows(snapshot: Snapshot): Array<{ label: string; value: string }> {
  if (!snapshot.limits) return [];
  return Object.entries(snapshot.limits.values).map(([key, value]) => ({
    label: LIMIT_LABELS[key] ?? key,
    value: formatLimit(key, value),
  }));
}

function formatLimit(key: string, value: number): string {
  if (key === "maxLeverage" || key === "maxConsecutiveLosses" || key === "minRewardRisk") {
    return key === "maxLeverage" ? `${value}x` : String(value);
  }
  if (key.endsWith("Bps")) return `${value} bps`;
  if (value <= 1) return percent(value, value < 0.01 ? 2 : 1);
  return String(value);
}

function isFundingFill(event: FeedEvent): boolean {
  return eventText(event).toLowerCase().startsWith("paper funding");
}

function isPassObservation(event: FeedEvent): boolean {
  return event.kind === "observation" && eventText(event).toLowerCase().includes("passed on");
}

export function riskAction(event: FeedEvent): "approve" | "reject" | "unknown" {
  const action = event.payload.action;
  if (action === "approve" || action === "reject") return action;
  const summary = eventText(event).toLowerCase();
  if (summary.includes("veto") || summary.includes("reject")) return "reject";
  if (summary.includes("approved")) return "approve";
  return "unknown";
}

export function funnel(events: FeedEvent[], now: number): Funnel {
  const hour = now - 60 * 60 * 1000;
  const oldest = events.reduce((min, event) => Math.min(min, event.ts), Number.POSITIVE_INFINITY);
  const hourIsComplete = events.length === 0 || events.length < 200 || oldest < hour;
  const window = hourIsComplete ? events.filter((event) => event.ts >= hour) : events;
  const windowLabel =
    events.length === 0 ? "NO EVENTS YET" : hourIsComplete ? "LAST 60 MIN" : "LATEST 200 EVENTS";
  let signals = 0;
  let passedFilters = 0;
  let passedRisk = 0;
  let filled = 0;
  for (const event of window) {
    if (event.kind === "ticket" || isPassObservation(event)) signals += 1;
    if (event.kind === "ticket") passedFilters += 1;
    if (event.kind === "risk_decision" && riskAction(event) === "approve") passedRisk += 1;
    if (event.kind === "fill" && !isFundingFill(event)) filled += 1;
  }
  return { windowLabel, signals, passedFilters, passedRisk, filled };
}

export function feedRows(events: FeedEvent[], limit = 16): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const event of events) {
    const row = toFeedRow(event);
    if (!row) continue;
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

function toFeedRow(event: FeedEvent): FeedRow | null {
  if (event.agent === "market" || event.agent === "technical" || event.agent === "news") return null;
  const detail = eventText(event);
  const time = utcTime(event.ts);
  const who = event.agent.toUpperCase();
  if (event.kind === "ticket") {
    return { id: event.id, time, who, detail, badge: "SIGNAL", tone: "warn" };
  }
  if (event.kind === "risk_decision") {
    const action = riskAction(event);
    return {
      id: event.id,
      time,
      who,
      detail,
      badge: action === "approve" ? "APPROVED" : "VETOED",
      tone: action === "approve" ? "ok" : "bad",
    };
  }
  if (event.kind === "fill") {
    if (isFundingFill(event)) return { id: event.id, time, who, detail, badge: "FUNDING", tone: "mute" };
    const summary = detail.toLowerCase();
    if (summary.includes("stop")) return { id: event.id, time, who, detail, badge: "STOP", tone: "bad" };
    if (summary.includes("target")) return { id: event.id, time, who, detail, badge: "TARGET", tone: "ok" };
    return { id: event.id, time, who, detail, badge: "FILLED", tone: "ok" };
  }
  if (event.kind === "halt") return { id: event.id, time, who, detail, badge: "HALTED", tone: "bad" };
  if (event.kind === "config_change") return { id: event.id, time, who, detail, badge: "MODE", tone: "warn" };
  if (isPassObservation(event)) return { id: event.id, time, who, detail, badge: "PASS", tone: "mute" };
  if (event.kind === "observation" && detail.toLowerCase().includes("stood down")) {
    return { id: event.id, time, who, detail, badge: "STAND DOWN", tone: "warn" };
  }
  if (event.kind === "observation" && (detail.toLowerCase().includes("blocked") || detail.toLowerCase().includes("veto"))) {
    return { id: event.id, time, who, detail, badge: "VETOED", tone: "bad" };
  }
  return null;
}

export function executionRows(events: FeedEvent[], limit = 16): FeedRow[] {
  return feedRows(events, events.length).filter((row) => row.badge !== "SIGNAL" && row.badge !== "PASS").slice(0, limit);
}

export function fillRows(events: FeedEvent[]): FeedRow[] {
  return feedRows(events, events.length).filter((row) =>
    row.badge === "FILLED" || row.badge === "STOP" || row.badge === "TARGET" || row.badge === "FUNDING",
  );
}

export function vetoRows(events: FeedEvent[]): FeedRow[] {
  return feedRows(events, events.length).filter((row) => row.badge === "VETOED" || row.badge === "STAND DOWN");
}

export function chartLevels(snapshot: Snapshot, symbol: string, events: FeedEvent[]): ChartLevel[] {
  const levels: ChartLevel[] = [];
  for (const team of teamsOf(snapshot)) {
    for (const position of team.positions) {
      if (position.symbol !== symbol) continue;
      levels.push({ price: position.entryPrice, label: `${team.name.toUpperCase()} ENTRY`, tone: "entry" });
    }
    for (const order of team.orders) {
      if (order.symbol !== symbol) continue;
      if (order.stopPrice !== null) {
        const stop = order.type.includes("STOP");
        levels.push({
          price: order.stopPrice,
          label: `${team.name.toUpperCase()} ${stop ? "STOP" : "TARGET"}`,
          tone: stop ? "stop" : "target",
        });
      }
      if (order.limitPrice !== null) {
        levels.push({ price: order.limitPrice, label: `${team.name.toUpperCase()} LIMIT`, tone: "entry" });
      }
    }
  }
  for (const position of snapshot.paper?.positions ?? []) {
    if (position.symbol !== symbol) continue;
    levels.push({ price: position.entryPrice, label: "LEGACY ENTRY", tone: "entry" });
  }
  for (const order of snapshot.paper?.orders ?? []) {
    if (order.symbol !== symbol || order.stopPrice === null) continue;
    const stop = order.type.includes("STOP");
    levels.push({
      price: order.stopPrice,
      label: stop ? "LEGACY STOP" : "LEGACY TARGET",
      tone: stop ? "stop" : "target",
    });
  }
  for (const event of events) {
    if (event.kind !== "fill" || isFundingFill(event)) continue;
    if (event.payload.symbol !== symbol) continue;
    const price = event.payload.price;
    if (typeof price !== "number") continue;
    const summary = eventText(event).toLowerCase();
    if (!(summary.includes("closed") || summary.includes("stop") || summary.includes("target"))) continue;
    const partial = summary.includes("partial") || summary.includes("50%");
    levels.push({
      price,
      label: partial ? "PARTIAL EXIT" : summary.includes("stop") ? "STOP EXIT" : "TARGET EXIT",
      tone: "exit",
    });
  }
  return levels;
}

export function markOf(view: SymbolView | undefined): number | null {
  if (!view) return null;
  return view.quote?.mark ?? view.lastPrice;
}

export function openPositions(snapshot: Snapshot, symbol?: string): Array<PaperPosition & { team: string }> {
  const rows: Array<PaperPosition & { team: string }> = [];
  for (const team of teamsOf(snapshot)) {
    for (const position of team.positions) {
      if (symbol && position.symbol !== symbol) continue;
      rows.push({ ...position, team: team.name });
    }
  }
  for (const position of snapshot.paper?.positions ?? []) {
    if (symbol && position.symbol !== symbol) continue;
    rows.push({ ...position, team: "Legacy" });
  }
  return rows;
}

export function contextLine(snapshot: Snapshot): string {
  const names = snapshot.symbols.map((symbol) => symbol.symbol).join(" · ");
  const data = snapshot.updatedAt ? `SCAN ${utcTime(snapshot.updatedAt)} UTC` : "SCAN WAITING";
  return `${names || "NO SYMBOLS"} · ${data}`;
}
