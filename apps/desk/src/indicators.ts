import { BollingerBands, EMA, MACD, RSI, SMA } from "technicalindicators";
import type { Candle } from "@aster/client";

export function closesOf(candles: Candle[]): number[] {
  return candles.map((candle) => candle.close);
}

export function emaSeries(values: number[], period: number): number[] {
  return EMA.calculate({ period, values });
}

export function smaSeries(values: number[], period: number): number[] {
  return SMA.calculate({ period, values });
}

export function rsiSeries(values: number[], period = 14): number[] {
  return RSI.calculate({ period, values });
}

export function macdSeries(values: number[]): { histogram: number[] } {
  const rows = MACD.calculate({
    values,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  return {
    histogram: rows.map((row) => row.histogram ?? 0),
  };
}

export function bollingerSeries(values: number[], period = 20, stdDev = 2): { upper: number; middle: number; lower: number }[] {
  return BollingerBands.calculate({ period, values, stdDev }).map((row) => ({
    upper: row.upper,
    middle: row.middle,
    lower: row.lower,
  }));
}

/** Cumulative session VWAP from UTC midnight. Typical price is (high + low + close) / 3. */
export function sessionVwap(candles: Candle[], now: number): { vwap: number; partial: boolean } | null {
  const instant = new Date(now);
  const midnight = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
  const session = candles.filter((candle) => candle.openTime >= midnight);
  const rows = session.length >= 3 ? session : candles.slice(-20);
  const partial = session.length < 3;
  let priceVolume = 0;
  let volume = 0;
  for (const row of rows) {
    const typical = (row.high + row.low + row.close) / 3;
    priceVolume += typical * row.volume;
    volume += row.volume;
  }
  if (!(volume > 0)) return null;
  return { vwap: priceVolume / volume, partial };
}

export function lastRsi(candles: Candle[]): number | null {
  const series = rsiSeries(closesOf(candles));
  return series.at(-1) ?? null;
}

export function emaSlope(candles: Candle[], period = 20, lookback = 5): number | null {
  const series = emaSeries(closesOf(candles), period);
  if (series.length <= lookback) return null;
  const last = series.at(-1)!;
  const prior = series.at(-1 - lookback)!;
  if (!(prior > 0)) return null;
  return (last - prior) / prior;
}
