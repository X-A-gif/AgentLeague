import type { Candle, SymbolFilters } from "@aster/client";
import { DEFAULT_LIMITS, type AccountState } from "@aster/risk";
import { describe, expect, it } from "vitest";
import { runResearch } from "./research.js";

const filters: SymbolFilters = {
  symbol: "BTCUSDT",
  status: "TRADING",
  contractType: "PERPETUAL",
  marginAsset: "USDT",
  tickSize: 0.1,
  stepSize: 0.001,
  minQty: 0.001,
  maxQty: 1000,
  marketMaxQty: 120,
  minNotional: 5,
  maxAlgoOrders: 10,
  orderTypes: ["MARKET", "LIMIT"],
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

describe("research pipeline", () => {
  it("classifies a rising 15m series without creating an order", () => {
    const series = candles(80, 1);
    const pass = runResearch({
      symbol: "BTCUSDT",
      filters,
      quote: {
        mark: series.at(-1)!.close,
        index: series.at(-1)!.close,
        fundingRate: 0.0001,
        nextFundingTime: series.at(-1)!.closeTime + 60_000,
        bid: series.at(-1)!.close - 0.1,
        ask: series.at(-1)!.close + 0.1,
      },
      candles: { "5m": series, "15m": series, "1h": series, "4h": series, "1d": series.slice(-30) },
      limits: DEFAULT_LIMITS,
      limitVersion: 1,
      account,
      now: series.at(-1)!.closeTime + 1,
      standDown: false,
    });
    expect(pass.features?.regime).toBe("trend_up");
    expect(JSON.stringify(pass)).not.toMatch(/placeOrder|user-withdraw/);
  });
});

function candles(count: number, step: number): Candle[] {
  const start = Date.UTC(2026, 10, 14, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * step;
    const openTime = start + index * 900_000;
    return {
      openTime,
      open: close - step / 2,
      high: close + 0.4,
      low: close - 0.6,
      close,
      volume: 8 + (index % 4),
      closeTime: openTime + 899_999,
    };
  });
}
