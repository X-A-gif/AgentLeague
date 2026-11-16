import { streakFactor, type Limits } from "./limits.js";

export type Side = "LONG" | "SHORT";

export type Ticket = {
  symbol: string;
  side: Side;
  setup: string;
  entryType: "MARKET" | "LIMIT";
  entry: number;
  stop: number;
  targets: number[];
  timeframe: string;
  newsFlag: "clear" | "caution" | "stand_down";
};

export type Filters = {
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  marketMaxQty: number;
  minNotional: number;
};

export type AccountState = {
  equity: number;
  availableMargin: number;
  grossExposure: number;
  dailyRealizedLoss: number;
  consecutiveLosses: number;
  drawdownPct: number;
  halted: boolean;
  /** Used only for the pre-trade liquidation estimate. Not an exchange liquidation price. */
  maintenanceMarginRate: number;
};

export type MarketQuote = {
  mark: number;
  bid: number;
  ask: number;
};

export type RiskCode =
  | "OK"
  | "HALTED"
  | "STAND_DOWN"
  | "MISSING_STOP"
  | "NO_TARGET"
  | "REWARD_RISK"
  | "DAILY_LOSS"
  | "DRAWDOWN"
  | "LOSS_STREAK"
  | "SLIPPAGE"
  | "POSITION_CAP"
  | "EXPOSURE"
  | "LEVERAGE"
  | "MIN_SIZE"
  | "LIQUIDATION"
  | "STALE"
  | "LIMIT_VERSION";

export type RiskDecision = {
  action: "approve" | "reject";
  code: RiskCode;
  reason: string;
  qty: number | null;
  notional: number | null;
  leverage: number | null;
  riskCash: number | null;
  rewardRisk: number | null;
  /** Quantity from the risk budget before position, exposure, and leverage caps. */
  uncappedQty: number | null;
  streakFactor: number;
  limitVersion: number;
  decidedAt?: number;
};

export type HeadDecision =
  | { status: "disabled" }
  | { status: "reject" }
  | { status: "accept"; qty: number };

function reject(
  code: RiskCode,
  reason: string,
  limitVersion: number,
  factor: number,
  extra: Partial<RiskDecision> = {},
): RiskDecision {
  return {
    action: "reject",
    code,
    reason,
    qty: null,
    notional: null,
    leverage: null,
    riskCash: extra.riskCash ?? null,
    rewardRisk: extra.rewardRisk ?? null,
    uncappedQty: extra.uncappedQty ?? null,
    streakFactor: factor,
    limitVersion,
  };
}

function floorToStep(qty: number, step: number): number {
  if (!(step > 0)) return qty;
  const steps = Math.floor(qty / step + 1e-9);
  const decimals = (step.toString().split(".")[1] ?? "").length;
  return Number((steps * step).toFixed(decimals));
}

function estimatedLiquidation(entry: number, side: Side, leverage: number, mmr: number): number {
  if (side === "LONG") return entry * (1 - 1 / leverage + mmr);
  return entry * (1 + 1 / leverage - mmr);
}

