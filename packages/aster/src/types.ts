export const MAINNET_REST = "https://fapi.asterdex.com";
export const TESTNET_REST = "https://fapi.asterdex-testnet.com";
export const MAINNET_WS = "wss://fstream.asterdex.com";
export const TESTNET_WS = "wss://fstream.asterdex-testnet.com";

export type Interval = "5m" | "15m" | "1h" | "4h" | "1d";

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type PremiumIndex = {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  interestRate: number;
  time: number;
};

export type BookTicker = {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  time: number;
};

export type SymbolFilters = {
  symbol: string;
  status: string;
  contractType: string;
  marginAsset: string;
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  marketMaxQty: number;
  minNotional: number;
  maxAlgoOrders: number;
  orderTypes: string[];
};

export type RateLimit = {
  rateLimitType: string;
  interval: string;
  intervalNum: number;
  limit: number;
};

export type ExchangeSnapshot = {
  futuresType: string;
  timezone: string;
  rateLimits: RateLimit[];
  symbols: SymbolFilters[];
};
