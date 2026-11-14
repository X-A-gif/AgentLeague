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

export type RiskDecision = {
  action: "approve" | "reject";
  reason: string;
  qty: number | null;
  notional: number | null;
  leverage: number | null;
  riskCash: number | null;
  rewardRisk: number | null;
  streakFactor: number;
  limitVersion: number;
};

export type HeadDecision =
  | { status: "disabled" }
  | { status: "reject" }
  | { status: "accept"; qty: number };

function reject(
  reason: string,
  limitVersion: number,
  factor: number,
  extra: Partial<RiskDecision> = {},
): RiskDecision {
  return {
    action: "reject",
    reason,
    qty: null,
    notional: null,
    leverage: null,
    riskCash: extra.riskCash ?? null,
    rewardRisk: extra.rewardRisk ?? null,
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

  if (account.halted) return reject("Desk is halted", version, factor);
  if (ticket.newsFlag === "stand_down") return reject("News stand-down is on", version, factor);
  if (!(ticket.entry > 0) || !(ticket.stop > 0)) return reject("Entry and stop must be positive", version, factor);
  if (ticket.side === "LONG" && !(ticket.stop < ticket.entry)) {
    return reject("Long stop must sit below the entry", version, factor);
  }
  if (ticket.side === "SHORT" && !(ticket.stop > ticket.entry)) {
    return reject("Short stop must sit above the entry", version, factor);
  }
  if (account.dailyRealizedLoss >= account.equity * limits.maxDailyLossPct) {
    return reject("Daily loss limit reached", version, factor);
  }
  if (account.drawdownPct >= limits.maxDrawdownPct) {
    return reject("Drawdown limit reached", version, factor);
  }
  if (factor === 0) return reject("Consecutive-loss limit reached", version, factor);

  const target = ticket.targets[0];
  if (target === undefined) return reject("Ticket has no target", version, factor);
  const stopDistance = Math.abs(ticket.entry - ticket.stop);
  const rewardRisk = Math.abs(target - ticket.entry) / stopDistance;
  if (rewardRisk < limits.minRewardRisk) {
    return reject(`Reward to risk ${rewardRisk.toFixed(2)} is below ${limits.minRewardRisk}`, version, factor, {
      rewardRisk,
    });
  }

  if (ticket.entryType === "MARKET") {
    const adverse = ticket.side === "LONG" ? quote.ask - quote.mark : quote.mark - quote.bid;
    const bps = (adverse / quote.mark) * 10_000;
    if (!(quote.mark > 0) || bps > limits.slippageAbortBps) {
      return reject(`Market is ${bps.toFixed(1)} bps through the mark`, version, factor, { rewardRisk });
    }
  }

  const riskCash = account.equity * limits.riskPerTrade * factor;
  let qty = riskCash / stopDistance;
  let notional = qty * ticket.entry;
  const positionCap = account.equity * limits.maxPositionNotionalPct;
  const exposureRoom = account.equity * limits.maxGrossExposurePct - account.grossExposure;
  const notionalCap = Math.min(positionCap, exposureRoom);
  if (!(notionalCap > 0)) {
    return reject("Portfolio exposure cap leaves no room", version, factor, { riskCash, rewardRisk });
  }
  if (notional > notionalCap) {
    notional = notionalCap;
    qty = notional / ticket.entry;
  }

  const leverage = limits.maxLeverage;
  const margin = notional / leverage;
  if (margin > account.availableMargin) {
    notional = account.availableMargin * leverage;
    qty = notional / ticket.entry;
  }

  const maxQty = ticket.entryType === "MARKET" ? filters.marketMaxQty : filters.maxQty;
  if (maxQty > 0 && qty > maxQty) {
    qty = maxQty;
    notional = qty * ticket.entry;
  }

  qty = floorToStep(qty, filters.stepSize);
  notional = qty * ticket.entry;
  if (qty < filters.minQty || notional < filters.minNotional) {
    return reject("Sized quantity is below the exchange minimum", version, factor, { riskCash, rewardRisk });
  }

  const liquidation = estimatedLiquidation(ticket.entry, ticket.side, leverage, account.maintenanceMarginRate);
  const stopBeyondLiquidation = ticket.side === "LONG" ? ticket.stop <= liquidation : ticket.stop >= liquidation;
  if (stopBeyondLiquidation) {
    return reject("Stop is beyond the estimated liquidation", version, factor, { riskCash, rewardRisk });
  }

  return {
    action: "approve",
    reason: "Within the confirmed risk limits",
    qty,
    notional,
    leverage,
    riskCash,
    rewardRisk,
    streakFactor: factor,
    limitVersion: version,
  };
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
