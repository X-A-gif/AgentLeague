import type { Candle } from "@aster/client";
import { EMA, SMA } from "technicalindicators";
import { describe, expect, it } from "vitest";
import { classifyRegime } from "./features.js";
import { emaSeries, sessionVwap, smaSeries } from "./indicators.js";

describe("indicators", () => {
  it("matches the standard SMA and seeded EMA", () => {
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual(SMA.calculate({ period: 2, values: [1, 2, 3, 4] }));
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([1.5, 2.5, 3.5]);
    const values = [1, 2, 3, 4, 5];
    expect(emaSeries(values, 3)).toEqual(EMA.calculate({ period: 3, values }));
    // Seed is the SMA of the first 3 values (2). Multiplier is 2 / 4.
    expect(emaSeries(values, 3)[1]).toBeCloseTo(3);
    expect(emaSeries(values, 3)[2]).toBeCloseTo(4);
  });

  it("computes a UTC-session VWAP from typical price", () => {
    const now = Date.UTC(2026, 10, 14, 12, 0, 0);
    const candles: Candle[] = [
      bar(Date.UTC(2026, 10, 14, 0, 0, 0), 10, 12, 8, 10, 2),
      bar(Date.UTC(2026, 10, 14, 0, 15, 0), 10, 14, 10, 12, 2),
    ];
    const first = (10 + 12 + 8) / 3;
    const second = (10 + 14 + 12) / 3;
    const expected = (first * 2 + second * 2) / 4;
    expect(sessionVwap(candles, now)?.vwap).toBeCloseTo(expected);
  });
});

describe("regime", () => {
  it("calls a rising market a trend and a flat market a range", () => {
    expect(classifyRegime({ close: 110, ema50: 100, slope: 0.01, bandwidth: 0.05 })).toBe("trend_up");
    expect(classifyRegime({ close: 90, ema50: 100, slope: -0.01, bandwidth: 0.05 })).toBe("trend_down");
    expect(classifyRegime({ close: 100, ema50: 100, slope: 0.0001, bandwidth: 0.05 })).toBe("range");
  });
});

function bar(openTime: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { openTime, open, high, low, close, volume, closeTime: openTime + 899_999 };
}
