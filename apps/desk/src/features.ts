import type { Candle } from "@aster/client";
import { bollingerSeries, emaSeries, emaSlope, lastRsi, macdSeries, rsiSeries, sessionVwap } from "./indicators.js";

export type Regime = "trend_up" | "trend_down" | "range";

export type Features = {
  close: number;
  open: number;
  high: number;
  low: number;
  ema20: number;
  ema50: number;
  prevEma20: number;
  prevEma50: number;
  ema20FiveAgo: number;
  rsi: number;
  prevRsi: number;
  macdHistogram: number;
  prevMacdHistogram: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  vwap: number;
  vwapPartial: boolean;
  volume: number;
  avgVolume20: number;
  highestHigh20: number;
  lowestLow20: number;
  swingLow8: number;
  swingHigh8: number;
  regime: Regime;
  bandwidth: number;
  slope: number;
  bullishDivergence: boolean;
  bearishDivergence: boolean;
  htfAgreesLong: boolean;
  htfAgreesShort: boolean;
  rsiByTimeframe: Record<string, number | null>;
};

export function classifyRegime(input: {
  close: number;
  ema50: number;
  slope: number;
  bandwidth: number;
}): Regime {
  if (input.slope > 0.0015 && input.close > input.ema50) return "trend_up";
  if (input.slope < -0.0015 && input.close < input.ema50) return "trend_down";
  if (Math.abs(input.slope) <= 0.0015 || input.bandwidth < 0.02) return "range";
  return input.slope >= 0 ? "trend_up" : "trend_down";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type Swing = { index: number; price: number; rsi: number };

function swings(candles: Candle[], rsi: number[], kind: "low" | "high"): Swing[] {
  const found: Swing[] = [];
  const start = Math.max(1, candles.length - 40);
  for (let index = start; index < candles.length - 1; index += 1) {
    const price = kind === "low" ? candles[index]!.low : candles[index]!.high;
    const before = kind === "low" ? candles[index - 1]!.low : candles[index - 1]!.high;
    const after = kind === "low" ? candles[index + 1]!.low : candles[index + 1]!.high;
    const isSwing = kind === "low" ? price < before && price < after : price > before && price > after;
    const oscillator = rsi[index];
    if (isSwing && oscillator !== undefined) {
      found.push({ index, price, rsi: oscillator });
    }
  }
  return found;
}

export function bullishDivergence(candles: Candle[], rsi: number[]): boolean {
  const points = swings(candles, rsi, "low");
  if (points.length < 2) return false;
  const earlier = points[points.length - 2]!;
  const later = points[points.length - 1]!;
  return later.price < earlier.price && later.rsi > earlier.rsi;
}

export function bearishDivergence(candles: Candle[], rsi: number[]): boolean {
  const points = swings(candles, rsi, "high");
  if (points.length < 2) return false;
  const earlier = points[points.length - 2]!;
  const later = points[points.length - 1]!;
  return later.price > earlier.price && later.rsi < earlier.rsi;
}

function alignedRsi(candles: Candle[]): number[] {
  const closes = candles.map((candle) => candle.close);
  const rsi = rsiSeries(closes);
  const offset = closes.length - rsi.length;
  const aligned = Array<number>(closes.length).fill(Number.NaN);
  rsi.forEach((value, index) => {
    aligned[index + offset] = value;
  });
  return aligned;
}

export function buildFeatures(input: {
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  rsiByTimeframe: Record<string, number | null>;
  now: number;
}): Features | null {
  const candles = input.candles15m;
  if (candles.length < 60) return null;
  const closes = candles.map((candle) => candle.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const rsi = rsiSeries(closes);
  const macd = macdSeries(closes);
  const bands = bollingerSeries(closes);
  if (ema20.length < 6 || ema50.length < 2 || rsi.length < 2 || macd.histogram.length < 2 || bands.length < 1) {
    return null;
  }
  const last = candles[candles.length - 1]!;
  const prior20 = candles.slice(-21, -1);
  if (prior20.length < 20) return null;
  const band = bands[bands.length - 1]!;
  const slope = (ema20[ema20.length - 1]! - ema20[ema20.length - 6]!) / ema20[ema20.length - 6]!;
  const bandwidth = (band.upper - band.lower) / band.middle;
  const vwap = sessionVwap(candles, input.now);
  if (!vwap) return null;
  const aligned = alignedRsi(candles);
  const hourSlope = emaSlope(input.candles1h);
  const fourHourSlope = emaSlope(input.candles4h);
  return {
    close: last.close,
    open: last.open,
    high: last.high,
    low: last.low,
    ema20: ema20[ema20.length - 1]!,
    ema50: ema50[ema50.length - 1]!,
    prevEma20: ema20[ema20.length - 2]!,
    prevEma50: ema50[ema50.length - 2]!,
    ema20FiveAgo: ema20[ema20.length - 6]!,
    rsi: rsi[rsi.length - 1]!,
    prevRsi: rsi[rsi.length - 2]!,
    macdHistogram: macd.histogram[macd.histogram.length - 1]!,
    prevMacdHistogram: macd.histogram[macd.histogram.length - 2]!,
    bbUpper: band.upper,
    bbLower: band.lower,
    bbMiddle: band.middle,
    vwap: vwap.vwap,
    vwapPartial: vwap.partial,
    volume: last.volume,
    avgVolume20: average(prior20.map((candle) => candle.volume)),
    highestHigh20: Math.max(...prior20.map((candle) => candle.high)),
    lowestLow20: Math.min(...prior20.map((candle) => candle.low)),
    swingLow8: Math.min(...candles.slice(-8).map((candle) => candle.low)),
    swingHigh8: Math.max(...candles.slice(-8).map((candle) => candle.high)),
    regime: classifyRegime({ close: last.close, ema50: ema50[ema50.length - 1]!, slope, bandwidth }),
    bandwidth,
    slope,
    bullishDivergence: bullishDivergence(candles, aligned),
    bearishDivergence: bearishDivergence(candles, aligned),
    htfAgreesLong: (hourSlope === null || hourSlope >= 0) && (fourHourSlope === null || fourHourSlope >= 0),
    htfAgreesShort: (hourSlope === null || hourSlope <= 0) && (fourHourSlope === null || fourHourSlope <= 0),
    rsiByTimeframe: input.rsiByTimeframe,
  };
}
