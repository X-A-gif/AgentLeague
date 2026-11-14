import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Candle, SymbolFilters } from "@aster/client";
import {
  evaluateRisk,
  gateExecution,
  type Limits,
} from "@aster/risk";
import { buildFeatures } from "../features.js";
import { lastRsi } from "../indicators.js";
import { PaperBook, type PaperAction } from "../paperBook.js";
import type { Quote } from "../research.js";
import { PROPOSERS } from "./strategies.js";
import { TEAMS, type DepthSummary, type SharedMarket, type TeamId, type TeamProposal } from "./types.js";

export const LEAGUE_TEAM_CAPITAL = 2_000;
export const LEAGUE_POOL = LEAGUE_TEAM_CAPITAL * TEAMS.length;
export const LEAGUE_GROSS_CAP = LEAGUE_POOL * 0.3;

export type LeagueEvent = {
  teamId: TeamId | "league";
  agent: string;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
};

export function notionalOf(levels: Array<[number, number]>): number {
  return levels.reduce((sum, [price, qty]) => sum + price * qty, 0);
}

export function runLeagueSymbol(input: {
  symbol: string;
  candles: Record<"5m" | "15m" | "1h" | "4h" | "1d", Candle[]>;
  quote: Quote;
  depth: DepthSummary | null;
  filters: SymbolFilters;
  books: Record<TeamId, PaperBook>;
  limits: Limits;
  limitVersion: number;
  now: number;
  standDown: boolean;
  marks: Record<string, number>;
}): LeagueEvent[] {
  const features = buildFeatures({
    candles15m: input.candles["15m"],
    candles1h: input.candles["1h"],
    candles4h: input.candles["4h"],
    rsiByTimeframe: {
      "5m": lastRsi(input.candles["5m"]),
      "15m": lastRsi(input.candles["15m"]),
      "1h": lastRsi(input.candles["1h"]),
      "4h": lastRsi(input.candles["4h"]),
      "1d": lastRsi(input.candles["1d"]),
    },
    now: input.now,
  });
  if (!features) {
    return [
      {
        teamId: "league",
        agent: "market",
        kind: "observation",
        summary: `${input.symbol} does not have enough closed candles for the league.`,
        payload: { symbol: input.symbol },
      },
    ];
  }
  const market: SharedMarket = {
    symbol: input.symbol,
    features,
    candles15m: input.candles["15m"],
    quote: input.quote,
    depth: input.depth,
    filters: input.filters,
  };
  const events: LeagueEvent[] = [];
  for (const team of TEAMS) {
    const proposal = PROPOSERS[team.id](market);
    if (!proposal || (input.standDown && proposal)) {
      events.push({
        teamId: team.id,
        agent: team.id,
        kind: "observation",
        summary: input.standDown
          ? `${team.name} stood down with the rest of the desk.`
          : `${team.name} passed on ${input.symbol}. ${team.mandate}`,
        payload: { symbol: input.symbol, strategyId: team.strategyId, strategyVersion: team.strategyVersion },
      });
      if (!proposal || input.standDown) continue;
    }
    if (!proposal) continue;
    events.push(...executeProposal(proposal, input));
  }
  return events;
}

