import type { Candle } from "@aster/client";
import { averageDirectionalIndex, averageTrueRange } from "../indicators.js";
import { detectSetups, type Setup } from "../setups.js";
import { TEAMS, type SharedMarket, type TeamId, type TeamProposal } from "./types.js";

const DELTA = TEAMS[3]!;
const EPSILON = TEAMS[4]!;

function proposal(team: TeamId, market: SharedMarket, setup: Setup, confidence: number, extra: Record<string, number | string | boolean | null>): TeamProposal {
  const definition = TEAMS.find((item) => item.id === team)!;
  const indicators = {
    close: market.features.close,
    rsi: market.features.rsi,
    ema20: market.features.ema20,
    ema50: market.features.ema50,
    regime: market.features.regime,
    setup: setup.name,
    ...extra,
  };
  return {
    teamId: team,
    strategyId: definition.strategyId,
    strategyVersion: definition.strategyVersion,
    symbol: market.symbol,
    side: setup.side,
    entry: market.features.close,
    stop: setup.stop,
    targets: [setup.target],
    confidence,
    reasoning: `${definition.name} v${definition.strategyVersion} ${setup.side} ${setup.name} on ${market.symbol}. ${setup.invalidation} Entry ${market.features.close}, stop ${setup.stop}, target ${setup.target}.`,
    indicators,
  };
}

export function proposeAlpha(market: SharedMarket): TeamProposal | null {
  const volumeExpansion = market.features.avgVolume20 > 0 && market.features.volume > market.features.avgVolume20 * 1.5;
  const setup = detectSetups(market.features, market.filters.tickSize)
    .filter((item) => item.name === "breakout" || (item.name === "momentum" && volumeExpansion))
    .sort((a, b) => b.rank - a.rank)[0];
  if (!setup) return null;
  const ratio = market.features.avgVolume20 > 0 ? market.features.volume / market.features.avgVolume20 : 0;
  return proposal("alpha", market, setup, Math.min(1, ratio / 3), { volumeRatio: ratio });
}

export function proposeBeta(market: SharedMarket): TeamProposal | null {
  const { features } = market;
  const withTrend = features.regime === "trend_up" || features.regime === "trend_down";
  if (!withTrend) return null;
  const adx = averageDirectionalIndex(market.candles15m);
  if (adx === null || adx < 20) return null;
  const setup = detectSetups(features, market.filters.tickSize)
    .filter((item) => item.name === "ma_cross")
    .filter((item) => (item.side === "LONG" ? features.htfAgreesLong : features.htfAgreesShort))
    .filter((item) => (item.side === "LONG" ? features.rsi <= 75 : features.rsi >= 25))
    .filter((item) => (item.side === "LONG" ? features.regime === "trend_up" : features.regime === "trend_down"))[0];
  if (!setup) return null;
  return proposal("beta", market, setup, Math.min(1, adx / 40), { adx });
}

export function proposeGamma(market: SharedMarket): TeamProposal | null {
  const setup = detectSetups(market.features, market.filters.tickSize)
    .filter((item) => item.name === "mean_reversion" || item.name === "failed_breakdown" || item.name === "failed_breakout")
    .sort((a, b) => b.rank - a.rank)[0];
  if (!setup) return null;
  const extreme = setup.side === "LONG" ? market.features.rsi < 35 : market.features.rsi > 65;
  const diverged = setup.tags.includes("rsi_divergence");
  if (!extreme && !diverged && setup.name === "mean_reversion") return null;
  return proposal("gamma", market, setup, extreme ? 0.7 : 0.55, {
    rsiExtreme: extreme,
    divergence: diverged,
  });
}

export function proposeDelta(market: SharedMarket): TeamProposal | null {
  const depth = market.depth;
  if (!depth || !(depth.bidNotional > 0) || !(depth.askNotional > 0)) return null;
  const atr = averageTrueRange(market.candles15m);
  if (atr === null || !(atr > 0)) return null;
  const bidRatio = depth.bidNotional / depth.askNotional;
  const askRatio = depth.askNotional / depth.bidNotional;
  const spreadBps = spread(market);
  if (spreadBps === null || spreadBps > 8) return null;
  const close = market.features.close;
  const tick = market.filters.tickSize;
  let side: "LONG" | "SHORT" | null = null;
  if (bidRatio >= 1.5 && market.quote.fundingRate < 0) side = "LONG";
  else if (askRatio >= 1.5 && market.quote.fundingRate > 0) side = "SHORT";
  if (!side) return null;
  const stop = side === "LONG" ? close - atr * 1.5 : close + atr * 1.5;
  const target = side === "LONG" ? close + atr * 3 : close - atr * 3;
  const snapped = snap(stop, target, tick, side, close);
  if (!snapped) return null;
  return {
    teamId: "delta",
    strategyId: DELTA.strategyId,
    strategyVersion: DELTA.strategyVersion,
    symbol: market.symbol,
    side,
    entry: close,
    stop: snapped.stop,
    targets: [snapped.target],
    confidence: Math.min(1, (side === "LONG" ? bidRatio : askRatio) / 3),
    reasoning: `Delta v1 ${side} ${market.symbol} from top-of-book imbalance ${side === "LONG" ? bidRatio.toFixed(2) : askRatio.toFixed(2)} and funding ${market.quote.fundingRate}. Stop is 1.5 ATR. Open interest and a liquidation map are not used.`,
    indicators: {
      bidNotional: depth.bidNotional,
      askNotional: depth.askNotional,
      fundingRate: market.quote.fundingRate,
      atr,
      spreadBps,
    },
  };
}

