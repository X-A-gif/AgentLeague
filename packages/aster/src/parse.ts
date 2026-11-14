import type {
  BookTicker,
  Candle,
  ExchangeSnapshot,
  PremiumIndex,
  RateLimit,
  SymbolFilters,
} from "./types.js";

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number, received ${String(value)}`);
  }
  return parsed;
}

export function parseCandle(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 7) {
    throw new Error("Kline row is not the documented 12-field array");
  }
  return {
    openTime: num(row[0]),
    open: num(row[1]),
    high: num(row[2]),
    low: num(row[3]),
    close: num(row[4]),
    volume: num(row[5]),
    closeTime: num(row[6]),
  };
}

export function parsePremiumIndex(body: unknown): PremiumIndex {
  if (!body || typeof body !== "object") {
    throw new Error("Premium index response was not an object");
  }
  const row = body as Record<string, unknown>;
  return {
    symbol: String(row.symbol),
    markPrice: num(row.markPrice),
    indexPrice: num(row.indexPrice),
    lastFundingRate: num(row.lastFundingRate),
    nextFundingTime: num(row.nextFundingTime),
    interestRate: num(row.interestRate),
    time: num(row.time),
  };
}

export function parseBookTicker(body: unknown): BookTicker {
  if (!body || typeof body !== "object") {
    throw new Error("Book ticker response was not an object");
  }
  const row = body as Record<string, unknown>;
  return {
    symbol: String(row.symbol),
    bidPrice: num(row.bidPrice),
    bidQty: num(row.bidQty),
    askPrice: num(row.askPrice),
    askQty: num(row.askQty),
    time: num(row.time ?? Date.now()),
  };
}

function filterOf(filters: unknown, type: string): Record<string, unknown> | undefined {
  if (!Array.isArray(filters)) return undefined;
  return filters.find(
    (item) => item && typeof item === "object" && (item as { filterType?: string }).filterType === type,
  ) as Record<string, unknown> | undefined;
}

export function parseSymbol(row: unknown): SymbolFilters {
  if (!row || typeof row !== "object") {
    throw new Error("Symbol row was not an object");
  }
  const symbol = row as Record<string, unknown>;
  const price = filterOf(symbol.filters, "PRICE_FILTER");
  const lot = filterOf(symbol.filters, "LOT_SIZE");
  const market = filterOf(symbol.filters, "MARKET_LOT_SIZE");
  const minNotional = filterOf(symbol.filters, "MIN_NOTIONAL");
  const algo = filterOf(symbol.filters, "MAX_NUM_ALGO_ORDERS");
  return {
    symbol: String(symbol.symbol),
    status: String(symbol.status ?? ""),
    contractType: String(symbol.contractType ?? ""),
    marginAsset: String(symbol.marginAsset ?? ""),
    tickSize: num(price?.tickSize ?? "0"),
    stepSize: num(lot?.stepSize ?? "0"),
    minQty: num(lot?.minQty ?? "0"),
    maxQty: num(lot?.maxQty ?? "0"),
    marketMaxQty: num(market?.maxQty ?? lot?.maxQty ?? "0"),
    minNotional: num(minNotional?.notional ?? "0"),
    maxAlgoOrders: Number(algo?.limit ?? 0),
    orderTypes: Array.isArray(symbol.orderTypes) ? symbol.orderTypes.map(String) : [],
  };
}

export function parseExchangeInfo(body: unknown, wanted: readonly string[]): ExchangeSnapshot {
  if (!body || typeof body !== "object") {
    throw new Error("exchangeInfo response was not an object");
  }
  const info = body as Record<string, unknown>;
  const rateLimits = Array.isArray(info.rateLimits)
    ? info.rateLimits.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          rateLimitType: String(row.rateLimitType),
          interval: String(row.interval),
          intervalNum: num(row.intervalNum),
          limit: num(row.limit),
        } satisfies RateLimit;
      })
    : [];
  const symbols = Array.isArray(info.symbols)
    ? info.symbols
        .filter((row) => row && wanted.includes(String((row as { symbol?: string }).symbol)))
        .map(parseSymbol)
    : [];
  return {
    futuresType: String(info.futuresType ?? ""),
    timezone: String(info.timezone ?? ""),
    rateLimits,
    symbols,
  };
}

export function marketStreamUrl(base: string, streams: readonly string[]): string {
  return `${base}/stream?streams=${streams.join("/")}`;
}
