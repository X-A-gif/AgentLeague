import { describe, expect, it } from "vitest";
import type { Features } from "./features.js";
import { bestBySide, detectSetups } from "./setups.js";

function features(overrides: Partial<Features> = {}): Features {
  return {
    close: 110,
    open: 108,
    high: 111,
    low: 107,
    ema20: 105,
    ema50: 100,
    prevEma20: 99,
    prevEma50: 100,
    ema20FiveAgo: 98,
    rsi: 58,
    prevRsi: 55,
    macdHistogram: 0.4,
    prevMacdHistogram: 0.2,
    bbUpper: 112,
    bbLower: 98,
    bbMiddle: 105,
    vwap: 104,
    vwapPartial: false,
    volume: 20,
    avgVolume20: 10,
    highestHigh20: 109,
    lowestLow20: 95,
    swingLow8: 106,
    swingHigh8: 111,
    regime: "trend_up",
    bandwidth: 0.04,
    slope: 0.01,
    bullishDivergence: false,
    bearishDivergence: false,
    htfAgreesLong: true,
    htfAgreesShort: false,
    rsiByTimeframe: {},
    ...overrides,
  };
}

describe("setup detection", () => {
  it("prefers one long setup and keeps divergence as a tag", () => {
    const chosen = bestBySide(detectSetups(features({ bullishDivergence: true }), 0.1));
    expect(chosen.long?.name).toBe("breakout");
    expect(chosen.long?.tags).toContain("rsi_divergence");
    expect(chosen.long?.side).toBe("LONG");
    expect(chosen.short).toBeUndefined();
  });

  it("does not emit a ticket that is only a divergence", () => {
    const quiet = features({
      prevEma20: 100,
      prevEma50: 99,
      ema20: 100.2,
      ema50: 99.5,
      macdHistogram: -0.1,
      prevMacdHistogram: -0.2,
      rsi: 48,
      volume: 10,
      avgVolume20: 10,
      close: 100,
      high: 101,
      low: 99,
      open: 100,
      highestHigh20: 110,
      lowestLow20: 90,
      bullishDivergence: true,
      regime: "trend_up",
    });
    expect(detectSetups(quiet, 0.1)).toHaveLength(0);
  });

  it("allows mean reversion only in a range", () => {
    const range = features({
      regime: "range",
      close: 97,
      open: 99,
      high: 100,
      low: 96,
      bbLower: 98,
      bbMiddle: 104,
      bbUpper: 110,
      rsi: 28,
      volume: 5,
      avgVolume20: 10,
      prevEma20: 100,
      ema20: 100,
      prevEma50: 100,
      ema50: 100,
      macdHistogram: 0,
      prevMacdHistogram: 0,
      highestHigh20: 120,
      swingLow8: 95,
    });
    const names = detectSetups(range, 0.1).map((setup) => setup.name);
    expect(names).toContain("mean_reversion");
    expect(detectSetups({ ...range, regime: "trend_down" }, 0.1).map((setup) => setup.name)).not.toContain(
      "mean_reversion",
    );
  });
});