export function proposeEpsilon(market: SharedMarket): TeamProposal | null {
  const stats = continuationStats(market.candles15m);
  if (!stats) return null;
  const close = market.features.close;
  const tick = market.filters.tickSize;
  const risk = Math.max(Math.abs(stats.z) * stats.sigma * close, close * 0.002);
  let side: "LONG" | "SHORT" | null = null;
  if (stats.z > 1.5 && stats.upSamples >= 8 && stats.upHitRate >= 0.55) side = "LONG";
  if (stats.z < -1.5 && stats.downSamples >= 8 && stats.downHitRate >= 0.55) side = "SHORT";
  if (!side) return null;
  const stop = side === "LONG" ? close - risk : close + risk;
  const target = side === "LONG" ? close + risk * 2 : close - risk * 2;
  const snapped = snap(stop, target, tick, side, close);
  if (!snapped) return null;
  const hitRate = side === "LONG" ? stats.upHitRate : stats.downHitRate;
  const samples = side === "LONG" ? stats.upSamples : stats.downSamples;
  return {
    teamId: "epsilon",
    strategyId: EPSILON.strategyId,
    strategyVersion: EPSILON.strategyVersion,
    symbol: market.symbol,
    side,
    entry: close,
    stop: snapped.stop,
    targets: [snapped.target],
    confidence: hitRate,
    reasoning: `Epsilon v1 ${side} ${market.symbol}. Latest 15m return z-score ${stats.z.toFixed(2)}. In-sample continuation hit rate ${(hitRate * 100).toFixed(0)}% over ${samples} prior shocks in this loaded window. This is not an out-of-sample proof.`,
    indicators: {
      z: stats.z,
      hitRate,
      samples,
      sigma: stats.sigma,
    },
  };
}

export const PROPOSERS: Record<TeamId, (market: SharedMarket) => TeamProposal | null> = {
  alpha: proposeAlpha,
  beta: proposeBeta,
  gamma: proposeGamma,
  delta: proposeDelta,
  epsilon: proposeEpsilon,
};

function spread(market: SharedMarket): number | null {
  const mid = (market.quote.bid + market.quote.ask) / 2;
  if (!(mid > 0)) return null;
  return ((market.quote.ask - market.quote.bid) / mid) * 10_000;
}

function snap(stop: number, target: number, tick: number, side: "LONG" | "SHORT", close: number): { stop: number; target: number } | null {
  const step = tick > 0 ? tick : 0;
  const snappedStop = step > 0 ? Number((Math.round(stop / step) * step).toFixed(decimals(step))) : stop;
  const snappedTarget = step > 0 ? Number((Math.round(target / step) * step).toFixed(decimals(step))) : target;
  if (side === "LONG" && !(snappedStop < close && snappedTarget > close)) return null;
  if (side === "SHORT" && !(snappedStop > close && snappedTarget < close)) return null;
  return { stop: snappedStop, target: snappedTarget };
}

function decimals(step: number): number {
  return (step.toString().split(".")[1] ?? "").length;
}

export function continuationStats(candles: Candle[]): {
  z: number;
  sigma: number;
  upHitRate: number;
  upSamples: number;
  downHitRate: number;
  downSamples: number;
} | null {
  if (candles.length < 40) return null;
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1]!.close;
    if (!(previous > 0)) return null;
    returns.push((candles[index]!.close - previous) / previous);
  }
  let upHits = 0;
  let upSamples = 0;
  let downHits = 0;
  let downSamples = 0;
  for (let index = 20; index < returns.length - 1; index += 1) {
    const prior = returns.slice(0, index);
    const sigma = std(prior);
    if (!(sigma > 0)) continue;
    const z = (returns[index]! - mean(prior)) / sigma;
    const next = returns[index + 1]!;
    if (z > 1.5) {
      upSamples += 1;
      if (next > 0) upHits += 1;
    }
    if (z < -1.5) {
      downSamples += 1;
      if (next < 0) downHits += 1;
    }
  }
  const history = returns.slice(0, -1);
  const sigma = std(history);
  if (!(sigma > 0)) return null;
  return {
    z: (returns[returns.length - 1]! - mean(history)) / sigma,
    sigma,
    upHitRate: upSamples > 0 ? upHits / upSamples : 0,
    upSamples,
    downHitRate: downSamples > 0 ? downHits / downSamples : 0,
    downSamples,
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
