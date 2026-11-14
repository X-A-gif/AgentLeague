import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalDesk } from "./terminal-desk";
import { funnel, modePill, type FeedEvent, type Snapshot, type TabId } from "../lib/desk-model";

const now = Date.parse("2026-11-14T20:41:32Z");

function team(id: string, name: string) {
  return {
    id,
    name,
    mandate: `${name} mandate`,
    strategyId: `${id}-strategy`,
    strategyVersion: 1,
    equity: 2000,
    startingEquity: 2000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    fees: 0,
    funding: 0,
    positions: [],
    orders: [],
    lastSummary: "No decision yet.",
  };
}

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    mode: "paper",
    ordersEnabled: false,
    headTrader: "disabled",
    updatedAt: now,
    hypotheticalEquity: 10000,
    equityNote: "Paper pool.",
    league: {
      pool: 10000,
      teamCapital: 2000,
      equity: 10000,
      teams: ["alpha", "beta", "gamma", "delta", "epsilon"].map((id, index) =>
        team(id, ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"][index]!),
      ),
    },
    paper: {
      equity: 10000,
      unrealizedPnl: 0,
      realizedPnl: 0,
      fees: 0,
      funding: 0,
      slippageBps: 5,
      takerFeeRate: 0.0004,
      makerFeeRate: 0.0002,
      positions: [],
      orders: [],
      note: "Legacy book.",
    },
    limits: { version: 1, values: { maxLeverage: 3, riskPerTrade: 0.005 } },
    symbols: [
      {
        symbol: "BTCUSDT",
        quote: {
          mark: 64123.4,
          index: 64110,
          fundingRate: 0.0001,
          nextFundingTime: now + 60_000,
          bid: 64120,
          ask: 64126,
        },
        lastPrice: 64100,
        pass: {
          market: { regime: "trend_up", spreadBps: 0.9, summary: "BTC trend up" },
          technical: { summary: "RSI mid", rsiByTimeframe: { "15m": 55 } },
          news: { summary: "News clear", flag: "clear" },
          decisions: [],
        },
        error: null,
      },
    ],
    error: null,
    ...patch,
  };
}

function render(tab: TabId, patch: Partial<Snapshot> = {}, events: FeedEvent[] = []) {
  return renderToStaticMarkup(
    <TerminalDesk
      snapshot={snapshot(patch)}
      events={events}
      marks={{ BTCUSDT: [{ t: now - 2000, v: 64100 }, { t: now, v: 64123.4 }] }}
      equitySeries={[{ t: now - 2000, v: 10000 }, { t: now, v: 10000 }]}
      now={now}
      tab={tab}
      onTab={() => undefined}
      offline={null}
      busy={false}
      armed={false}
      controlMessage={null}
      onArm={() => undefined}
      onKill={() => undefined}
      onResume={() => undefined}
      onPaper={() => undefined}
    />,
  );
}

describe("mode pill", () => {
  it("names the real desk mode and never says live while orders are off", () => {
    expect(modePill({ mode: "paper", ordersEnabled: false })).toEqual({ label: "PAPER", tone: "ok" });
    expect(modePill({ mode: "research", ordersEnabled: false })).toEqual({ label: "RESEARCH", tone: "warn" });
    expect(modePill({ mode: "halted", ordersEnabled: true })).toEqual({ label: "HALTED", tone: "bad" });
    expect(modePill({ mode: "paper", ordersEnabled: true })).toEqual({ label: "LIVE", tone: "live" });
    expect(modePill({ mode: "unknown", ordersEnabled: false })).toEqual({ label: "LIVE DISABLED", tone: "warn" });
  });
});

describe("terminal desk", () => {
  it("renders the paper monitor from team books and leaves missing stages empty", () => {
    const html = render("monitor");
    expect(html).toContain("Agent League");
    expect(html).toContain('data-mode="PAPER"');
    expect(html).not.toContain('data-mode="LIVE"');
    expect(html).toContain("ALPHA");
    expect(html).toContain("EPSILON");
    expect(html).toContain("BTCUSDT");
    expect(html).toContain("64,123.40");
    expect(html).toContain("No trades yet");
    expect(html).toContain("Not yet built (League Stage 2)");
    expect(html).toContain("FK 1&lt;GO&gt;");
    expect(html).not.toContain("Jito");
    expect(html).not.toContain("GLORP");
    expect(html).not.toContain("8kQ2");
  });

  it("shows a halted pill and an empty fills book", () => {
    expect(render("monitor", { mode: "halted" })).toContain('data-mode="HALTED"');
    expect(render("monitor", { mode: "halted" })).toContain("Desk halted");
    expect(render("fills")).toContain("No trades yet");
    expect(render("teams")).toContain("Not yet built (League Stage 2)");
  });

  it("shows live only when the snapshot says orders are enabled", () => {
    expect(render("monitor", { ordersEnabled: true })).toContain('data-mode="LIVE"');
  });
});

describe("signal funnel", () => {
  it("counts real tickets, vetoes, and fills in the loaded window", () => {
    const events: FeedEvent[] = [
      { id: "1", ts: now - 1000, agent: "alpha", kind: "ticket", payload: { summary: "Alpha breakout" } },
      { id: "2", ts: now - 900, agent: "beta", kind: "observation", payload: { summary: "Beta passed on BTCUSDT" } },
      { id: "3", ts: now - 800, agent: "risk", kind: "risk_decision", payload: { action: "reject", summary: "veto" } },
      { id: "4", ts: now - 700, agent: "execution", kind: "fill", payload: { summary: "Paper fill: LONG" } },
      { id: "5", ts: now - 600, agent: "execution", kind: "fill", payload: { summary: "Paper funding: paid" } },
    ];
    expect(funnel(events, now)).toMatchObject({
      windowLabel: "LAST 60 MIN",
      signals: 2,
      passedFilters: 1,
      passedRisk: 0,
      filled: 1,
    });
  });
});
