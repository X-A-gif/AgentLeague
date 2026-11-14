import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LIMITS, evaluateRisk, type AccountState, type Filters, type Ticket } from "@aster/risk";
import { describe, expect, it } from "vitest";
import { DecisionLog } from "./log.js";

describe("decision log", () => {
  it("appends events and reads them back after reopening", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "aster-log-")), "desk.sqlite");
    const first = new DecisionLog(file);
    const market = first.append({
      ts: 1,
      agent: "market",
      kind: "observation",
      correlationId: "BTCUSDT-15m-1",
      parentIds: [],
      payload: { summary: "trend up" },
    });
    first.append({
      ts: 2,
      agent: "technical",
      kind: "observation",
      correlationId: "BTCUSDT-15m-1",
      parentIds: [market.id],
      payload: { summary: "rsi 58" },
    });
    first.close();

    const reopened = new DecisionLog(file);
    const events = reopened.list();
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual({ summary: "rsi 58" });
    expect(events[1]?.id).toBe(market.id);
    expect(events.map((event) => event.id)).toContain(market.id);
    expect(reopened.hasCorrelation("BTCUSDT-15m-1")).toBe(true);
    expect(reopened.hasCorrelation("missing")).toBe(false);
    reopened.close();
  });

  it("keeps a loosened limit inactive until it is confirmed", () => {
    const log = new DecisionLog(":memory:");
    const original = log.activeLimits();
    expect(original?.limits.maxLeverage).toBe(3);

    const loosened = log.proposeLimits({ ...DEFAULT_LIMITS, maxLeverage: 5 }, "try more leverage");
    expect(loosened.active).toBe(false);
    expect(log.activeLimits()?.limits.maxLeverage).toBe(3);

    const tightened = log.proposeLimits({ ...DEFAULT_LIMITS, maxLeverage: 2 }, "tighter");
    expect(tightened.active).toBe(true);
    expect(log.activeLimits()?.limits.maxLeverage).toBe(2);

    const confirmed = log.proposeLimits({ ...DEFAULT_LIMITS, maxLeverage: 4 }, "operator confirmed", true);
    expect(confirmed.active).toBe(true);
    expect(log.activeLimits()?.id).toBe(confirmed.version.id);
    log.close();
  });

  it("uses a tightened limit on the next decision and ignores an unconfirmed looser one", () => {
    const log = new DecisionLog(":memory:");
    const ticket: Ticket = {
      symbol: "BTCUSDT",
      side: "LONG",
      setup: "momentum",
      entryType: "MARKET",
      entry: 100,
      stop: 90,
      targets: [120],
      timeframe: "15m",
      newsFlag: "clear",
    };
    const account: AccountState = {
      equity: 10_000,
      availableMargin: 10_000,
      grossExposure: 0,
      dailyRealizedLoss: 0,
      consecutiveLosses: 0,
      drawdownPct: 0,
      halted: false,
      maintenanceMarginRate: 0.005,
    };
    const filters: Filters = {
      tickSize: 0.1,
      stepSize: 0.001,
      minQty: 0.001,
      maxQty: 1000,
      marketMaxQty: 120,
      minNotional: 5,
    };
    const quote = { mark: 100, bid: 99.99, ask: 100.01 };
    const before = evaluateRisk({
      ticket,
      limits: log.activeLimits()!.limits,
      limitVersion: log.activeLimits()!.id,
      account,
      filters,
      quote,
    });
    log.proposeLimits({ ...DEFAULT_LIMITS, riskPerTrade: 0.02 }, "unconfirmed increase");
    const ignored = evaluateRisk({
      ticket,
      limits: log.activeLimits()!.limits,
      limitVersion: log.activeLimits()!.id,
      account,
      filters,
      quote,
    });
    expect(ignored.riskCash).toBe(before.riskCash);
    log.proposeLimits({ ...DEFAULT_LIMITS, riskPerTrade: 0.0025 }, "tighter");
    const after = evaluateRisk({
      ticket,
      limits: log.activeLimits()!.limits,
      limitVersion: log.activeLimits()!.id,
      account,
      filters,
      quote,
    });
    expect(after.action).toBe("approve");
    expect(after.riskCash!).toBeLessThan(before.riskCash!);
    log.close();
  });
});