export function evaluateRisk(input: {
  ticket: Ticket;
  limits: Limits;
  limitVersion: number;
  account: AccountState;
  filters: Filters;
  quote: MarketQuote;
}): RiskDecision {
  const { ticket, limits, account, filters, quote } = input;
  const version = input.limitVersion;
  const factor = streakFactor(account.consecutiveLosses, limits.maxConsecutiveLosses);

  if (account.halted) return reject("HALTED", "Desk is halted", version, factor);
  if (ticket.newsFlag === "stand_down") return reject("STAND_DOWN", "News stand-down is on", version, factor);
  const stopOnCorrectSide = ticket.side === "LONG" ? ticket.stop < ticket.entry : ticket.stop > ticket.entry;
  if (!(ticket.entry > 0) || !(ticket.stop > 0) || !stopOnCorrectSide) {
    return reject("MISSING_STOP", "A stop on the correct side of the entry is required", version, factor);
  }
  if (account.dailyRealizedLoss >= account.equity * limits.maxDailyLossPct) {
    return reject("DAILY_LOSS", "Daily loss limit reached", version, factor);
  }
  if (account.drawdownPct >= limits.maxDrawdownPct) {
    return reject("DRAWDOWN", "Drawdown limit reached", version, factor);
  }
  if (factor === 0) return reject("LOSS_STREAK", "Consecutive-loss limit reached", version, factor);

  const target = ticket.targets[0];
  if (target === undefined) return reject("NO_TARGET", "Ticket has no target", version, factor);
  const stopDistance = Math.abs(ticket.entry - ticket.stop);
  const rewardRisk = Math.abs(target - ticket.entry) / stopDistance;
  if (rewardRisk < limits.minRewardRisk) {
    return reject("REWARD_RISK", `Reward to risk ${rewardRisk.toFixed(2)} is below ${limits.minRewardRisk}`, version, factor, {
      rewardRisk,
    });
  }

  if (ticket.entryType === "MARKET") {
    const adverse = ticket.side === "LONG" ? quote.ask - quote.mark : quote.mark - quote.bid;
    const bps = (adverse / quote.mark) * 10_000;
    if (!(quote.mark > 0) || bps > limits.slippageAbortBps) {
      return reject("SLIPPAGE", `Market is ${bps.toFixed(1)} bps through the mark`, version, factor, { rewardRisk });
    }
  }

  const riskCash = account.equity * limits.riskPerTrade * factor;
  const uncappedQty = riskCash / stopDistance;
  let qty = uncappedQty;
  let notional = qty * ticket.entry;
  const positionCap = account.equity * limits.maxPositionNotionalPct;
  if (notional > positionCap) {
    notional = positionCap;
    qty = ticket.entry > 0 ? notional / ticket.entry : 0;
  }
  const exposureRoom = account.equity * limits.maxGrossExposurePct - account.grossExposure;
  if (!(exposureRoom > 0)) {
    return reject("EXPOSURE", "Portfolio exposure cap leaves no room", version, factor, {
      riskCash,
      rewardRisk,
      uncappedQty,
    });
  }
  if (notional > exposureRoom) {
    notional = exposureRoom;
    qty = ticket.entry > 0 ? notional / ticket.entry : 0;
  }

  const leverage = limits.maxLeverage;
  const margin = notional / leverage;
  if (margin > account.availableMargin) {
    notional = Math.max(0, account.availableMargin) * leverage;
    qty = ticket.entry > 0 ? notional / ticket.entry : 0;
  }
  if (qty > uncappedQty) qty = uncappedQty;
  notional = qty * ticket.entry;

  const maxQty = ticket.entryType === "MARKET" ? filters.marketMaxQty : filters.maxQty;
  if (maxQty > 0 && qty > maxQty) {
    qty = maxQty;
    notional = qty * ticket.entry;
  }

  qty = floorToStep(qty, filters.stepSize);
  notional = qty * ticket.entry;
  if (!(qty > 0) || qty < filters.minQty || notional < filters.minNotional) {
    return reject(
      "MIN_SIZE",
      `Sized quantity is below the exchange minimum. Risk size ${uncappedQty}, capped size ${qty}.`,
      version,
      factor,
      { riskCash, rewardRisk, uncappedQty },
    );
  }

  const liquidation = estimatedLiquidation(ticket.entry, ticket.side, leverage, account.maintenanceMarginRate);
  const stopBeyondLiquidation = ticket.side === "LONG" ? ticket.stop <= liquidation : ticket.stop >= liquidation;
  if (stopBeyondLiquidation) {
    return reject("LIQUIDATION", "Stop is beyond the estimated liquidation", version, factor, {
      riskCash,
      rewardRisk,
      uncappedQty,
    });
  }

  return {
    action: "approve",
    code: "OK",
    reason: "Within the confirmed risk limits",
    qty,
    notional,
    leverage,
    riskCash,
    rewardRisk,
    uncappedQty,
    streakFactor: factor,
    limitVersion: version,
  };
}

export const RISK_DECISION_TTL_MS = 30_000;

/**
 * Last check before a paper fill. A larger size or a higher leverage than the
 * risk decision is not executed. A stale decision or an old limit version is rejected.
 */
export function gateExecution(input: {
  decision: RiskDecision;
  qty: number;
  leverage: number;
  stop: number;
  approvedStop: number;
  decidedAt: number;
  now: number;
  activeLimitVersion: number;
  halted: boolean;
  equity: number;
  entry: number;
  limits: Limits;
}): { ok: true; qty: number; leverage: number } | { ok: false; code: RiskCode; reason: string } {
  if (input.halted || input.decision.code === "HALTED") {
    return { ok: false, code: "HALTED", reason: "Desk is halted" };
  }
  if (!(input.stop > 0) || input.stop !== input.approvedStop) {
    return { ok: false, code: "MISSING_STOP", reason: "Stop does not match the approved ticket" };
  }
  if (input.now - input.decidedAt > RISK_DECISION_TTL_MS) {
    return { ok: false, code: "STALE", reason: "Risk approval expired" };
  }
  if (input.decision.limitVersion !== input.activeLimitVersion) {
    return { ok: false, code: "LIMIT_VERSION", reason: "Risk limits changed since the decision" };
  }
  if (input.decision.action !== "approve" || input.decision.qty === null || input.decision.leverage === null) {
    return { ok: false, code: input.decision.code, reason: input.decision.reason };
  }
  if (input.leverage > input.limits.maxLeverage || input.decision.leverage > input.limits.maxLeverage) {
    return { ok: false, code: "LEVERAGE", reason: "Leverage is above the confirmed maximum" };
  }
  const qty = Math.min(input.qty, input.decision.qty);
  if (qty * input.entry > input.equity * input.limits.maxPositionNotionalPct) {
    return { ok: false, code: "POSITION_CAP", reason: "Position notional is above the cap" };
  }
  return { ok: true, qty, leverage: input.decision.leverage };
}

/** The head trader can reject or shrink a risk-approved size. A larger size is ignored. */
export function applyHeadDecision(riskQty: number, head: HeadDecision): { qty: number | null; note: string } {
  if (head.status === "disabled") {
    return { qty: riskQty, note: "Head trader is off. The risk size stands." };
  }
  if (head.status === "reject") {
    return { qty: null, note: "Head trader rejected the ticket." };
  }
  if (!(head.qty > 0)) {
    return { qty: null, note: "Head trader size was not positive." };
  }
  if (head.qty > riskQty) {
    return { qty: riskQty, note: "Head trader asked to increase size. The increase was ignored." };
  }
  if (head.qty < riskQty) {
    return { qty: head.qty, note: "Head trader reduced the size." };
  }
  return { qty: riskQty, note: "Head trader accepted the risk size." };
}
