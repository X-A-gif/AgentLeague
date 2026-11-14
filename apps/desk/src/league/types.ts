import type { Candle, SymbolFilters } from "@aster/client";
import type { Side } from "@aster/risk";
import type { Features } from "../features.js";
import type { Quote } from "../research.js";

export const TEAM_IDS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export type DepthSummary = {
  bidNotional: number;
  askNotional: number;
  levels: number;
};

export type SharedMarket = {
  symbol: string;
  features: Features;
  candles15m: Candle[];
  quote: Quote;
  depth: DepthSummary | null;
  filters: SymbolFilters;
};

export type TeamProposal = {
  teamId: TeamId;
  strategyId: string;
  strategyVersion: number;
  symbol: string;
  side: Side;
  entry: number;
  stop: number;
  targets: number[];
  confidence: number;
  reasoning: string;
  indicators: Record<string, number | string | boolean | null>;
};

export type TeamDefinition = {
  id: TeamId;
  name: string;
  strategyId: string;
  strategyVersion: number;
  mandate: string;
};

export const TEAMS: readonly TeamDefinition[] = [
  {
    id: "alpha",
    name: "Alpha",
    strategyId: "alpha-momentum",
    strategyVersion: 1,
    mandate: "Momentum and breakouts only, and only when volume expands.",
  },
  {
    id: "beta",
    name: "Beta",
    strategyId: "beta-trend",
    strategyVersion: 1,
    mandate: "Trade with a confirmed trend. Skip counter-trend and stretched RSI.",
  },
  {
    id: "gamma",
    name: "Gamma",
    strategyId: "gamma-contrarian",
    strategyVersion: 1,
    mandate: "Mean reversion and failed breaks. No momentum chasing.",
  },
  {
    id: "delta",
    name: "Delta",
    strategyId: "delta-liquidity",
    strategyVersion: 1,
    mandate: "Trade book imbalance and funding. No invented liquidation map.",
  },
  {
    id: "epsilon",
    name: "Epsilon",
    strategyId: "epsilon-stats",
    strategyVersion: 1,
    mandate: "Trade only a measured in-sample continuation edge, and record the sample size.",
  },
];
