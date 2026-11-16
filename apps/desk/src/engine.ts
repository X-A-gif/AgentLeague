import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  PublicAsterClient,
  marketStreamUrl,
  type Candle,
  type Interval,
  type SymbolFilters,
} from "@aster/client";
import WebSocket from "ws";
import { INTERVALS, SYMBOLS, dataFile, restBase, standDown, wsBase } from "./config.js";
import { DecisionLog } from "./log.js";
import { League, runLeagueSymbol, notionalOf } from "./league/run.js";
import type { LeagueEvent } from "./league/run.js";
import { PaperBook, type PaperAction, type PaperView } from "./paperBook.js";
import { runResearch, type Quote, type ResearchPass } from "./research.js";
import {
  CLOCK_JUMP_MS,
  FIFTEEN_MINUTES_MS,
  STREAM_STALE_MS,
  ScanScheduler,
  crossedBoundary,
  isScanKline,
} from "./schedule.js";

export type SymbolView = {
  symbol: string;
  filters: SymbolFilters | null;
  quote: Quote | null;
  lastPrice: number | null;
  pass: ResearchPass | null;
  error: string | null;
};

export type DeskSnapshot = {
  mode: "research" | "paper" | "halted";
  ordersEnabled: false;
  headTrader: "disabled";
  updatedAt: number | null;
  hypotheticalEquity: number;
  equityNote: string;
  paper: PaperView;
  league: ReturnType<League["view"]>;
  limits: { version: number; values: Record<string, number> } | null;
  rateLimits: Array<{ rateLimitType: string; interval: string; intervalNum: number; limit: number }>;
  symbols: SymbolView[];
  error: string | null;
};

type Books = Record<Interval, Candle[]>;

export class ResearchDesk {
  readonly client: PublicAsterClient;
  readonly log: DecisionLog;
  private readonly paper: PaperBook;
  private readonly league: League;
  private readonly filters = new Map<string, SymbolFilters>();
  private readonly quotes = new Map<string, Quote>();
  private readonly lastPrice = new Map<string, number>();
  private readonly books = new Map<string, Books>();
  private readonly passes = new Map<string, ResearchPass>();
  private rateLimits: DeskSnapshot["rateLimits"] = [];
  private updatedAt: number | null = null;
  private scanAt: number | null = null;
  private lastScheduledBucket: number | null = null;
  private error: string | null = null;
  private refreshing: Promise<void> | null = null;
  private scanQueued: string | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private scheduler: ScanScheduler | null = null;
  private stopped = false;
  private reconnectDelay = 1_000;
  private lastMessageAt = 0;
  private lastClock = 0;

  constructor(log: DecisionLog, client = new PublicAsterClient(restBase()), filename = dataFile()) {
    this.log = log;
    this.client = client;
    this.paper = new PaperBook(filename);
    this.league = new League(path.join(path.dirname(filename), "league"));
  }

  snapshot(): DeskSnapshot {
    const limits = this.log.activeLimits();
    const marks = this.marks();
    const league = this.league.view(marks);
    const paper = this.paper.view(marks);
    return {
      mode: this.league.mode(),
      ordersEnabled: false,
      headTrader: "disabled",
      updatedAt: this.updatedAt,
      hypotheticalEquity: league.equity,
      equityNote: "Five teams share the same prices, universe, costs, and risk limits. Each starts with 2,000 of a 10,000 paper pool. This is not an Aster balance.",
      paper,
      league,
      limits: limits ? { version: limits.id, values: limits.limits } : null,
      rateLimits: this.rateLimits,
      symbols: SYMBOLS.map((symbol) => ({
        symbol,
        filters: this.filters.get(symbol) ?? null,
        quote: this.quotes.get(symbol) ?? null,
        lastPrice: this.lastPrice.get(symbol) ?? null,
        pass: this.passes.get(symbol) ?? null,
        error: this.filters.has(symbol) ? null : this.error,
      })),
      error: this.error,
    };
  }

  lastScanAt(): number | null {
    return this.scanAt;
  }

