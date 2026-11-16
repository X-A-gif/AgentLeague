import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Candle, SymbolFilters } from "@aster/client";
import { DEFAULT_LIMITS } from "@aster/risk";
import { describe, expect, it } from "vitest";
import type { Features } from "../features.js";
import { PaperBook } from "../paperBook.js";
import type { Quote } from "../research.js";
import { League, LEAGUE_TEAM_CAPITAL, runLeagueSymbol, withSizeReasoning } from "./run.js";
import { PROPOSERS, proposeAlpha, proposeGamma } from "./strategies.js";
import { TEAMS, type SharedMarket, type TeamId } from "./types.js";

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

const quote: Quote = {
  mark: 100,
  index: 100,
  fundingRate: -0.0002,
  nextFundingTime: 9_000_000,
  bid: 99.99,
  ask: 100.01,
};

describe("size reasoning", () => {
  it("records the risk budget and the capped size", () => {
    expect(withSizeReasoning("Gamma long.", { uncappedQty: 0.739, qty: 0.11, code: "OK" })).toBe(
      "Gamma long. Risk size 0.739, capped size 0.11.",
    );
    expect(withSizeReasoning("Gamma long.", { uncappedQty: 10, qty: null, code: "MIN_SIZE" })).toBe(
      "Gamma long. Risk size 10, capped size below the exchange minimum.",
    );
    expect(withSizeReasoning("No size yet.", { uncappedQty: null, qty: null, code: "MISSING_STOP" })).toBe(
      "No size yet.",
    );
  });
});

describe("league strategies", () => {
  it("keeps five distinct strategy versions", () => {
    expect(TEAMS).toHaveLength(5);
    expect(new Set(TEAMS.map((team) => team.strategyId)).size).toBe(5);
    expect(new Set(Object.keys(PROPOSERS)).size).toBe(5);
  });

  it("does not let Alpha take Gamma's mean-reversion setup", () => {
    const market = shared(reversionFeatures());
    expect(proposeAlpha(market)?.indicators.setup ?? null).not.toBe("mean_reversion");
    const gamma = proposeGamma(market);
    expect(gamma?.indicators.setup).toBe("mean_reversion");
    expect(gamma?.reasoning).toContain("Gamma");
    expect(gamma?.strategyVersion).toBe(1);
  });
});

describe("league paper teams", () => {
  it("gives every team the same capital and records a veto instead of a fill", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "league-"));
    const books = Object.fromEntries(
      TEAMS.map((team) => [team.id, new PaperBook(path.join(directory, `${team.id}.sqlite`), LEAGUE_TEAM_CAPITAL)]),
    ) as Record<TeamId, PaperBook>;
    const candles = rising(80);
    const events = runLeagueSymbol({
      symbol: "BTCUSDT",
      candles: { "5m": candles, "15m": candles, "1h": candles, "4h": candles, "1d": candles.slice(-40) },
      quote,
      depth: { bidNotional: 500, askNotional: 100, levels: 5 },
      filters,
      books,
      limits: DEFAULT_LIMITS,
      limitVersion: 1,
      now: candles.at(-1)!.closeTime + 1,
      standDown: false,
      marks: { BTCUSDT: quote.mark },
    });
    expect(events.some((event) => event.payload.reasoning || event.kind === "observation")).toBe(true);
    for (const team of TEAMS) {
      const view = books[team.id].view({ BTCUSDT: quote.mark });
      expect(view.startingEquity).toBe(2_000);
      for (const position of view.positions) {
        expect(Math.abs(position.qty * (position.mark ?? position.entryPrice))).toBeLessThanOrEqual(200.01);
      }
    }
    const blocked = runLeagueSymbol({
      symbol: "BTCUSDT",
      candles: { "5m": candles, "15m": candles, "1h": candles, "4h": candles, "1d": candles.slice(-40) },
      quote,
      depth: { bidNotional: 500, askNotional: 100, levels: 5 },
      filters,
      books,
      limits: DEFAULT_LIMITS,
      limitVersion: 1,
      now: candles.at(-1)!.closeTime + 2,
      standDown: true,
      marks: { BTCUSDT: quote.mark },
    });
    expect(blocked.every((event) => event.kind !== "fill")).toBe(true);
    for (const book of Object.values(books)) book.close();
  });

  it("flattens every team book on the kill switch", () => {
    const league = new League(mkdtempSync(path.join(tmpdir(), "league-")));
    league.books.alpha.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.05,
      leverage: 3,
      stop: 90,
      target: 130,
      bid: 100,
      ask: 100,
      filters,
      now: 1_000,
      setup: "alpha-momentum@1",
    });
    league.books.beta.placeLimit({
      symbol: "ETHUSDT",
      positionSide: "SHORT",
      orderSide: "SELL",
      qty: 0.05,
      price: 110,
      filters,
      now: 1_000,
    });
    league.kill({ BTCUSDT: { bid: 100, ask: 101, mark: 100 }, ETHUSDT: { bid: 100, ask: 101, mark: 100 } }, 2_000);
    const view = league.view({ BTCUSDT: 100, ETHUSDT: 100 });
    expect(view.teams.every((team) => team.positions.length === 0 && team.orders.length === 0)).toBe(true);
    expect(league.mode()).toBe("halted");
    const after = league.books.alpha.submitApproved({
      symbol: "BTCUSDT",
      side: "LONG",
      qty: 0.05,
      leverage: 3,
      stop: 90,
      target: 130,
      bid: 100,
      ask: 100,
      filters,
      now: 3_000,
      setup: "alpha-momentum@1",
    });
    expect(after.kind).toBe("reject");
    league.close();
  });
});

function shared(features: Features): SharedMarket {
  return {
    symbol: "BTCUSDT",
    features,
    candles15m: rising(80),
    quote,
    depth: null,
    filters,
  };
}

function reversionFeatures(): Features {
  return {
    close: 97,
    open: 99,
    high: 100,
    low: 96,
    ema20: 100,
    ema50: 100,
    prevEma20: 100,
    prevEma50: 100,
    ema20FiveAgo: 100,
    rsi: 28,
    prevRsi: 30,
    macdHistogram: 0,
    prevMacdHistogram: 0,
    bbUpper: 110,
    bbLower: 98,
    bbMiddle: 104,
    vwap: 103,
    vwapPartial: false,
    volume: 5,
    avgVolume20: 10,
    highestHigh20: 120,
    lowestLow20: 90,
    swingLow8: 95,
    swingHigh8: 101,
    regime: "range",
    bandwidth: 0.1,
    slope: 0,
    bullishDivergence: false,
    bearishDivergence: false,
    htfAgreesLong: false,
    htfAgreesShort: false,
    rsiByTimeframe: {},
  };
}

function rising(count: number): Candle[] {
  const start = Date.UTC(2026, 10, 14);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    const openTime = start + index * 900_000;
    return {
      openTime,
      open: close - 0.4,
      high: close + 0.6,
      low: close - 0.8,
      close,
      volume: 10,
      closeTime: openTime + 899_999,
    };
  });
}
