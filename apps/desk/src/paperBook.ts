import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Filters, Side } from "@aster/risk";
import { PAPER_STARTING_EQUITY } from "./config.js";
import {
  PAPER_MAKER_FEE_RATE,
  PAPER_SLIPPAGE_BPS,
  PAPER_TAKER_FEE_RATE,
  feeCash,
  fundingCashflow,
  limitTradedThrough,
  marketFillPrice,
  orderSideFor,
  pricePnl,
  protectionTriggered,
  quantityRejection,
  type OrderSide,
} from "./paper.js";

type OrderType = "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
type OrderStatus = "NEW" | "FILLED" | "CANCELED" | "REJECTED";

type StoredOrder = {
  id: string;
  groupId: string;
  symbol: string;
  positionSide: Side;
  orderSide: OrderSide;
  type: OrderType;
  qty: number;
  price: number | null;
  stopPrice: number | null;
  status: OrderStatus;
  reduceOnly: boolean;
  createdTs: number;
  fillPrice: number | null;
  fee: number;
};

type StoredPosition = {
  id: string;
  groupId: string;
  symbol: string;
  side: Side;
  qty: number;
  entryPrice: number;
  leverage: number;
  realizedPnl: number;
  fees: number;
  funding: number;
  status: "OPEN" | "CLOSED";
  openedTs: number;
  closedTs: number | null;
  lastFundingTime: number | null;
};

type AccountRow = {
  startingEquity: number;
  peakEquity: number;
  dayKey: string;
  dayNet: number;
  consecutiveLosses: number;
};

export type PaperAction = {
  kind: "fill" | "reject" | "funding" | "skip";
  summary: string;
  payload: Record<string, unknown>;
};

