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
import { PaperBook, type PaperView } from "./paperBook.js";
import { runResearch, type Quote, type ResearchPass } from "./research.js";

export type SymbolView = {
  symbol: string;
  filters: SymbolFilters | null;
  quote: Quote | null;
  lastPrice: number | null;
  pass: ResearchPass | null;
  error: string | null;
};

export type DeskSnapshot = {
  mode: "paper";
  ordersEnabled: false;
  headTrader: "disabled";
  updatedAt: number | null;
  hypotheticalEquity: number;
  equityNote: string;
  paper: PaperView;
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
  private readonly filters = new Map<string, SymbolFilters>();
  private readonly quotes = new Map<string, Quote>();
  private readonly lastPrice = new Map<string, number>();
  private readonly books = new Map<string, Books>();
  private readonly passes = new Map<string, ResearchPass>();
  private rateLimits: DeskSnapshot["rateLimits"] = [];
  private updatedAt: number | null = null;
  private error: string | null = null;
  private refreshing: Promise<void> | null = null;
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectDelay = 1_000;

  constructor(log: DecisionLog, client = new PublicAsterClient(restBase()), filename = dataFile()) {
    this.log = log;
    this.client = client;
    this.paper = new PaperBook(filename);
  }

  snapshot(): DeskSnapshot {
    const limits = this.log.activeLimits();
    const paper = this.paper.view(this.marks());
    return {
      mode: "paper",
      ordersEnabled: false,
      headTrader: "disabled",
      updatedAt: this.updatedAt,
      hypotheticalEquity: paper.equity,
      equityNote: paper.note,
      paper,
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

  async start(): Promise<void> {
    await this.refresh("startup");
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
  }

  private connect(): void {
    if (this.stopped) return;
    const streams = SYMBOLS.flatMap((symbol) => {
      const lower = symbol.toLowerCase();
      return [`${lower}@kline_1m`, `${lower}@markPrice@1s`, `${lower}@bookTicker`];
    });
    const socket = new WebSocket(marketStreamUrl(wsBase(), streams));
    this.socket = socket;
    socket.on("message", (raw) => {
      this.onMessage(raw.toString());
    });
    socket.on("open", () => {
      this.reconnectDelay = 1_000;
      this.error = null;
    });
    socket.on("close", () => {
      if (this.stopped) return;
      const wait = this.reconnectDelay;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      setTimeout(() => this.connect(), wait);
    });
    socket.on("error", (error) => {
      this.error = error.message;
    });
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
      if (!kline || kline.x !== true || kline.i !== "1m") return;
      const symbol = String(kline.s ?? event.s);
      this.lastPrice.set(symbol, Number(kline.c));
      const open = Number(kline.t);
      if (new Date(open).getUTCMinutes() % 15 === 14) {
        void this.refresh("15m-close");
      }
    }
  }

  private async refresh(reason: string): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshNow(reason).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshNow(reason: string): Promise<void> {
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
        this.record(pass, reason, now, filters, quote);
        this.applyQuote(symbol);
      }
      this.updatedAt = now;
      this.error = null;
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
    const actions = this.paper.onQuote(
      symbol,
      { mark: quote.mark, fundingRate: quote.fundingRate, nextFundingTime: quote.nextFundingTime },
      Date.now(),
    );
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

  private record(
    pass: ResearchPass,
    reason: string,
    now: number,
    filters: SymbolFilters,
    quote: Quote,
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
    if (pass.decisions.length === 0) {
      this.log.append({
        ts: now,
        agent: "strategy",
        kind: "observation",
        correlationId,
        parentIds: [news.id],
        payload: { summary: `${pass.symbol}: no ticket. ${String(pass.technical.summary ?? "")}` },
      });
      return;
    }
    for (const decision of pass.decisions) {
      const strategy = this.log.append({
        ts: now,
        agent: "strategy",
        kind: "ticket",
        correlationId,
        parentIds: [news.id],
        payload: {
          summary: `${decision.ticket.side} ${decision.ticket.setup} on ${decision.ticket.symbol}. Reference entry ${decision.ticket.entry}, stop ${decision.ticket.stop}, target ${decision.ticket.targets[0]}. Not an order.`,
          ...decision.ticket,
        },
      });
      const risk = this.log.append({
        ts: now,
        agent: "risk",
        kind: "risk_decision",
        correlationId,
        parentIds: [strategy.id],
        payload: {
          summary:
            decision.risk.action === "approve"
              ? `Approved a paper size of ${decision.risk.qty} ${decision.ticket.symbol} at ${decision.risk.leverage}x. No Aster order.`
              : `Would reject: ${decision.risk.reason}`,
          action: decision.risk.action,
          reason: decision.risk.reason,
          qty: decision.risk.qty,
          notional: decision.risk.notional,
          leverage: decision.risk.leverage,
          riskCash: decision.risk.riskCash,
          rewardRisk: decision.risk.rewardRisk,
          limitVersion: decision.risk.limitVersion,
        },
      });
      this.log.append({
        ts: now,
        agent: "head",
        kind: "head_decision",
        correlationId,
        parentIds: [risk.id],
        payload: { summary: decision.headNote, status: "disabled", qty: decision.headQty },
      });
      if (decision.risk.action === "approve" && decision.headQty && decision.headQty > 0 && decision.risk.leverage) {
        const target = decision.ticket.targets[0];
        if (target === undefined) continue;
        const action = this.paper.submitApproved({
          symbol: decision.ticket.symbol,
          side: decision.ticket.side,
          qty: decision.headQty,
          leverage: decision.risk.leverage,
          stop: decision.ticket.stop,
          target,
          bid: quote.bid,
          ask: quote.ask,
          filters,
          now,
          setup: decision.ticket.setup,
        });
        this.log.append({
          ts: now,
          agent: "execution",
          kind: action.kind === "fill" ? "fill" : "observation",
          correlationId,
          parentIds: [risk.id],
          payload: { summary: action.summary, ...action.payload },
        });
      }
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
