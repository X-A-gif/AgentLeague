import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Filters } from "@aster/risk";
import { describe, expect, it } from "vitest";
import { marketFillPrice } from "./paper.js";
import { PaperBook } from "./paperBook.js";

const filters: Filters = {
  tickSize: 0.1,
  stepSize: 0.001,
  minQty: 0.001,
  maxQty: 1000,
  marketMaxQty: 120,
  minNotional: 5,
};

function tempBook(): PaperBook {
  return new PaperBook(path.join(mkdtempSync(path.join(tmpdir(), "paper-")), "book.sqlite"));
}

describe("paper trading", () => {
  it("buys at the ask plus slippage, not at the mid", () => {
    const bid = 100;
    const ask = 101;
    const mid = (bid + ask) / 2;
    const fill = marketFillPrice("BUY", bid, ask);
    expect(fill).toBeCloseTo(101 * 1.0005);
    expect(fill).not.toBeCloseTo(mid);
    expect(marketFillPrice("SELL", bid, ask)).toBeCloseTo(100 * 0.9995);

    const book = tempBook();
    const action = book.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.1,
      leverage: 3,
      stop: 95,
      target: 110,
      bid,
      ask,
      filters,
      now: 1_000,
      setup: "test",
    });
    expect(action.kind).toBe("fill");
    expect(book.view({ BTCUSDT: 101 }).positions[0]?.entryPrice).toBeCloseTo(fill);
    book.close();
  });

  it("leaves a limit below the market resting until the mark trades through it", () => {
    const book = tempBook();
    book.placeLimit({
      symbol: "BTCUSDT",
      positionSide: "LONG",
      orderSide: "BUY",
      qty: 0.1,
      price: 99,
      filters,
      now: 1_000,
    });
    expect(book.view({}).orders).toHaveLength(1);
    expect(book.onQuote("BTCUSDT", { mark: 100, fundingRate: 0, nextFundingTime: 5_000 }, 1_100)).toHaveLength(0);
    expect(book.view({}).orders[0]?.status).toBe("NEW");
    const filled = book.onQuote("BTCUSDT", { mark: 99, fundingRate: 0, nextFundingTime: 5_000 }, 1_200);
    expect(filled[0]?.kind).toBe("fill");
    expect(filled[0]?.payload.price).toBe(99);
    expect(book.view({ BTCUSDT: 99 }).positions[0]?.entryPrice).toBe(99);
    book.close();
  });

  it("rejects a quantity that breaks the step or the minimum notional", () => {
    const book = tempBook();
    const stepped = book.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.0015,
      leverage: 3,
      stop: 90,
      target: 120,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "test",
    });
    expect(stepped.kind).toBe("reject");
    expect(stepped.summary).toMatch(/step size/);
    const tiny = book.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.002,
      leverage: 3,
      stop: 90,
      target: 120,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "test",
    });
    expect(tiny.kind).toBe("reject");
    expect(tiny.summary).toMatch(/minimum/);
    expect(book.view({}).positions).toHaveLength(0);
    book.close();
  });

  it("charges one funding interval when the funding time passes, and not twice", () => {
    const book = tempBook();
    book.submitApproved({
      symbol: "ETHUSDT",
      side: "LONG",
      qty: 1,
      leverage: 3,
      stop: 90,
      target: 120,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "test",
    });
    const before = book.onQuote("ETHUSDT", { mark: 100, fundingRate: 0.0001, nextFundingTime: 5_000 }, 2_000);
    expect(before.some((action) => action.kind === "funding")).toBe(false);
    const charged = book.onQuote("ETHUSDT", { mark: 100, fundingRate: 0.0001, nextFundingTime: 5_000 }, 5_000);
    expect(charged.filter((action) => action.kind === "funding")).toHaveLength(1);
    expect(book.view({ ETHUSDT: 100 }).funding).toBeCloseTo(-0.01);
    const again = book.onQuote("ETHUSDT", { mark: 100, fundingRate: 0.0001, nextFundingTime: 5_000 }, 5_100);
    expect(again.filter((action) => action.kind === "funding")).toHaveLength(0);
    expect(book.view({ ETHUSDT: 100 }).funding).toBeCloseTo(-0.01);
    book.close();
  });

  it("closes a long on the mark at the stop and cancels the target", () => {
    const book = tempBook();
    book.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.1,
      leverage: 3,
      stop: 95,
      target: 120,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "test",
    });
    expect(book.view({}).orders.map((order) => order.type).sort()).toEqual(["STOP_MARKET", "TAKE_PROFIT_MARKET"]);
    const closed = book.onQuote("BTCUSDT", { mark: 95, fundingRate: 0, nextFundingTime: 9_000 }, 2_000);
    expect(closed.some((action) => String(action.summary).includes("stop"))).toBe(true);
    const view = book.view({ BTCUSDT: 95 });
    expect(view.positions).toHaveLength(0);
    expect(view.orders).toHaveLength(0);
    expect(view.realizedPnl).toBeLessThan(0);
    book.close();
  });

  it("kill switch flattens a position, cancels a resting order, and blocks the next fill", () => {
    const book = tempBook();
    book.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.1,
      leverage: 3,
      stop: 90,
      target: 120,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "test",
    });
    book.placeLimit({
      symbol: "ETHUSDT",
      positionSide: "LONG",
      orderSide: "BUY",
      qty: 0.1,
      price: 90,
      filters,
      now: 1_000,
    });
    expect(book.view({}).orders.length).toBeGreaterThan(0);
    book.kill({ BTCUSDT: { bid: 100, ask: 101, mark: 100.5 } }, 2_000);
    const flat = book.view({});
    expect(flat.positions).toHaveLength(0);
    expect(flat.orders).toHaveLength(0);
    expect(book.isHalted()).toBe(true);
    const blocked = book.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.1,
      leverage: 3,
      stop: 90,
      target: 120,
      bid: 100,
      ask: 100,
      filters,
      now: 3_000,
      setup: "after-kill",
    });
    expect(blocked.kind).toBe("reject");
    expect(book.view({}).positions).toHaveLength(0);
    book.close();
  });

  it("reopens an open paper position from the same file", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "paper-")), "book.sqlite");
    const first = new PaperBook(file);
    first.submitApproved({
      symbol: "BTCUSDT",
      side: "SHORT",
      qty: 0.2,
      leverage: 3,
      stop: 110,
      target: 90,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "test",
    });
    first.close();
    const second = new PaperBook(file);
    expect(second.view({ BTCUSDT: 100 }).positions[0]).toMatchObject({ symbol: "BTCUSDT", side: "SHORT", qty: 0.2 });
    second.close();
  });
});