export type PaperPositionView = {
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

export type PaperOrderView = {
  symbol: string;
  positionSide: Side;
  type: OrderType;
  qty: number;
  stopPrice: number | null;
  limitPrice: number | null;
  status: OrderStatus;
};

export type PaperView = {
  startingEquity: number;
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number;
  fees: number;
  funding: number;
  takerFeeRate: number;
  makerFeeRate: number;
  slippageBps: number;
  positions: PaperPositionView[];
  orders: PaperOrderView[];
  note: string;
};

const NOTE =
  "Simulated on live Aster prices. Market entries pay 5 bps of slippage. Fees are an assumption of 4 bps taker and 2 bps maker until the account fee rate can be read. This is not an Aster balance.";

export class PaperBook {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_orders (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        position_side TEXT NOT NULL,
        order_side TEXT NOT NULL,
        type TEXT NOT NULL,
        qty REAL NOT NULL,
        price REAL,
        stop_price REAL,
        status TEXT NOT NULL,
        reduce_only INTEGER NOT NULL,
        created_ts INTEGER NOT NULL,
        fill_price REAL,
        fee REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paper_positions (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        qty REAL NOT NULL,
        entry_price REAL NOT NULL,
        leverage INTEGER NOT NULL,
        realized_pnl REAL NOT NULL,
        fees REAL NOT NULL,
        funding REAL NOT NULL,
        status TEXT NOT NULL,
        opened_ts INTEGER NOT NULL,
        closed_ts INTEGER,
        last_funding_time INTEGER
      );
      CREATE TABLE IF NOT EXISTS paper_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        starting_equity REAL NOT NULL,
        peak_equity REAL NOT NULL,
        day_key TEXT NOT NULL,
        day_net REAL NOT NULL,
        consecutive_losses INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS desk_control (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        halted INTEGER NOT NULL,
        mode TEXT NOT NULL
      );
    `);
    const existing = this.db.prepare("SELECT id FROM paper_account WHERE id = 1").get();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO paper_account (id, starting_equity, peak_equity, day_key, day_net, consecutive_losses)
           VALUES (1, ?, ?, ?, 0, 0)`,
        )
        .run(PAPER_STARTING_EQUITY, PAPER_STARTING_EQUITY, utcDay(Date.now()));
    }
    const control = this.db.prepare("SELECT id FROM desk_control WHERE id = 1").get();
    if (!control) {
      this.db.prepare("INSERT INTO desk_control (id, halted, mode) VALUES (1, 0, 'paper')").run();
    }
  }

  close(): void {
    this.db.close();
  }

  view(marks: Record<string, number>): PaperView {
    const positions = this.openPositions().map((position) => {
      const mark = marks[position.symbol];
      const unrealized = mark === undefined ? 0 : pricePnl(position.side, position.qty, position.entryPrice, mark);
      return {
        symbol: position.symbol,
        side: position.side,
        qty: position.qty,
        entryPrice: position.entryPrice,
        mark: mark ?? null,
        leverage: position.leverage,
        unrealizedPnl: unrealized,
        fees: position.fees,
        funding: position.funding,
      };
    });
    const unrealizedPnl = positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
    const realizedPnl = this.sum("realized_pnl");
    const fees = this.sum("fees");
    const funding = this.sum("funding");
    const equity = PAPER_STARTING_EQUITY + realizedPnl + funding - fees + unrealizedPnl;
    return {
      startingEquity: PAPER_STARTING_EQUITY,
      equity,
      unrealizedPnl,
      realizedPnl,
      fees,
      funding,
      takerFeeRate: PAPER_TAKER_FEE_RATE,
      makerFeeRate: PAPER_MAKER_FEE_RATE,
      slippageBps: PAPER_SLIPPAGE_BPS,
      positions,
      orders: this.openOrders().map((order) => ({
        symbol: order.symbol,
        positionSide: order.positionSide,
        type: order.type,
        qty: order.qty,
        stopPrice: order.stopPrice,
        limitPrice: order.price,
        status: order.status,
      })),
      note: NOTE,
    };
  }

  accountState(marks: Record<string, number>, now: number) {
    const view = this.view(marks);
    this.markPeak(view.equity);
    const account = this.account();
    const dayKey = utcDay(now);
    const dayNet = account.dayKey === dayKey ? account.dayNet : 0;
    const usedMargin = view.positions.reduce((sum, position) => {
      const mark = position.mark ?? position.entryPrice;
      return sum + (Math.abs(position.qty * mark) / position.leverage);
    }, 0);
    const grossExposure = view.positions.reduce((sum, position) => {
      const mark = position.mark ?? position.entryPrice;
      return sum + Math.abs(position.qty * mark);
    }, 0);
    return {
      equity: view.equity,
      availableMargin: Math.max(0, view.equity - usedMargin),
      grossExposure,
      dailyRealizedLoss: Math.max(0, -dayNet),
      consecutiveLosses: account.consecutiveLosses,
      drawdownPct: account.peakEquity > 0 ? Math.max(0, (account.peakEquity - view.equity) / account.peakEquity) : 0,
      halted: this.isHalted(),
      maintenanceMarginRate: 0.005,
    };
  }

  isHalted(): boolean {
    return this.control().halted;
  }

  mode(): "research" | "paper" | "halted" {
    if (this.isHalted()) return "halted";
    return this.control().mode;
  }

  /**
   * Persist the halt before cancelling or closing anything.
   * A second call on an already flat book stays halted.
   */
  kill(quotes: Record<string, { bid: number; ask: number; mark: number }>, now: number): PaperAction[] {
    this.db.prepare("UPDATE desk_control SET halted = 1 WHERE id = 1").run();
    const actions: PaperAction[] = [
      { kind: "reject", summary: "Kill switch: desk halted. New paper trades are blocked.", payload: { halted: true } },
    ];
    this.db.prepare("UPDATE paper_orders SET status = 'CANCELED' WHERE status = 'NEW'").run();
    for (const position of this.openPositions()) {
      const quote = quotes[position.symbol] ?? { bid: position.entryPrice, ask: position.entryPrice, mark: position.entryPrice };
      const exitSide = orderSideFor(position.side, true);
      const exitPrice = marketFillPrice(exitSide, quote.bid || quote.mark, quote.ask || quote.mark);
      const fee = feeCash(position.qty * exitPrice, PAPER_TAKER_FEE_RATE);
      this.closePosition(position, exitPrice, fee, now);
      actions.push({
        kind: "fill",
        summary: `Kill switch closed paper ${position.side} ${position.symbol} at ${round(exitPrice)}.`,
        payload: { symbol: position.symbol, price: exitPrice },
      });
    }
    return actions;
  }

  resumeToResearch(): void {
    this.db.prepare("UPDATE desk_control SET halted = 0, mode = 'research' WHERE id = 1").run();
  }

  enablePaper(): { ok: boolean; reason: string } {
    if (this.isHalted()) return { ok: false, reason: "The desk is halted. Resume before enabling paper." };
    this.db.prepare("UPDATE desk_control SET mode = 'paper' WHERE id = 1").run();
    return { ok: true, reason: "Paper trading is on." };
  }

  submitApproved(input: {
    symbol: string;
    side: Side;
    qty: number;
    leverage: number;
    stop: number;
    target: number;
    bid: number;
    ask: number;
    filters: Filters;
    now: number;
    setup: string;
  }): PaperAction {
    if (this.isHalted() || this.mode() !== "paper") {
      return {
        kind: "reject",
        summary: this.isHalted()
          ? `Paper reject: ${input.symbol} blocked because the desk is halted.`
          : `Paper reject: ${input.symbol} blocked because the desk is in research mode.`,
        payload: { symbol: input.symbol, code: this.isHalted() ? "HALTED" : "RESEARCH" },
      };
    }
    if (this.hasWorkingEntry(input.symbol, input.side)) {
      return {
        kind: "skip",
        summary: `Paper skip: ${input.symbol} ${input.side} already has a working entry.`,
        payload: { symbol: input.symbol, side: input.side },
      };
    }
    const orderSide = orderSideFor(input.side, false);
    const fillPrice = marketFillPrice(orderSide, input.bid, input.ask);
    const rejection = quantityRejection(input.qty, fillPrice, input.filters);
    if (rejection) {
      this.insertOrder({
        groupId: randomUUID(),
        symbol: input.symbol,
        positionSide: input.side,
        orderSide,
        type: "MARKET",
        qty: input.qty,
        price: null,
        stopPrice: null,
        status: "REJECTED",
        reduceOnly: false,
        createdTs: input.now,
        fillPrice: null,
        fee: 0,
      });
      return {
        kind: "reject",
        summary: `Paper reject: ${input.symbol} ${input.side}. ${rejection}`,
        payload: { symbol: input.symbol, reason: rejection },
      };
    }
    return this.fillEntry({
      symbol: input.symbol,
      side: input.side,
      qty: input.qty,
      leverage: input.leverage,
      fillPrice,
      feeRate: PAPER_TAKER_FEE_RATE,
      stop: input.stop,
      target: input.target,
      now: input.now,
      setup: input.setup,
      orderType: "MARKET",
    });
  }

  placeLimit(input: {
    symbol: string;
    positionSide: Side;
    orderSide: OrderSide;
    qty: number;
    price: number;
    filters: Filters;
    now: number;
    leverage?: number;
  }): PaperAction {
    const rejection = quantityRejection(input.qty, input.price, input.filters);
    if (rejection) {
      return { kind: "reject", summary: `Paper reject: ${rejection}`, payload: { reason: rejection } };
    }
    this.insertOrder({
      groupId: randomUUID(),
      symbol: input.symbol,
      positionSide: input.positionSide,
      orderSide: input.orderSide,
      type: "LIMIT",
      qty: input.qty,
      price: input.price,
      stopPrice: null,
      status: "NEW",
      reduceOnly: false,
      createdTs: input.now,
      fillPrice: null,
      fee: 0,
    });
    return {
      kind: "skip",
      summary: `Paper limit resting: ${input.orderSide} ${input.qty} ${input.symbol} at ${input.price}.`,
      payload: { price: input.price, leverage: input.leverage ?? 3 },
    };
  }

  onQuote(
    symbol: string,
    quote: { mark: number; fundingRate: number; nextFundingTime: number },
    now: number,
  ): PaperAction[] {
    const actions: PaperAction[] = [];
    for (const position of this.openPositions().filter((item) => item.symbol === symbol)) {
      const funding = this.maybeFund(position, quote.mark, quote.fundingRate, quote.nextFundingTime, now);
      if (funding) actions.push(funding);
    }
    for (const order of this.openOrders().filter((item) => item.symbol === symbol)) {
      if (this.isHalted() && !order.reduceOnly) continue;
      const triggered =
        order.type === "LIMIT" && order.price !== null
          ? limitTradedThrough(order.orderSide, order.price, quote.mark)
          : order.type === "STOP_MARKET" && order.stopPrice !== null
            ? protectionTriggered("STOP_MARKET", order.orderSide, order.stopPrice, quote.mark)
            : order.type === "TAKE_PROFIT_MARKET" && order.stopPrice !== null
              ? protectionTriggered("TAKE_PROFIT_MARKET", order.orderSide, order.stopPrice, quote.mark)
              : false;
      if (!triggered) continue;
      const fill = order.type === "LIMIT" ? order.price! : quote.mark;
      actions.push(this.fillResting(order, fill, now));
    }
    const equity = this.view({ [symbol]: quote.mark }).equity;
    this.markPeak(equity);
    return actions;
  }

  private fillEntry(input: {
    symbol: string;
    side: Side;
    qty: number;
    leverage: number;
    fillPrice: number;
    feeRate: number;
    stop: number;
    target: number;
    now: number;
    setup: string;
    orderType: "MARKET" | "LIMIT";
    groupId?: string;
  }): PaperAction {
    const groupId = input.groupId ?? randomUUID();
    const fee = feeCash(input.qty * input.fillPrice, input.feeRate);
    const orderSide = orderSideFor(input.side, false);
    this.insertOrder({
      groupId,
      symbol: input.symbol,
      positionSide: input.side,
      orderSide,
      type: input.orderType,
      qty: input.qty,
      price: input.orderType === "LIMIT" ? input.fillPrice : null,
      stopPrice: null,
      status: "FILLED",
      reduceOnly: false,
      createdTs: input.now,
      fillPrice: input.fillPrice,
      fee,
    });
    this.insertPosition({
      groupId,
      symbol: input.symbol,
      side: input.side,
      qty: input.qty,
      entryPrice: input.fillPrice,
      leverage: input.leverage,
      realizedPnl: 0,
      fees: fee,
      funding: 0,
      status: "OPEN",
      openedTs: input.now,
      closedTs: null,
      lastFundingTime: null,
    });
    this.addDayNet(-fee, input.now);
    const exitSide = orderSideFor(input.side, true);
    this.insertOrder({
      groupId,
      symbol: input.symbol,
      positionSide: input.side,
      orderSide: exitSide,
      type: "STOP_MARKET",
      qty: input.qty,
      price: null,
      stopPrice: input.stop,
      status: "NEW",
      reduceOnly: true,
      createdTs: input.now,
      fillPrice: null,
      fee: 0,
    });
    this.insertOrder({
      groupId,
      symbol: input.symbol,
      positionSide: input.side,
      orderSide: exitSide,
      type: "TAKE_PROFIT_MARKET",
      qty: input.qty,
      price: null,
      stopPrice: input.target,
      status: "NEW",
      reduceOnly: true,
      createdTs: input.now,
      fillPrice: null,
      fee: 0,
    });
    return {
      kind: "fill",
      summary: `Paper fill: ${input.side} ${input.qty} ${input.symbol} at ${round(input.fillPrice)} (${input.setup}). Stop ${input.stop}, target ${input.target}.`,
      payload: { symbol: input.symbol, side: input.side, qty: input.qty, price: input.fillPrice, fee },
    };
  }

  private fillResting(order: StoredOrder, fillPrice: number, now: number): PaperAction {
    const fee = feeCash(order.qty * fillPrice, order.type === "LIMIT" ? PAPER_MAKER_FEE_RATE : PAPER_TAKER_FEE_RATE);
    this.db
      .prepare("UPDATE paper_orders SET status = 'FILLED', fill_price = ?, fee = ? WHERE id = ?")
      .run(fillPrice, fee, order.id);
    if (order.reduceOnly) {
      const position = this.openPositions().find((item) => item.groupId === order.groupId);
      if (position) this.closePosition(position, fillPrice, fee, now);
      this.db
        .prepare(
          `UPDATE paper_orders SET status = 'CANCELED'
           WHERE group_id = ? AND status = 'NEW' AND id != ?`,
        )
        .run(order.groupId, order.id);
      return {
        kind: "fill",
        summary: `Paper ${order.type === "STOP_MARKET" ? "stop" : "target"}: ${order.positionSide} ${order.symbol} closed at mark ${round(fillPrice)}.`,
        payload: { symbol: order.symbol, price: fillPrice, fee, type: order.type },
      };
    }
    const leverage = Number(order.price ? 3 : 3);
    this.insertPosition({
      groupId: order.groupId,
      symbol: order.symbol,
      side: order.positionSide,
      qty: order.qty,
      entryPrice: fillPrice,
      leverage,
      realizedPnl: 0,
      fees: fee,
      funding: 0,
      status: "OPEN",
      openedTs: now,
      closedTs: null,
      lastFundingTime: null,
    });
    this.addDayNet(-fee, now);
    return {
      kind: "fill",
      summary: `Paper limit fill: ${order.orderSide} ${order.qty} ${order.symbol} at ${round(fillPrice)}.`,
      payload: { symbol: order.symbol, price: fillPrice, fee, leverage },
    };
  }

  private closePosition(position: StoredPosition, exitPrice: number, exitFee: number, now: number): void {
    const pnl = pricePnl(position.side, position.qty, position.entryPrice, exitPrice);
    const fees = position.fees + exitFee;
    this.db
      .prepare(
        `UPDATE paper_positions
         SET status = 'CLOSED', realized_pnl = ?, fees = ?, closed_ts = ?
         WHERE id = ?`,
      )
      .run(pnl, fees, now, position.id);
    this.addDayNet(pnl - exitFee, now);
    const net = pnl - position.fees - exitFee;
    const account = this.account();
    const consecutiveLosses = net < 0 ? account.consecutiveLosses + 1 : 0;
    this.db.prepare("UPDATE paper_account SET consecutive_losses = ? WHERE id = 1").run(consecutiveLosses);
  }

  private maybeFund(
    position: StoredPosition,
    mark: number,
    fundingRate: number,
    nextFundingTime: number,
    now: number,
  ): PaperAction | null {
    if (now < nextFundingTime) return null;
    if (position.lastFundingTime !== null && position.lastFundingTime >= nextFundingTime) return null;
    const cash = fundingCashflow(position.side, position.qty, mark, fundingRate);
    this.db
      .prepare("UPDATE paper_positions SET funding = funding + ?, last_funding_time = ? WHERE id = ?")
      .run(cash, nextFundingTime, position.id);
    this.addDayNet(cash, now);
    return {
      kind: "funding",
      summary: `Paper funding: ${position.side} ${position.symbol} ${cash < 0 ? "paid" : "received"} ${round(Math.abs(cash))} USDT at rate ${fundingRate}.`,
      payload: { symbol: position.symbol, cash, fundingRate, nextFundingTime },
    };
  }

  private hasWorkingEntry(symbol: string, side: Side): boolean {
    const open = this.openPositions().some((position) => position.symbol === symbol && position.side === side);
    if (open) return true;
    return this.openOrders().some(
      (order) => order.symbol === symbol && order.positionSide === side && !order.reduceOnly,
    );
  }

  private markPeak(equity: number): void {
    const account = this.account();
    if (equity > account.peakEquity) {
      this.db.prepare("UPDATE paper_account SET peak_equity = ? WHERE id = 1").run(equity);
    }
  }

  private addDayNet(delta: number, now: number): void {
    const account = this.account();
    const key = utcDay(now);
    const dayNet = account.dayKey === key ? account.dayNet + delta : delta;
    this.db.prepare("UPDATE paper_account SET day_key = ?, day_net = ? WHERE id = 1").run(key, dayNet);
  }

  private control(): { halted: boolean; mode: "research" | "paper" } {
    const row = this.db.prepare("SELECT halted, mode FROM desk_control WHERE id = 1").get() as {
      halted: number;
      mode: string;
    };
    return { halted: Number(row.halted) === 1, mode: row.mode === "research" ? "research" : "paper" };
  }

  private account(): AccountRow {
    const row = this.db.prepare("SELECT * FROM paper_account WHERE id = 1").get() as Record<string, unknown>;
    return {
      startingEquity: Number(row.starting_equity),
      peakEquity: Number(row.peak_equity),
      dayKey: String(row.day_key),
      dayNet: Number(row.day_net),
      consecutiveLosses: Number(row.consecutive_losses),
    };
  }

  private openPositions(): StoredPosition[] {
    return (this.db.prepare("SELECT * FROM paper_positions WHERE status = 'OPEN'").all() as Array<Record<string, unknown>>).map(
      toPosition,
    );
  }

  private openOrders(): StoredOrder[] {
    return (this.db.prepare("SELECT * FROM paper_orders WHERE status = 'NEW' ORDER BY created_ts").all() as Array<
      Record<string, unknown>
    >).map(toOrder);
  }

  private sum(column: "realized_pnl" | "fees" | "funding"): number {
    const row = this.db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS total FROM paper_positions`).get() as {
      total: number;
    };
    return Number(row.total);
  }

  private insertOrder(order: Omit<StoredOrder, "id">): void {
    this.db
      .prepare(
        `INSERT INTO paper_orders (
          id, group_id, symbol, position_side, order_side, type, qty, price, stop_price, status, reduce_only, created_ts, fill_price, fee
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        order.groupId,
        order.symbol,
        order.positionSide,
        order.orderSide,
        order.type,
        order.qty,
        order.price,
        order.stopPrice,
        order.status,
        order.reduceOnly ? 1 : 0,
        order.createdTs,
        order.fillPrice,
        order.fee,
      );
  }

  private insertPosition(position: Omit<StoredPosition, "id">): void {
    this.db
      .prepare(
        `INSERT INTO paper_positions (
          id, group_id, symbol, side, qty, entry_price, leverage, realized_pnl, fees, funding, status, opened_ts, closed_ts, last_funding_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        position.groupId,
        position.symbol,
        position.side,
        position.qty,
        position.entryPrice,
        position.leverage,
        position.realizedPnl,
        position.fees,
        position.funding,
        position.status,
        position.openedTs,
        position.closedTs,
        position.lastFundingTime,
      );
  }
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toOrder(row: Record<string, unknown>): StoredOrder {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    symbol: String(row.symbol),
    positionSide: String(row.position_side) as Side,
    orderSide: String(row.order_side) as OrderSide,
    type: String(row.type) as OrderType,
    qty: Number(row.qty),
    price: row.price === null ? null : Number(row.price),
    stopPrice: row.stop_price === null ? null : Number(row.stop_price),
    status: String(row.status) as OrderStatus,
    reduceOnly: Number(row.reduce_only) === 1,
    createdTs: Number(row.created_ts),
    fillPrice: row.fill_price === null ? null : Number(row.fill_price),
    fee: Number(row.fee),
  };
}

function toPosition(row: Record<string, unknown>): StoredPosition {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    symbol: String(row.symbol),
    side: String(row.side) as Side,
    qty: Number(row.qty),
    entryPrice: Number(row.entry_price),
    leverage: Number(row.leverage),
    realizedPnl: Number(row.realized_pnl),
    fees: Number(row.fees),
    funding: Number(row.funding),
    status: String(row.status) as "OPEN" | "CLOSED",
    openedTs: Number(row.opened_ts),
    closedTs: row.closed_ts === null ? null : Number(row.closed_ts),
    lastFundingTime: row.last_funding_time === null ? null : Number(row.last_funding_time),
  };
}
