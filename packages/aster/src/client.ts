import { MAINNET_REST } from "./types.js";
import {
  parseBookTicker,
  parseCandle,
  parseExchangeInfo,
  parsePremiumIndex,
} from "./parse.js";
import type { BookTicker, Candle, ExchangeSnapshot, Interval, PremiumIndex } from "./types.js";

export class AsterHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "AsterHttpError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function parseLevels(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value.map((level) => {
    if (!Array.isArray(level) || level.length < 2) throw new Error("Depth level was malformed");
    return [Number(level[0]), Number(level[1])] as [number, number];
  });
}

/**
 * Public market-data client. Every request is GET.
 * There is no order, cancel, transfer, or withdraw method.
 */
export class PublicAsterClient {
  constructor(
    private readonly baseUrl = MAINNET_REST,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async ping(): Promise<void> {
    await this.getJson("/fapi/v3/ping");
  }

  async time(): Promise<number> {
    const body = await this.getJson("/fapi/v3/time");
    if (!body || typeof body !== "object" || !("serverTime" in body)) {
      throw new Error("Server time response did not include serverTime");
    }
    return Number((body as { serverTime: unknown }).serverTime);
  }

  async exchangeInfo(symbols: readonly string[]): Promise<ExchangeSnapshot> {
    return parseExchangeInfo(await this.getJson("/fapi/v3/exchangeInfo"), symbols);
  }

  async klines(symbol: string, interval: Interval, limit = 300): Promise<Candle[]> {
    const body = await this.getJson("/fapi/v3/klines", { symbol, interval, limit: String(limit) });
    if (!Array.isArray(body)) {
      throw new Error("Klines response was not an array");
    }
    return body.map(parseCandle);
  }

  async premiumIndex(symbol: string): Promise<PremiumIndex> {
    return parsePremiumIndex(await this.getJson("/fapi/v3/premiumIndex", { symbol }));
  }

  async bookTicker(symbol: string): Promise<BookTicker> {
    return parseBookTicker(await this.getJson("/fapi/v3/ticker/bookTicker", { symbol }));
  }

  /** Public order book. Documented `GET /fapi/v3/depth`. Quantities are contracts, not a liquidity-cluster feed. */
  async depth(symbol: string, limit = 20): Promise<{ bids: Array<[number, number]>; asks: Array<[number, number]> }> {
    const body = await this.getJson("/fapi/v3/depth", { symbol, limit: String(limit) });
    if (!body || typeof body !== "object") throw new Error("Depth response was not an object");
    const book = body as { bids?: unknown; asks?: unknown };
    return { bids: parseLevels(book.bids), asks: parseLevels(book.asks) };
  }

  private async getJson(path: string, query?: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "aster-research-desk/0.1" },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const record = body && typeof body === "object" ? (body as { code?: unknown; msg?: unknown }) : {};
      const code = typeof record.code === "number" ? record.code : null;
      const message = typeof record.msg === "string" ? record.msg : `Aster GET ${path} failed (${response.status})`;
      throw new AsterHttpError(response.status, code, message);
    }
    return body;
  }
}
