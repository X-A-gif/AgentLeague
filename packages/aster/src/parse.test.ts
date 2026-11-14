import { describe, expect, it } from "vitest";
import { PublicAsterClient } from "./client.js";
import { parseCandle, parseExchangeInfo, parsePremiumIndex } from "./parse.js";

const capturedPremium = {
  symbol: "BTCUSDT",
  markPrice: "66644.40000000",
  indexPrice: "66674.29195652",
  estimatedSettlePrice: "66962.10566588",
  lastFundingRate: "0.00003976",
  interestRate: "0.00010000",
  nextFundingTime: 1794672000000,
  time: 1794663076001,
};

const capturedKline = [
  1794662700000,
  "66591.9",
  "66723.0",
  "66514.0",
  "66644.4",
  "43.754",
  1794662999999,
  "2914102.1301",
  283,
  "24.470",
  "1629885.6676",
  "0",
];

describe("public market parsers", () => {
  it("parses a captured premium index", () => {
    expect(parsePremiumIndex(capturedPremium)).toMatchObject({
      symbol: "BTCUSDT",
      markPrice: 66644.4,
      lastFundingRate: 0.00003976,
      nextFundingTime: 1794672000000,
    });
  });

  it("parses a captured kline row", () => {
    expect(parseCandle(capturedKline)).toMatchObject({
      openTime: 1794662700000,
      open: 66591.9,
      high: 66723,
      low: 66514,
      close: 66644.4,
      volume: 43.754,
      closeTime: 1794662999999,
    });
  });

  it("keeps only the requested symbols and their live filters", () => {
    const snapshot = parseExchangeInfo(
      {
        futuresType: "U_MARGINED",
        timezone: "UTC",
        rateLimits: [
          { rateLimitType: "REQUEST_WEIGHT", interval: "MINUTE", intervalNum: 1, limit: 2400 },
        ],
        symbols: [
          {
            symbol: "BTCUSDT",
            status: "TRADING",
            contractType: "PERPETUAL",
            marginAsset: "USDT",
            orderTypes: ["LIMIT", "MARKET", "STOP_MARKET", "TAKE_PROFIT_MARKET"],
            filters: [
              { filterType: "PRICE_FILTER", tickSize: "0.1", minPrice: "1", maxPrice: "1000000" },
              { filterType: "LOT_SIZE", stepSize: "0.001", minQty: "0.001", maxQty: "1000" },
              { filterType: "MARKET_LOT_SIZE", stepSize: "0.001", minQty: "0.001", maxQty: "120" },
              { filterType: "MIN_NOTIONAL", notional: "5" },
              { filterType: "MAX_NUM_ALGO_ORDERS", limit: 10 },
            ],
          },
          { symbol: "DOGEUSDT", status: "TRADING", filters: [] },
        ],
      },
      ["BTCUSDT"],
    );
    expect(snapshot.symbols).toHaveLength(1);
    expect(snapshot.symbols[0]).toMatchObject({
      symbol: "BTCUSDT",
      tickSize: 0.1,
      stepSize: 0.001,
      minNotional: 5,
      maxAlgoOrders: 10,
      marketMaxQty: 120,
    });
    expect(snapshot.symbols[0]?.orderTypes).not.toContain("FOK");
  });
});

describe("PublicAsterClient", () => {
  it("only issues GET requests and has no order method", async () => {
    let method = "";
    const client = new PublicAsterClient("https://fapi.asterdex.com", async (_url, init) => {
      method = init?.method ?? "";
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    await client.ping();
    expect(method).toBe("GET");
    expect("placeOrder" in client).toBe(false);
    expect("withdraw" in client).toBe(false);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(client)).sort()).toEqual([
      "bookTicker",
      "constructor",
      "exchangeInfo",
      "getJson",
      "klines",
      "ping",
      "premiumIndex",
      "time",
    ]);
  });
});
