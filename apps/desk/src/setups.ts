import type { Side } from "@aster/risk";
import type { Features } from "./features.js";

export type SetupName =
  | "ma_cross"
  | "momentum"
  | "breakout"
  | "failed_breakdown"
  | "failed_breakout"
  | "mean_reversion";

export type Setup = {
  name: SetupName;
  side: Side;
  rank: number;
  stop: number;
  target: number;
  invalidation: string;
  tags: string[];
};

const BASE_RANK: Record<SetupName, number> = {
  breakout: 4,
  failed_breakdown: 4,
  failed_breakout: 4,
  ma_cross: 3,
  momentum: 2,
  mean_reversion: 1,
};

function agrees(features: Features, side: Side): boolean {
  return side === "LONG" ? features.htfAgreesLong : features.htfAgreesShort;
}

export function detectSetups(features: Features, tickSize: number): Setup[] {
  const found: Setup[] = [];
  const volumeExpansion = features.avgVolume20 > 0 && features.volume > features.avgVolume20 * 1.5;
  const tick = tickSize > 0 ? tickSize : 0;

  const push = (name: SetupName, side: Side, rawStop: number, rawTarget: number, invalidation: string) => {
    const stop = toTick(rawStop, tick);
    const target = toTick(rawTarget, tick);
    if (side === "LONG" && !(stop < features.close && target > features.close)) return;
    if (side === "SHORT" && !(stop > features.close && target < features.close)) return;
    const tags: string[] = [];
    if (side === "LONG" && features.bullishDivergence) tags.push("rsi_divergence");
    if (side === "SHORT" && features.bearishDivergence) tags.push("rsi_divergence");
    const rank = BASE_RANK[name] - (agrees(features, side) ? 0 : 0.5);
    found.push({ name, side, rank, stop, target, invalidation, tags });
  };

  if (features.prevEma20 <= features.prevEma50 && features.ema20 > features.ema50) {
    const stop = features.swingLow8 - tick;
    push(
      "ma_cross",
      "LONG",
      stop,
      features.close + (features.close - stop) * 2,
      "Invalid if a 15m close falls back under the 50 EMA.",
    );
  }
  if (features.prevEma20 >= features.prevEma50 && features.ema20 < features.ema50) {
    const stop = features.swingHigh8 + tick;
    push(
      "ma_cross",
      "SHORT",
      stop,
      features.close - (stop - features.close) * 2,
      "Invalid if a 15m close reclaims the 50 EMA.",
    );
  }

  if (
    features.macdHistogram > 0 &&
    features.macdHistogram > features.prevMacdHistogram &&
    features.rsi >= 50 &&
    features.rsi <= 70
  ) {
    const stop = features.swingLow8 - tick;
    push(
      "momentum",
      "LONG",
      stop,
      features.close + (features.close - stop) * 2,
      "Invalid if the 15m MACD histogram flips negative.",
    );
  }
  if (
    features.macdHistogram < 0 &&
    features.macdHistogram < features.prevMacdHistogram &&
    features.rsi >= 30 &&
    features.rsi <= 50
  ) {
    const stop = features.swingHigh8 + tick;
    push(
      "momentum",
      "SHORT",
      stop,
      features.close - (stop - features.close) * 2,
      "Invalid if the 15m MACD histogram flips positive.",
    );
  }

  if (features.close > features.highestHigh20 && volumeExpansion) {
    const stop = features.swingLow8 - tick;
    push(
      "breakout",
      "LONG",
      stop,
      features.close + (features.close - stop) * 2,
      "Invalid if a 15m close falls back inside the prior 20-bar range.",
    );
  }
  if (features.close < features.lowestLow20 && volumeExpansion) {
    const stop = features.swingHigh8 + tick;
    push(
      "breakout",
      "SHORT",
      stop,
      features.close - (stop - features.close) * 2,
      "Invalid if a 15m close reclaims the prior 20-bar range.",
    );
  }

  if (features.low < features.lowestLow20 && features.close > features.lowestLow20 && features.close > features.open) {
    const stop = features.low - tick;
    push(
      "failed_breakdown",
      "LONG",
      stop,
      Math.max(features.highestHigh20, features.close + (features.close - stop) * 2),
      "Invalid if price closes back under the reclaimed low.",
    );
  }
  if (features.high > features.highestHigh20 && features.close < features.highestHigh20 && features.close < features.open) {
    const stop = features.high + tick;
    const structural = features.lowestLow20 < features.close ? features.lowestLow20 : features.close - (stop - features.close) * 2;
    push(
      "failed_breakout",
      "SHORT",
      stop,
      structural,
      "Invalid if price closes back above the rejected high.",
    );
  }

  if (features.regime === "range") {
    if (features.close <= features.bbLower || (features.close < features.vwap * 0.998 && features.rsi < 35)) {
      push(
        "mean_reversion",
        "LONG",
        Math.min(features.swingLow8, features.bbLower) - tick,
        features.bbMiddle,
        "Invalid if a 15m close finishes outside the lower band and past the stop.",
      );
    }
    if (features.close >= features.bbUpper || (features.close > features.vwap * 1.002 && features.rsi > 65)) {
      push(
        "mean_reversion",
        "SHORT",
        Math.max(features.swingHigh8, features.bbUpper) + tick,
        features.bbMiddle,
        "Invalid if a 15m close finishes outside the upper band and past the stop.",
      );
    }
  }

  return found;
}

function toTick(price: number, tick: number): number {
  if (!(tick > 0)) return price;
  const decimals = (tick.toString().split(".")[1] ?? "").length;
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

export function bestBySide(setups: Setup[]): { long?: Setup; short?: Setup } {
  const pick = (side: Side) =>
    setups
      .filter((setup) => setup.side === side)
      .sort((a, b) => b.rank - a.rank)[0];
  return { long: pick("LONG"), short: pick("SHORT") };
}