function executeProposal(
  proposal: TeamProposal,
  input: {
    quote: Quote;
    filters: SymbolFilters;
    books: Record<TeamId, PaperBook>;
    limits: Limits;
    limitVersion: number;
    now: number;
    standDown: boolean;
    marks: Record<string, number>;
  },
): LeagueEvent[] {
  const book = input.books[proposal.teamId];
  const account = book.accountState(input.marks, input.now);
  const decision = evaluateRisk({
    ticket: {
      symbol: proposal.symbol,
      side: proposal.side,
      setup: proposal.strategyId,
      entryType: "MARKET",
      entry: proposal.entry,
      stop: proposal.stop,
      targets: proposal.targets,
      timeframe: "15m",
      newsFlag: input.standDown ? "stand_down" : "clear",
    },
    limits: input.limits,
    limitVersion: input.limitVersion,
    account,
    filters: input.filters,
    quote: { mark: input.quote.mark, bid: input.quote.bid, ask: input.quote.ask },
  });
  const reasoning = {
    teamId: proposal.teamId,
    strategyId: proposal.strategyId,
    strategyVersion: proposal.strategyVersion,
    reasoning: proposal.reasoning,
    confidence: proposal.confidence,
    indicators: proposal.indicators,
    side: proposal.side,
    entry: proposal.entry,
    stop: proposal.stop,
    targets: proposal.targets,
    expectedRewardRisk: decision.rewardRisk,
    code: decision.code,
  };
  const events: LeagueEvent[] = [
    {
      teamId: proposal.teamId,
      agent: proposal.teamId,
      kind: "ticket",
      summary: proposal.reasoning,
      payload: reasoning,
    },
    {
      teamId: proposal.teamId,
      agent: "risk",
      kind: "risk_decision",
      summary:
        decision.action === "approve"
          ? `${proposal.teamId} risk approved paper qty ${decision.qty} at ${decision.leverage}x. Code ${decision.code}.`
          : `${proposal.teamId} risk veto ${decision.code}: ${decision.reason}`,
      payload: { ...reasoning, qty: decision.qty, leverage: decision.leverage, action: decision.action },
    },
  ];
  if (decision.action !== "approve" || decision.qty === null || decision.leverage === null) return events;
  const portfolio = portfolioGross(input.books, input.marks);
  if (portfolio + decision.qty * proposal.entry > LEAGUE_GROSS_CAP) {
    events.push({
      teamId: proposal.teamId,
      agent: "risk",
      kind: "observation",
      summary: `${proposal.teamId} blocked by the league exposure cap.`,
      payload: { code: "EXPOSURE", portfolio, cap: LEAGUE_GROSS_CAP },
    });
    return events;
  }
  const gated = gateExecution({
    decision,
    qty: decision.qty,
    leverage: decision.leverage,
    stop: proposal.stop,
    approvedStop: proposal.stop,
    decidedAt: input.now,
    now: input.now,
    activeLimitVersion: input.limitVersion,
    halted: book.isHalted(),
    equity: account.equity,
    entry: proposal.entry,
    limits: input.limits,
  });
  if (!gated.ok) {
    events.push({
      teamId: proposal.teamId,
      agent: "execution",
      kind: "observation",
      summary: `${proposal.teamId} fill blocked: ${gated.reason}`,
      payload: { code: gated.code, ...reasoning },
    });
    return events;
  }
  const action: PaperAction = book.submitApproved({
    symbol: proposal.symbol,
    side: proposal.side,
    qty: gated.qty,
    leverage: gated.leverage,
    stop: proposal.stop,
    target: proposal.targets[0]!,
    bid: input.quote.bid,
    ask: input.quote.ask,
    filters: input.filters,
    now: input.now,
    setup: `${proposal.strategyId}@${proposal.strategyVersion}`,
  });
  events.push({
    teamId: proposal.teamId,
    agent: "execution",
    kind: action.kind === "fill" ? "fill" : "observation",
    summary: action.summary,
    payload: { ...action.payload, ...reasoning, qty: gated.qty, leverage: gated.leverage },
  });
  return events;
}

export function portfolioGross(books: Record<TeamId, PaperBook>, marks: Record<string, number>): number {
  return TEAMS.reduce((sum, team) => sum + books[team.id].accountState(marks, Date.now()).grossExposure, 0);
}

export class League {
  readonly books: Record<TeamId, PaperBook>;
  lastEvents: LeagueEvent[] = [];

  note(events: LeagueEvent[]): void {
    this.lastEvents = [...this.lastEvents, ...events].slice(-300);
  }

  constructor(directory: string, startingEquity = LEAGUE_TEAM_CAPITAL) {
    mkdirSync(directory, { recursive: true });
    this.books = Object.fromEntries(
      TEAMS.map((team) => [team.id, new PaperBook(path.join(directory, `${team.id}.sqlite`), startingEquity)]),
    ) as Record<TeamId, PaperBook>;
  }

  close(): void {
    for (const book of Object.values(this.books)) book.close();
  }

  isHalted(): boolean {
    return TEAMS.some((team) => this.books[team.id].isHalted());
  }

  mode(): "research" | "paper" | "halted" {
    if (this.isHalted()) return "halted";
    return TEAMS.every((team) => this.books[team.id].mode() === "research") ? "research" : "paper";
  }

  kill(quotes: Record<string, { bid: number; ask: number; mark: number }>, now: number): PaperAction[] {
    return TEAMS.flatMap((team) => this.books[team.id].kill(quotes, now));
  }

  resumeToResearch(): void {
    for (const team of TEAMS) this.books[team.id].resumeToResearch();
  }

  enablePaper(): { ok: boolean; reason: string } {
    for (const team of TEAMS) {
      const result = this.books[team.id].enablePaper();
      if (!result.ok) return result;
    }
    return { ok: true, reason: "Paper trading is on for every team." };
  }

  onQuote(symbol: string, quote: { mark: number; fundingRate: number; nextFundingTime: number }, now: number): PaperAction[] {
    return TEAMS.flatMap((team) => this.books[team.id].onQuote(symbol, quote, now));
  }

  view(marks: Record<string, number>) {
    const teams = TEAMS.map((team) => {
      const book = this.books[team.id].view(marks);
      const latest = [...this.lastEvents].reverse().find((event) => event.teamId === team.id);
      return {
        id: team.id,
        name: team.name,
        mandate: team.mandate,
        strategyId: team.strategyId,
        strategyVersion: team.strategyVersion,
        equity: book.equity,
        startingEquity: book.startingEquity,
        unrealizedPnl: book.unrealizedPnl,
        realizedPnl: book.realizedPnl,
        fees: book.fees,
        funding: book.funding,
        positions: book.positions,
        orders: book.orders,
        lastSummary: latest?.summary ?? "No decision yet.",
      };
    });
    return {
      pool: LEAGUE_POOL,
      teamCapital: LEAGUE_TEAM_CAPITAL,
      equity: teams.reduce((sum, team) => sum + team.equity, 0),
      teams,
    };
  }
}
