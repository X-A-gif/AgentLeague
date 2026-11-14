import type { Filters, Side } from "@aster/risk";

export const PAPER_SLIPPAGE_BPS = 5;
export const PAPER_TAKER_FEE_RATE = 0.0004;
export const PAPER_MAKER_FEE_RATE = 0.0002;

export type OrderSide = "BUY" | "SELL";

/** Market buys lift the ask. Market sells hit the bid. Both pay the slippage. */
export function marketFillPrice(side: OrderSide, bid: number, ask: number, slippageBps = PAPER_SLIPPAGE_BPS): number {
  const slip = slippageBps / 10_000;
  if (side === "BUY") return ask * (1 + slip);
  return bid * (1 - slip);
}

export function orderSideFor(positionSide: Side, closing: boolean): OrderSide {
  const openingBuy = positionSide === "LONG";
  const buy = closing ? !openingBuy : openingBuy;
  return buy ? "BUY" : "SELL";
}

/**
 * A resting limit fills only after the mark trades through it.
 * Bid and ask size is ignored.
 */
export function limitTradedThrough(side: OrderSide, limitPrice: number, mark: number): boolean {
  if (side === "BUY") return mark <= limitPrice;
  return mark >= limitPrice;
}

/** Protective orders trigger on the mark. A long stop sells when mark is at or below the stop. */
export function protectionTriggered(
  type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
  side: OrderSide,
  stopPrice: number,
  mark: number,
): boolean {
  if (type === "STOP_MARKET") {
    return side === "SELL" ? mark <= stopPrice : mark >= stopPrice;
  }
  return side === "SELL" ? mark >= stopPrice : mark <= stopPrice;
}

export function pricePnl(side: Side, qty: number, entry: number, exit: number): number {
  return side === "LONG" ? (exit - entry) * qty : (entry - exit) * qty;
}

/** Positive funding rate: longs pay, shorts receive. Returned value is the position's cashflow. */
export function fundingCashflow(side: Side, qty: number, mark: number, fundingRate: number): number {
  const payment = qty * mark * fundingRate;
  return side === "LONG" ? -payment : payment;
}

export function feeCash(notional: number, rate: number): number {
  return Math.abs(notional) * rate;
}

/** Reject an illegal quantity. Never round it up into a valid order. */
export function quantityRejection(qty: number, price: number, filters: Filters): string | null {
  if (!(qty > 0) || !(price > 0)) return "Quantity and price must be positive";
  if (filters.stepSize > 0) {
    const steps = qty / filters.stepSize;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) return "Quantity is not a multiple of the step size";
  }
  if (qty < filters.minQty) return "Quantity is below the exchange minimum";
  if (qty * price < filters.minNotional) return "Notional is below the exchange minimum";
  const cap = filters.marketMaxQty > 0 ? filters.marketMaxQty : filters.maxQty;
  if (cap > 0 && qty > cap) return "Quantity is above the exchange maximum";
  return null;
}