  async start(): Promise<void> {
    await this.refresh("startup");
    this.lastClock = Date.now();
    this.scheduler = new ScanScheduler((reason) => {
      void this.refresh(reason);
    });
    this.scheduler.start();
    this.watchTimer = setInterval(() => this.watchStream(), 5_000);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.scheduler?.stop();
    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.watchTimer = null;
    this.reconnectTimer = null;
    this.socket?.terminate();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const streams = SYMBOLS.flatMap((symbol) => {
      const lower = symbol.toLowerCase();
      return [`${lower}@kline_1m`, `${lower}@kline_15m`, `${lower}@markPrice@1s`, `${lower}@bookTicker`];
    });
    const socket = new WebSocket(marketStreamUrl(wsBase(), streams));
    this.socket = socket;
    socket.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      this.onMessage(raw.toString());
    });
    socket.on("open", () => {
      this.reconnectDelay = 1_000;
      this.lastMessageAt = Date.now();
      this.error = null;
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    });
    socket.on("error", (error) => {
      this.error = error.message;
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const wait = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
  }

  private watchStream(): void {
    const now = Date.now();
    const previous = this.lastClock || now;
    this.lastClock = now;
    if (now - previous > CLOCK_JUMP_MS) {
      this.dropSocket();
      if (crossedBoundary(previous, now)) void this.refresh("clock-jump");
    }
    const quiet = this.lastMessageAt > 0 && now - this.lastMessageAt > STREAM_STALE_MS;
    if (this.socket && this.socket.readyState === WebSocket.OPEN && quiet) this.dropSocket();
  }

  private onMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const data = unwrap(message);
    if (!data || typeof data !== "object") return;
    const event = data as Record<string, unknown>;
    if (event.e === "markPriceUpdate") {
      const symbol = String(event.s);
      const current = this.quotes.get(symbol);
      this.quotes.set(symbol, {
        mark: Number(event.p),
        index: Number(event.i),
        fundingRate: Number(event.r),
        nextFundingTime: Number(event.T),
        bid: current?.bid ?? Number(event.p),
        ask: current?.ask ?? Number(event.p),
      });
      this.applyQuote(symbol);
    } else if (event.e === "bookTicker") {
      const symbol = String(event.s);
      const current = this.quotes.get(symbol);
      if (!current) return;
      this.quotes.set(symbol, { ...current, bid: Number(event.b), ask: Number(event.a) });
    } else if (event.e === "kline") {
      const kline = event.k as Record<string, unknown> | undefined;
      if (!kline) return;
      if (kline.c !== undefined) this.lastPrice.set(String(kline.s ?? event.s), Number(kline.c));
      if (isScanKline(kline)) void this.refresh("15m-close");
    }
  }

  private refresh(reason: string): Promise<void> {
    if (this.refreshing) {
      this.scanQueued = reason;
      return this.refreshing;
    }
    const run = this.refreshNow(reason).finally(() => {
      this.refreshing = null;
      const queued = this.scanQueued;
      this.scanQueued = null;
      if (queued && !this.stopped) void this.refresh(queued);
    });
    this.refreshing = run;
    return run;
  }

  private async refreshNow(reason: string): Promise<void> {
    const bucket = Math.floor(Date.now() / FIFTEEN_MINUTES_MS);
    if (reason !== "startup" && this.lastScheduledBucket === bucket) return;
    try {
      const info = await this.client.exchangeInfo(SYMBOLS);
      this.rateLimits = info.rateLimits;
      for (const symbol of info.symbols) this.filters.set(symbol.symbol, symbol);
      const now = Date.now();
      const limits = this.log.activeLimits();
      if (!limits) throw new Error("Risk limits are not confirmed");
      for (const symbol of SYMBOLS) {
        const filters = this.filters.get(symbol);
        if (!filters || filters.status !== "TRADING") {
          throw new Error(`${symbol} is not in TRADING status`);
        }
        const books = await this.loadBooks(symbol, now);
        this.books.set(symbol, books);
        const premium = await this.client.premiumIndex(symbol);
        const book = await this.client.bookTicker(symbol);
        const quote: Quote = {
          mark: premium.markPrice,
          index: premium.indexPrice,
          fundingRate: premium.lastFundingRate,
          nextFundingTime: premium.nextFundingTime,
          bid: book.bidPrice,
          ask: book.askPrice,
        };
        this.quotes.set(symbol, quote);
        this.lastPrice.set(symbol, books["15m"].at(-1)?.close ?? premium.markPrice);
        const pass = runResearch({
          symbol,
          filters,
          quote,
          candles: books,
          limits: limits.limits,
          limitVersion: limits.id,
          account: this.paper.accountState(this.marks(), now),
          now,
          standDown: standDown(),
        });
        this.passes.set(symbol, pass);
        this.record(pass, reason, now);
        let depth = null;
        try {
          const ladder = await this.client.depth(symbol, 20);
          depth = {
            bidNotional: notionalOf(ladder.bids),
            askNotional: notionalOf(ladder.asks),
            levels: ladder.bids.length,
          };
        } catch {
          depth = null;
        }
        const leagueEvents = runLeagueSymbol({
          symbol,
          candles: books,
          quote,
          depth,
          filters,
          books: this.league.books,
          limits: limits.limits,
          limitVersion: limits.id,
          now,
          standDown: standDown() || this.league.isHalted() || this.league.mode() !== "paper",
          marks: this.marks(),
        });
        this.league.note(leagueEvents);
        this.logLeague(leagueEvents, now);
        this.applyQuote(symbol);
      }
      this.updatedAt = now;
      this.scanAt = now;
      this.lastScheduledBucket = bucket;
      this.error = null;
      console.log(`scan ${reason} ${new Date(now).toISOString()}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.log.append({
        ts: Date.now(),
        agent: "market",
        kind: "observation",
        correlationId: null,
        parentIds: [],
        payload: { summary: `Market data refresh failed: ${this.error}`, reason },
        valid: false,
      });
    }
  }

  private async loadBooks(symbol: string, now: number): Promise<Books> {
    const entries = await Promise.all(
      INTERVALS.map(async (interval) => {
        const rows = await this.client.klines(symbol, interval, interval === "1d" ? 200 : 300);
        return [interval, rows.filter((candle) => candle.closeTime <= now)] as const;
      }),
    );
    return Object.fromEntries(entries) as Books;
  }

  private marks(): Record<string, number> {
    return Object.fromEntries([...this.quotes].map(([symbol, quote]) => [symbol, quote.mark]));
  }

  private applyQuote(symbol: string): void {
    const quote = this.quotes.get(symbol);
    if (!quote) return;
    const actions = [
      ...this.paper.onQuote(
        symbol,
        { mark: quote.mark, fundingRate: quote.fundingRate, nextFundingTime: quote.nextFundingTime },
        Date.now(),
      ),
      ...this.league.onQuote(
        symbol,
        { mark: quote.mark, fundingRate: quote.fundingRate, nextFundingTime: quote.nextFundingTime },
        Date.now(),
      ),
    ];
    for (const action of actions) {
      this.log.append({
        ts: Date.now(),
        agent: "execution",
        kind: action.kind === "reject" || action.kind === "skip" ? "observation" : "fill",
        correlationId: null,
        parentIds: [],
        payload: { summary: action.summary, ...action.payload },
      });
    }
    if (actions.length > 0) this.updatedAt = Date.now();
  }

  kill(): PaperAction[] {
    const quotes = Object.fromEntries(
      [...this.quotes].map(([symbol, quote]) => [symbol, { bid: quote.bid, ask: quote.ask, mark: quote.mark }]),
    );
    const actions = [...this.paper.kill(quotes, Date.now()), ...this.league.kill(quotes, Date.now())];
    this.logActions(actions);
    this.updatedAt = Date.now();
    return actions;
  }

  resume(): void {
    this.paper.resumeToResearch();
    this.league.resumeToResearch();
    this.log.append({
      ts: Date.now(),
      agent: "operator",
      kind: "config_change",
      correlationId: null,
      parentIds: [],
      payload: { summary: "Halt cleared. Desk is in research mode and will not paper-fill." },
    });
    this.updatedAt = Date.now();
  }

  enablePaper(): { ok: boolean; reason: string } {
    const legacy = this.paper.enablePaper();
    const result = legacy.ok ? this.league.enablePaper() : legacy;
    this.log.append({
      ts: Date.now(),
      agent: "operator",
      kind: "config_change",
      correlationId: null,
      parentIds: [],
      payload: { summary: result.reason },
    });
    this.updatedAt = Date.now();
    return result;
  }

  private logActions(actions: PaperAction[]): void {
    for (const action of actions) {
      this.log.append({
        ts: Date.now(),
        agent: "execution",
        kind: action.kind === "fill" ? "fill" : "halt",
        correlationId: null,
        parentIds: [],
        payload: { summary: action.summary, ...action.payload },
      });
    }
  }

  private record(
    pass: ResearchPass,
    reason: string,
    now: number,
  ): void {
    const correlationId = pass.candleOpenTime ? `${pass.symbol}-15m-${pass.candleOpenTime}` : null;
    if (correlationId && this.log.hasCorrelation(correlationId)) return;
    const market = this.log.append({
      ts: now,
      agent: "market",
      kind: "observation",
      correlationId,
      parentIds: [],
      payload: { ...pass.market, refresh: reason },
    });
    const technical = this.log.append({
      ts: now,
      agent: "technical",
      kind: "observation",
      correlationId,
      parentIds: [market.id],
      payload: pass.technical,
    });
    const news = this.log.append({
      ts: now,
      agent: "news",
      kind: "observation",
      correlationId,
      parentIds: [technical.id],
      payload: pass.news,
    });
    this.log.append({
      ts: now,
      agent: "market",
      kind: "observation",
      correlationId,
      parentIds: [news.id],
      payload: { summary: `${pass.symbol} shared scan is context for the five teams. ${String(pass.technical.summary ?? "")}` },
    });
  }

  private logLeague(events: LeagueEvent[], now: number): void {
    for (const event of events) {
      this.log.append({
        ts: now,
        agent: event.agent,
        kind: event.kind,
        correlationId: event.teamId === "league" ? null : `${event.teamId}-${now}`,
        parentIds: [],
        payload: { summary: event.summary, ...event.payload },
      });
    }
  }
}

function unwrap(message: unknown): unknown {
  if (message && typeof message === "object" && "data" in message) {
    return (message as { data: unknown }).data;
  }
  return message;
}

export function openLog(filename: string): DecisionLog {
  mkdirSync(path.dirname(filename), { recursive: true });
  return new DecisionLog(filename);
}
