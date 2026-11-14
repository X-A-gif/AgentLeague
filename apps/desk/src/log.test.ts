import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_LIMITS } from "@aster/risk";
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
});
