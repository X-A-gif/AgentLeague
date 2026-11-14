export type Limits = {
  maxLeverage: number;
  riskPerTrade: number;
  maxPositionNotionalPct: number;
  maxGrossExposurePct: number;
  maxDailyLossPct: number;
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
  minRewardRisk: number;
  slippageAbortBps: number;
};

export const DEFAULT_LIMITS: Limits = {
  maxLeverage: 3,
  riskPerTrade: 0.005,
  maxPositionNotionalPct: 0.1,
  maxGrossExposurePct: 0.3,
  maxDailyLossPct: 0.02,
  maxConsecutiveLosses: 3,
  maxDrawdownPct: 0.1,
  minRewardRisk: 1.5,
  slippageAbortBps: 10,
};

/** True when `next` allows more risk than `prev`. Tightening is never looser. */
export function isLooser(next: Limits, prev: Limits): boolean {
  return (
    next.maxLeverage > prev.maxLeverage ||
    next.riskPerTrade > prev.riskPerTrade ||
    next.maxPositionNotionalPct > prev.maxPositionNotionalPct ||
    next.maxGrossExposurePct > prev.maxGrossExposurePct ||
    next.maxDailyLossPct > prev.maxDailyLossPct ||
    next.maxConsecutiveLosses > prev.maxConsecutiveLosses ||
    next.maxDrawdownPct > prev.maxDrawdownPct ||
    next.minRewardRisk < prev.minRewardRisk ||
    next.slippageAbortBps > prev.slippageAbortBps
  );
}

/**
 * 1 until two losses, then 0.5, then 0 once the streak hits the cap.
 * The factor never rises above 1, including after a win.
 */
export function streakFactor(consecutiveLosses: number, maxConsecutiveLosses: number): number {
  if (consecutiveLosses >= maxConsecutiveLosses) return 0;
  if (consecutiveLosses >= 2) return 0.5;
  return 1;
}
