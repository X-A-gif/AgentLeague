import { describe, expect, it } from "vitest";
import { applyHeadDecision, evaluateRisk, gateExecution, type AccountState, type Filters, type Ticket } from "./evaluate.js";
import { DEFAULT_LIMITS, isLooser, streakFactor } from "./limits.js";

const filters: Filters = {
  tickSize: 0.1,
  stepSize: 0.001,
  minQty: 0.001,
  maxQty: 1000,
  marketMaxQty: 120,
  minNotional: 5,
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

const quote = { mark: 100, bid: 99.99, ask: 100.01 };

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    symbol: "BTCUSDT",
    side: "LONG",
    setup: "momentum",
    entryType: "MARKET",
    entry: 100,
    stop: 90,
    targets: [120],
    timeframe: "15m",
    newsFlag: "clear",
    ...overrides,
  };
}

function decide(overrides: Parameters<typeof evaluateRisk>[0] extends infer T ? Partial<T> : never = {}) {
  return evaluateRisk({
    ticket: ticket(),
    limits: DEFAULT_LIMITS,
    limitVersion: 1,
    account,
    filters,
    quote,
    ...overrides,
  });
}

describe("risk engine", () => {
  it("sizes from the stop distance and does not round up to the minimum", () => {
    const approved = decide();
    expect(approved.action).toBe("approve");
    expect(approved.riskCash).toBe(50);
    expect(approved.qty).toBe(5);
    expect(approved.leverage).toBe(3);

    const tiny = decide({
      account: { ...account, equity: 50, availableMargin: 50 },
    });
    expect(tiny.action).toBe("reject");
    expect(tiny.reason).toMatch(/exchange minimum/);
    expect(tiny.qty).toBeNull();
  });

  it("does not increase size after losses", () => {
    const first = decide();
    const afterTwo = decide({ account: { ...account, consecutiveLosses: 2 } });
    expect(afterTwo.action).toBe("approve");
    expect(afterTwo.riskCash!).toBeLessThanOrEqual(first.riskCash!);
    expect(afterTwo.qty!).toBeLessThan(first.qty!);
    expect(streakFactor(2, 3)).toBe(0.5);
    expect(streakFactor(3, 3)).toBe(0);
    expect(decide({ account: { ...account, consecutiveLosses: 3 } }).reason).toMatch(/Consecutive-loss/);
  });

  it("rejects over-limit trades with stable reason codes", () => {
    expect(decide({ ticket: ticket({ stop: 101 }) }).code).toBe("MISSING_STOP");
    expect(decide({ ticket: ticket({ targets: [105] }) }).code).toBe("REWARD_RISK");
    expect(decide({ account: { ...account, dailyRealizedLoss: 200 } }).code).toBe("DAILY_LOSS");
    expect(decide({ account: { ...account, drawdownPct: 0.1 } }).code).toBe("DRAWDOWN");
    const approved = decide();
    expect(
      gateExecution({
        decision: approved,
        qty: approved.qty!,
        leverage: 10,
        stop: 90,
        approvedStop: 90,
        decidedAt: 1_000,
        now: 1_100,
        activeLimitVersion: 1,
        halted: false,
        equity: 10_000,
        entry: 100,
        limits: DEFAULT_LIMITS,
      }),
    ).toMatchObject({ ok: false, code: "LEVERAGE" });
  });

  it("clips a tight stop to the position cap and still vetoes an unclipped size", () => {
    const clipped = decide({
      account: { ...account, equity: 2_000, availableMargin: 2_000 },
      ticket: ticket({ entry: 1817.51, stop: 1803.98, targets: [1850] }),
    });
    const cap = 2_000 * 0.1;
    expect(clipped.action).toBe("approve");
    expect(clipped.code).toBe("OK");
    expect(clipped.uncappedQty! * 1817.51).toBeGreaterThan(cap);
    expect(clipped.qty! * 1817.51).toBeLessThanOrEqual(cap + 1e-6);
    expect(clipped.qty!).toBeLessThan(clipped.uncappedQty!);
    expect(clipped.qty!).toBeLessThanOrEqual(clipped.uncappedQty!);

    const unclipped = gateExecution({
      decision: { ...clipped, qty: clipped.uncappedQty, notional: clipped.uncappedQty! * 1817.51 },
      qty: clipped.uncappedQty!,
      leverage: clipped.leverage!,
      stop: 1803.98,
      approvedStop: 1803.98,
      decidedAt: 1_000,
      now: 1_000,
      activeLimitVersion: 1,
      halted: false,
      equity: 2_000,
      entry: 1817.51,
      limits: DEFAULT_LIMITS,
    });
    expect(unclipped).toMatchObject({ ok: false, code: "POSITION_CAP" });
  });

  it("skips a ticket whose capped size is below the exchange minimum", () => {
    const skipped = decide({
      account: { ...account, equity: 2_000, availableMargin: 2_000 },
      filters: { ...filters, minNotional: 500 },
      ticket: ticket({ entry: 100, stop: 99, targets: [101.5] }),
    });
    expect(skipped.action).toBe("reject");
    expect(skipped.code).toBe("MIN_SIZE");
    expect(skipped.qty).toBeNull();
    expect(skipped.uncappedQty).toBe(10);
    expect(skipped.reason).toMatch(/exchange minimum/);
    expect(skipped.reason).toMatch(/Risk size 10/);
  });

  it("rejects a market that has run through the mark", () => {
    const decision = decide({ quote: { mark: 100, bid: 99, ask: 101 } });
    expect(decision.action).toBe("reject");
    expect(decision.reason).toMatch(/bps/);
  });

  it("ignores a head trader request to trade larger", () => {
    expect(applyHeadDecision(5, { status: "accept", qty: 9 })).toEqual({
      qty: 5,
      note: "Head trader asked to increase size. The increase was ignored.",
    });
    const approved = decide();
    const gated = gateExecution({
      decision: approved,
      qty: 9,
      leverage: approved.leverage!,
      stop: 90,
      approvedStop: 90,
      decidedAt: 1_000,
      now: 1_000,
      activeLimitVersion: 1,
      halted: false,
      equity: 10_000,
      entry: 100,
      limits: DEFAULT_LIMITS,
    });
    expect(gated).toEqual({ ok: true, qty: approved.qty, leverage: approved.leverage });
    expect(applyHeadDecision(5, { status: "disabled" }).qty).toBe(5);
    expect(applyHeadDecision(5, { status: "accept", qty: 2 }).qty).toBe(2);
  });

  it("treats a higher leverage or a lower reward minimum as a looser limit", () => {
    expect(isLooser({ ...DEFAULT_LIMITS, maxLeverage: 4 }, DEFAULT_LIMITS)).toBe(true);
    expect(isLooser({ ...DEFAULT_LIMITS, minRewardRisk: 1.2 }, DEFAULT_LIMITS)).toBe(true);
    expect(isLooser({ ...DEFAULT_LIMITS, maxLeverage: 2 }, DEFAULT_LIMITS)).toBe(false);
  });
});
