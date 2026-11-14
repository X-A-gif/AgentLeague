import type { Candle, SymbolFilters } from "@aster/client";
import {
  applyHeadDecision,
  evaluateRisk,
  type AccountState,
  type Limits,
  type RiskDecision,
  type Ticket,
} from "@aster/risk";
import { buildFeatures, type Features } from "./features.js";
import { lastRsi } from "./indicators.js";
import { bestBySide, detectSetups, type Setup } from "./setups.js";

export type Quote = {
  mark: number;
  index: number;
  fundingRate: number;
  nextFundingTime: number;
  bid: number;
  ask: number;
};

export type ResearchDecision = {
  ticket: Ticket;
  risk: RiskDecision;
  headNote: string;
  headQty: number | null;
};

export type ResearchPass = {
  symbol: string;
  candleOpenTime: number | null;
  features: Features | null;
  market: Record<string, unknown>;
  technical: Record<string, unknown>;
  news: Record<string, unknown>;
  setups: Setup[];
  decisions: ResearchDecision[];
  exposureAfter: number;
};

function spreadBps(quote: Quote): number | null {
  const mid = (quote.bid + quote.ask) / 2;
  if (!(mid > 0)) return null;
  return ((quote.ask - quote.bid) / mid) * 10_000;
}

function ticketFrom(symbol: string, features: Features, setup: Setup, newsFlag: Ticket["newsFlag"]): Ticket {
  const name = setup.tags.length > 0 ? `${setup.name}+${setup.tags.join("+")}` : setup.name;
  return {
    symbol,
    side: setup.side,
    setup: name,
    entryType: "MARKET",
    entry: features.close,
    stop: setup.stop,
    targets: [setup.target],
    timeframe: "15m",
    newsFlag,
  };
}

export function runResearch(input: {
  symbol: string;
  filters: SymbolFilters;
  quote: Quote;
  candles: Record<"5m" | "15m" | "1h" | "4h" | "1d", Candle[]>;
  limits: Limits;
  limitVersion: number;
  account: AccountState;
  now: number;
  standDown: boolean;
}): ResearchPass {
  const newsFlag = input.standDown ? "stand_down" : "clear";
  const rsiByTimeframe = {
    "5m": lastRsi(input.candles["5m"]),
    "15m": lastRsi(input.candles["15m"]),
    "1h": lastRsi(input.candles["1h"]),
    "4h": lastRsi(input.candles["4h"]),
    "1d": lastRsi(input.candles["1d"]),
  };
  const features = buildFeatures({
    candles15m: input.candles["15m"],
    candles1h: input.candles["1h"],
    candles4h: input.candles["4h"],
    rsiByTimeframe,
    now: input.now,
  });
  const spread = spreadBps(input.quote);
  const candle = input.candles["15m"].at(-1);
  const news = {
    summary: input.standDown
      ? "Operator stand-down is on. No new tickets."
      : "News model is off. No catalyst flag is being inferred.",
    flag: newsFlag,
    provider: "disabled",
  };

  if (!features) {
    return {
      symbol: input.symbol,
      candleOpenTime: candle?.openTime ?? null,
      features: null,
      market: {
        summary: `${input.symbol} does not have enough closed 15m candles yet.`,
        spreadBps: spread,
      },
      technical: { summary: "Waiting for 60 closed 15-minute candles.", rsiByTimeframe },
      news,
      setups: [],
      decisions: [],
      exposureAfter: input.account.grossExposure,
    };
  }

  const chosen = input.standDown ? { long: undefined, short: undefined } : bestBySide(detectSetups(features, input.filters.tickSize));
  const setups = [chosen.long, chosen.short].filter((setup): setup is Setup => Boolean(setup));
  let exposure = input.account.grossExposure;
  const decisions = setups.map((setup) => {
    const ticket = ticketFrom(input.symbol, features, setup, newsFlag);
    const risk = evaluateRisk({
      ticket,
      limits: input.limits,
      limitVersion: input.limitVersion,
      account: { ...input.account, grossExposure: exposure },
      filters: input.filters,
      quote: { mark: input.quote.mark, bid: input.quote.bid, ask: input.quote.ask },
    });
    const head = applyHeadDecision(risk.qty ?? 0, { status: "disabled" });
    if (risk.action === "approve" && risk.notional) exposure += risk.notional;
    return { ticket, risk, headNote: head.note, headQty: risk.action === "approve" ? head.qty : null };
  });

  const conflict = setups.some((setup) => (setup.side === "LONG" ? !features.htfAgreesLong : !features.htfAgreesShort));
  const names = setups.map((setup) => `${setup.side.toLowerCase()} ${setup.name}`).join(", ");

  return {
    symbol: input.symbol,
    candleOpenTime: candle?.openTime ?? null,
    features,
    market: {
      summary: `${input.symbol} 15m ${features.regime.replaceAll("_", " ")}, band width ${(features.bandwidth * 100).toFixed(2)}%, spread ${spread === null ? "unknown" : `${spread.toFixed(2)} bps`}.`,
      regime: features.regime,
      slope: features.slope,
      bandwidth: features.bandwidth,
      spreadBps: spread,
      mark: input.quote.mark,
      fundingRate: input.quote.fundingRate,
    },
    technical: {
      summary: `${input.symbol} RSI ${features.rsi.toFixed(1)}, EMA20 ${features.ema20.toFixed(2)} / EMA50 ${features.ema50.toFixed(2)}. ${names || "No setup met the rules."}${conflict ? " Higher timeframes do not agree." : ""}`,
      rsiByTimeframe,
      ema20: features.ema20,
      ema50: features.ema50,
      macdHistogram: features.macdHistogram,
      vwap: features.vwap,
      bbUpper: features.bbUpper,
      bbLower: features.bbLower,
      bbMiddle: features.bbMiddle,
      bullishDivergence: features.bullishDivergence,
      bearishDivergence: features.bearishDivergence,
    },
    news,
    setups,
    decisions,
    exposureAfter: exposure,
  };
}
