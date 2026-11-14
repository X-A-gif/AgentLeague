"use client";

import { useId, useState, type ReactNode } from "react";
import {
  TAB_LABELS,
  TABS,
  bps,
  chartLevels,
  contextLine,
  eventText,
  executionRows,
  feedRows,
  fillRows,
  funnel,
  grossNotional,
  limitRows,
  markOf,
  modePill,
  money,
  num,
  openPositions,
  percent,
  priceFmt,
  qtyFmt,
  sessionPnl,
  signed,
  teamsOf,
  toneOf,
  utcClock,
  utcTime,
  vetoRows,
  type FeedEvent,
  type Snapshot,
  type TabId,
  type Tone,
} from "@/lib/desk-model";

type Sample = { t: number; v: number };

type Props = {
  snapshot: Snapshot;
  events: FeedEvent[];
  marks: Record<string, Sample[]>;
  equitySeries: Sample[];
  now: number | null;
  tab: TabId;
  onTab: (tab: TabId) => void;
  offline: string | null;
  busy: boolean;
  armed: boolean;
  controlMessage: string | null;
  onArm: () => void;
  onKill: () => void;
  onResume: () => void;
  onPaper: () => void;
};

export function TerminalDesk(props: Props) {
  const pill = modePill(props.snapshot);
  return (
    <div className="term">
      <header className="term-top">
        <div className="term-brand">Agent League</div>
        <p className="term-context">{contextLine(props.snapshot)}</p>
        <div className="term-clock">
          <span>UTC {utcClock(props.now)}</span>
          <span className={`term-pill term-pill-${pill.tone}`} data-mode={pill.label}>
            {pill.label}
          </span>
        </div>
      </header>
      <nav className="term-nav" aria-label="Desk views">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className="term-tab"
            aria-current={props.tab === tab ? "page" : undefined}
            onClick={() => props.onTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <DeskControls {...props} />
      </nav>
      {props.snapshot.mode === "halted" ? (
        <p className="term-banner">Desk halted. Paper positions were flattened and new trades stay blocked.</p>
      ) : null}
      {props.offline || props.snapshot.error ? (
        <p className="term-banner">{props.offline ?? props.snapshot.error}</p>
      ) : null}
      {props.controlMessage ? <p className="term-banner">{props.controlMessage}</p> : null}
      <div className="term-body">
        {props.tab === "monitor" ? <Monitor {...props} /> : null}
        {props.tab === "teams" ? <Teams {...props} /> : null}
        {props.tab === "fills" ? <Fills {...props} /> : null}
        {props.tab === "pnl" ? <Pnl {...props} /> : null}
        {props.tab === "risk" ? <Risk {...props} /> : null}
        {props.tab === "regime" ? <Regime {...props} /> : null}
        {props.tab === "log" ? <Log {...props} /> : null}
      </div>
    </div>
  );
}

function DeskControls(props: Props) {
  const { snapshot, busy, armed } = props;
  return (
    <div className="term-controls">
      {snapshot.mode === "halted" ? (
        <button type="button" className="term-btn" disabled={busy} onClick={props.onResume}>
          Resume to research
        </button>
      ) : armed ? (
        <button type="button" className="term-btn term-btn-solid" disabled={busy} onClick={props.onKill}>
          Confirm flatten
        </button>
      ) : (
        <button type="button" className="term-btn" disabled={busy} onClick={props.onArm}>
          Kill switch
        </button>
      )}
      {snapshot.mode === "research" ? (
        <button type="button" className="term-btn" disabled={busy} onClick={props.onPaper}>
          Enable paper
        </button>
      ) : null}
    </div>
  );
}

function Monitor(props: Props) {
  return (
    <div className="term-grid">
      <Panel className="term-feed" title="Signal feed" fk="1">
        <SignalTable {...props} />
      </Panel>
      <Panel className="term-position" title="Position" fk="2">
        <Position {...props} />
      </Panel>
      <Panel className="term-teams" title="Teams" fk="3">
        <TeamTable {...props} compact />
      </Panel>
      <Panel className="term-log" title="Execution log" fk="7">
        <Execution {...props} />
      </Panel>
      <Panel className="term-pnl" title="Session P&L" fk="4">
        <Session {...props} />
      </Panel>
      <Panel className="term-engines" title="Engines" fk="6">
        <Engines {...props} />
        <Pipeline {...props} />
      </Panel>
    </div>
  );
}

function Panel({
  title,
  fk,
  className,
  children,
}: {
  title: string;
  fk: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`term-panel ${className ?? ""}`}>
      <header>
        <h2>{title}</h2>
        <span>{"FK " + fk + "<GO>"}</span>
      </header>
      <div className="term-scroll">{children}</div>
    </section>
  );
}

function SignalTable(props: Props) {
  const rows = feedRows(props.events);
  if (rows.length === 0) {
    return <p className="term-empty">No team signals yet. The first pass runs when Aster candles load.</p>;
  }
  return (
    <table className="term-table">
      <colgroup>
        <col style={{ width: "72px" }} />
        <col style={{ width: "78px" }} />
        <col />
        <col style={{ width: "92px" }} />
      </colgroup>
      <thead>
        <tr>
          <th>Time</th>
          <th>Team</th>
          <th>Detail</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{row.time}</td>
            <td>{row.who}</td>
            <td title={row.detail}>{clip(row.detail, 72)}</td>
            <td>
              <Chip tone={row.tone}>{row.badge}</Chip>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Position(props: Props) {
  const symbols = props.snapshot.symbols;
  const [picked, setPicked] = useState(symbols[0]?.symbol ?? "");
  const symbol = symbols.some((item) => item.symbol === picked) ? picked : (symbols[0]?.symbol ?? "");
  const view = symbols.find((item) => item.symbol === symbol);
  const mark = markOf(view);
  const positions = openPositions(props.snapshot, symbol);
  const focus = positions[0];
  const levels = chartLevels(props.snapshot, symbol, props.events);
  const series = props.marks[symbol] ?? [];
  const hasPartial = levels.some((level) => level.label === "PARTIAL EXIT");
  const hasTrail = levels.some((level) => level.label.includes("TRAIL"));
  return (
    <div>
      <div className="term-picks">
        {symbols.map((item) => (
          <button
            key={item.symbol}
            type="button"
            className="term-pick"
            aria-pressed={item.symbol === symbol}
            onClick={() => setPicked(item.symbol)}
          >
            {item.symbol}
          </button>
        ))}
      </div>
      <div className="term-symbol">
        <h3>{symbol || "—"}</h3>
        <p className="term-price">{mark === null ? "—" : priceFmt(mark)}</p>
      </div>
      <div className="term-meta">
        <span>
          Entry <b>{focus ? priceFmt(focus.entryPrice) : "—"}</b>
        </span>
        <span>
          Qty <b>{focus ? qtyFmt(focus.qty) : "—"}</b>
        </span>
        <span>
          Side <b>{focus ? `${focus.team} ${focus.side}` : "FLAT"}</b>
        </span>
        <span className={focus ? `tone-${toneOf(focus.unrealizedPnl)}` : "tone-mute"}>
          uPnL <b>{focus ? signed(focus.unrealizedPnl) : "—"}</b>
        </span>
      </div>
      <SeriesChart points={series} levels={levels} />
      {positions.length === 0 ? (
        <p className="term-sub">No open paper position. No entry, partial exit, or trail to plot.</p>
      ) : (
        <p className="term-sub">
          {hasPartial ? "A partial exit is marked from the fill log." : "No partial exit is recorded."}{" "}
          {hasTrail ? "A trail is marked from the order." : "Stops are full-size stops, not a trail."}
        </p>
      )}
      {series.length < 2 ? <p className="term-sub">Mark line uses prices this page has polled from the desk.</p> : null}
    </div>
  );
}

function SeriesChart({
  points,
  levels,
  short = false,
}: {
  points: Sample[];
  levels: Array<{ price: number; label: string; tone: string }>;
  short?: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const values = [...points.map((point) => point.v), ...levels.map((level) => level.price)];
  if (values.length === 0) return <p className="term-empty">No mark yet.</p>;
  const width = 360;
  const height = short ? 92 : 132;
  const left = 8;
  const right = levels.length > 0 ? 132 : 8;
  const top = 10;
  const bottom = 12;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.abs(min) * 0.0015 || 1;
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.18;
    min -= pad;
    max += pad;
  }
  const yOf = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const up = points.length === 0 || points[points.length - 1]!.v >= points[0]!.v;
  const stroke = up ? "#3dff8a" : "#ff5c6c";
  const x0 = points.length ? points[0]!.t : 0;
  const x1 = points.length > 1 ? points[points.length - 1]!.t : x0 + 1;
  const xOf = (time: number) => left + ((time - x0) / (x1 - x0 || 1)) * (width - left - right);
  const plot = points.map((point) => ({ x: xOf(point.t), y: yOf(point.v) }));
  const band = 22;
  const area =
    plot.length >= 2
      ? [
          ...plot.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`),
          ...plot
            .slice()
            .reverse()
            .map((point) => `${point.x.toFixed(1)},${Math.min(height - bottom, point.y + band).toFixed(1)}`),
        ].join(" ")
      : "";
  const toneColor: Record<string, string> = {
    entry: "#3dff8a",
    stop: "#ff5c6c",
    target: "#ffc14d",
    exit: "#f2e6e7",
  };
  return (
    <svg
      className={short ? "term-chart term-chart-short" : "term-chart"}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Mark and order levels"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((step) => (
        <line
          key={step}
          x1={left}
          x2={width - right}
          y1={top + (height - top - bottom) * step}
          y2={top + (height - top - bottom) * step}
          stroke="#3a1218"
          strokeWidth="1"
        />
      ))}
      {area ? <polygon points={area} fill={`url(#${gradientId})`} /> : null}
      {plot.length >= 2 ? (
        <polyline
          points={plot.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth="1.8"
        />
      ) : null}
      {plot.length > 0 ? (
        <circle cx={plot[plot.length - 1]!.x} cy={plot[plot.length - 1]!.y} r="2.6" fill={stroke} />
      ) : null}
      {plot.length === 1 ? (
        <line x1={left} x2={width - right} y1={plot[0]!.y} y2={plot[0]!.y} stroke={stroke} strokeWidth="1.8" />
      ) : null}
      {levels.map((level, index) => {
        const y = yOf(level.price);
        const color = toneColor[level.tone] ?? "#c4b4b6";
        return (
          <g key={`${level.label}-${index}`}>
            <line x1={left} x2={width - right} y1={y} y2={y} stroke={color} strokeDasharray="3 3" strokeWidth="1" />
            <text x={width - right + 6} y={y + 3} fill={color} fontSize="9" fontFamily="inherit">
              {level.label} {priceFmt(level.price)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TeamTable({ snapshot, compact }: Props & { compact?: boolean }) {
  return <TeamRows snapshot={snapshot} compact={compact} />;
}

function TeamRows({ snapshot, compact }: { snapshot: Snapshot; compact?: boolean }) {
  const teams = teamsOf(snapshot);
  if (teams.length === 0) return <p className="term-empty">No team books in this snapshot.</p>;
  return (
    <div>
      <table className="term-table">
        <colgroup>
          <col style={{ width: "28px" }} />
          <col style={{ width: "78px" }} />
          <col style={{ width: "84px" }} />
          <col />
          <col style={{ width: "72px" }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th className="term-right">Equity</th>
            <th>Pos</th>
            <th className="term-right">uPnL</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team, index) => {
            const position = team.positions[0];
            return (
              <tr key={team.id}>
                <td>{index + 1}</td>
                <td title={team.mandate}>{team.name.toUpperCase()}</td>
                <td className="term-right">{money(team.equity)}</td>
                <td>{position ? `${position.side} ${position.symbol}` : "FLAT"}</td>
                <td className={`term-right tone-${toneOf(team.unrealizedPnl)}`}>{signed(team.unrealizedPnl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {compact ? <p className="term-sub">Season rank is not yet built (League Stage 2).</p> : null}
      {!compact
        ? teams.map((team) => (
            <article key={`${team.id}-book`} style={{ marginTop: 10 }}>
              <p>
                {team.name} · {team.strategyId} v{team.strategyVersion}
              </p>
              <p className="term-sub">{team.mandate}</p>
              <p>{team.lastSummary}</p>
              {team.positions.length === 0 ? (
                <p className="term-sub">No open paper position. Allocated {money(team.startingEquity)} USDT.</p>
              ) : (
                team.positions.map((position) => (
                  <p key={`${team.id}-${position.symbol}-${position.side}`}>
                    {position.side} {qtyFmt(position.qty)} {position.symbol} @ {priceFmt(position.entryPrice)} uPnL{" "}
                    <span className={`tone-${toneOf(position.unrealizedPnl)}`}>{signed(position.unrealizedPnl)}</span>
                  </p>
                ))
              )}
              {team.orders.map((order, index) => (
                <p key={`${team.id}-order-${index}`} className="term-sub">
                  Resting {order.type} {order.positionSide} {order.symbol} qty {qtyFmt(order.qty)}
                  {order.stopPrice !== null ? ` @ ${priceFmt(order.stopPrice)}` : ""}
                  {order.limitPrice !== null ? ` limit ${priceFmt(order.limitPrice)}` : ""}
                </p>
              ))}
            </article>
          ))
        : null}
    </div>
  );
}

function Execution(props: Props) {
  const fills = fillRows(props.events);
  const rows = executionRows(props.events);
  return (
    <div>
      {fills.length === 0 ? <p className="term-empty">No trades yet.</p> : null}
      {rows.length === 0 ? null : (
        <table className="term-table">
          <colgroup>
            <col style={{ width: "72px" }} />
            <col style={{ width: "84px" }} />
            <col />
          </colgroup>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.time}</td>
                <td>
                  <Chip tone={row.tone}>{row.badge}</Chip>
                </td>
                <td title={row.detail}>{clip(row.detail, 88)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Session(props: Props) {
  const book = sessionPnl(props.snapshot);
  if (!book) return <p className="term-empty">The league book is not in this snapshot.</p>;
  return (
    <div>
      <p className={`term-pnl ${book.pnl < 0 ? "tone-bad" : "tone-ok"}`}>
        {signed(book.pnl)} <span style={{ fontSize: 14 }}>USDT</span>
      </p>
      <div className="term-meta">
        <span>
          Start <b>{money(book.start)}</b>
        </span>
        <span>
          Now <b>{money(book.equity)}</b>
        </span>
      </div>
      <SeriesChart points={props.equitySeries} levels={[]} short />
      <p className="term-sub">
        {props.equitySeries.length < 2
          ? "Waiting for a second equity poll. No stored curve."
          : "Polled equity only. No stored curve."}
      </p>
      <table className="term-kv">
        <tbody>
          <Kv label="Realized" value={signed(book.realized)} tone={toneOf(book.realized)} />
          <Kv label="Unrealized" value={signed(book.unrealized)} tone={toneOf(book.unrealized)} />
          <Kv label="Fees paid" value={money(book.fees)} tone={book.fees > 0 ? "bad" : "mute"} />
          <Kv label="Funding" value={signed(book.funding)} tone={toneOf(book.funding)} />
          <Kv label="Open positions" value={String(book.openPositions)} tone="mute" />
          <Kv label="Win rate" value="Not yet built (League Stage 2)" tone="mute" />
        </tbody>
      </table>
    </div>
  );
}

function Engines(props: Props) {
  const teams = teamsOf(props.snapshot);
  if (teams.length === 0) return <p className="term-empty">No strategy engines in this snapshot.</p>;
  return (
    <table className="term-table">
      <colgroup>
        <col style={{ width: "78px" }} />
        <col />
        <col style={{ width: "64px" }} />
      </colgroup>
      <thead>
        <tr>
          <th>Eng</th>
          <th>Last</th>
          <th className="term-right">PnL</th>
        </tr>
      </thead>
      <tbody>
        {teams.map((team) => {
          const delta = team.equity - team.startingEquity;
          return (
            <tr key={team.id}>
              <td>{team.name.toUpperCase()}</td>
              <td title={team.lastSummary}>{clip(team.lastSummary, 42)}</td>
              <td className={`term-right tone-${toneOf(delta)}`}>{signed(delta)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Pipeline(props: Props) {
  const stats = funnel(props.events, props.now ?? props.events[0]?.ts ?? 0);
  const stages = [
    ["Signals", stats.signals, "bad"],
    ["Passed filters", stats.passedFilters, "bad"],
    ["Passed risk", stats.passedRisk, "ok"],
    ["Filled", stats.filled, "ok"],
  ] as const;
  const max = Math.max(stats.signals, 1);
  return (
    <div>
      <p className="term-sub">Signal funnel · {stats.windowLabel}</p>
      <div className="term-bars">
        {stages.map(([label, count, tone]) => (
          <div className="term-bar-row" key={label}>
            <span>{label}</span>
            <div className={tone === "ok" ? "term-track term-track-ok" : "term-track"}>
              <span style={{ width: `${Math.min(100, (count / max) * 100)}%` }} />
            </div>
            <span className="term-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Teams(props: Props) {
  return (
    <Panel title="Paper books" fk="2">
      <p className="term-empty">Not yet built (League Stage 2). These rows are the live paper books, not a season table.</p>
      <TeamRows snapshot={props.snapshot} />
    </Panel>
  );
}

function Fills(props: Props) {
  const rows = fillRows(props.events);
  const orders = teamsOf(props.snapshot).flatMap((team) =>
    team.orders.map((order) => ({ team: team.name, ...order })),
  );
  return (
    <div className="term-stack">
      <Panel title="Fills" fk="3">
        {rows.length === 0 ? (
          <p className="term-empty">No trades yet.</p>
        ) : (
          <table className="term-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Team</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.time}</td>
                  <td>{row.who}</td>
                  <td>
                    <Chip tone={row.tone}>{row.badge}</Chip>
                  </td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Resting orders" fk="3">
        {orders.length === 0 ? (
          <p className="term-empty">No resting paper orders.</p>
        ) : (
          <table className="term-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Type</th>
                <th>Side</th>
                <th>Symbol</th>
                <th className="term-right">Qty</th>
                <th className="term-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, index) => (
                <tr key={`${order.team}-${order.type}-${index}`}>
                  <td>{order.team}</td>
                  <td>{order.type}</td>
                  <td>{order.positionSide}</td>
                  <td>{order.symbol}</td>
                  <td className="term-right">{qtyFmt(order.qty)}</td>
                  <td className="term-right">
                    {order.stopPrice !== null ? priceFmt(order.stopPrice) : order.limitPrice !== null ? priceFmt(order.limitPrice) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Pnl(props: Props) {
  const book = sessionPnl(props.snapshot);
  return (
    <div className="term-stack">
      <Panel title="Session P&L" fk="4">
        <Session {...props} />
      </Panel>
      <Panel title="Team books" fk="4">
        {book ? (
          <table className="term-table">
            <thead>
              <tr>
                <th>Team</th>
                <th className="term-right">Start</th>
                <th className="term-right">Equity</th>
                <th className="term-right">Delta</th>
                <th className="term-right">Realized</th>
                <th className="term-right">Fees</th>
                <th className="term-right">Funding</th>
              </tr>
            </thead>
            <tbody>
              {teamsOf(props.snapshot).map((team) => {
                const delta = team.equity - team.startingEquity;
                return (
                  <tr key={team.id}>
                    <td>{team.name}</td>
                    <td className="term-right">{money(team.startingEquity)}</td>
                    <td className="term-right">{money(team.equity)}</td>
                    <td className={`term-right tone-${toneOf(delta)}`}>{signed(delta)}</td>
                    <td className={`term-right tone-${toneOf(team.realizedPnl ?? 0)}`}>{signed(team.realizedPnl ?? 0)}</td>
                    <td className="term-right">{money(team.fees ?? 0)}</td>
                    <td className={`term-right tone-${toneOf(team.funding ?? 0)}`}>{signed(team.funding ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="term-empty">The league book is not in this snapshot.</p>
        )}
        {props.snapshot.paper ? (
          <p className="term-sub">
            Legacy single book {money(props.snapshot.paper.equity)} USDT, {props.snapshot.paper.positions.length} open.
            League P&amp;L uses the five team books. {props.snapshot.paper.note}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

function Risk(props: Props) {
  const rows = limitRows(props.snapshot);
  const vetoes = vetoRows(props.events);
  const gross = grossNotional(props.snapshot);
  const capPct = props.snapshot.limits?.values.maxGrossExposurePct;
  const pool = props.snapshot.league?.pool;
  return (
    <div className="term-stack">
      <Panel title="Risk limits" fk="5">
        <p className="term-sub">
          Head trader {props.snapshot.headTrader}. Aster orders {props.snapshot.ordersEnabled ? "enabled" : "disabled"}.
          {props.snapshot.limits ? ` Limit version ${props.snapshot.limits.version}.` : ""}
        </p>
        {rows.length === 0 ? (
          <p className="term-empty">Risk limits have not loaded.</p>
        ) : (
          <table className="term-kv">
            <tbody>
              {rows.map((row) => (
                <Kv key={row.label} label={row.label} value={row.value} tone="mute" />
              ))}
              <Kv label="Open notional" value={`${money(gross)} USDT`} tone="mute" />
              {pool !== undefined && capPct !== undefined ? (
                <Kv label="League gross cap" value={`${money(pool * capPct)} USDT`} tone="mute" />
              ) : null}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Vetoes" fk="5">
        {vetoes.length === 0 ? (
          <p className="term-empty">No vetoes in the loaded event window.</p>
        ) : (
          <table className="term-table">
            <tbody>
              {vetoes.map((row) => (
                <tr key={row.id}>
                  <td>{row.time}</td>
                  <td>{row.who}</td>
                  <td>
                    <Chip tone={row.tone}>{row.badge}</Chip>
                  </td>
                  <td>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Regime(props: Props) {
  return (
    <div className="term-stack">
      {props.snapshot.symbols.map((symbol) => (
        <Panel key={symbol.symbol} title={symbol.symbol} fk="6">
          <p>{symbol.pass?.market.summary ?? "Waiting for the first candle pass."}</p>
          <div className="term-meta">
            <span>
              Regime <b>{labelRegime(symbol.pass?.market.regime)}</b>
            </span>
            <span>
              Mark <b>{symbol.quote ? priceFmt(symbol.quote.mark) : "—"}</b>
            </span>
            <span>
              Index <b>{symbol.quote ? priceFmt(symbol.quote.index) : "—"}</b>
            </span>
            <span>
              Funding <b>{symbol.quote ? percent(symbol.quote.fundingRate, 4) : "—"}</b>
            </span>
            <span>
              Next funding <b>{symbol.quote ? utcTime(symbol.quote.nextFundingTime) : "—"}</b>
            </span>
            <span>
              Bid / ask <b>{symbol.quote ? `${priceFmt(symbol.quote.bid)} / ${priceFmt(symbol.quote.ask)}` : "—"}</b>
            </span>
            <span>
              Spread <b>{bps(symbol.pass?.market.spreadBps)}</b>
            </span>
          </div>
          <RsiBars rsi={symbol.pass?.technical.rsiByTimeframe} />
          <p className="term-sub">{symbol.pass?.technical.summary ?? "Indicators have not been calculated."}</p>
          <p className="term-sub">
            EMA20 {num(symbol.pass?.technical.ema20)} · EMA50 {num(symbol.pass?.technical.ema50)} · VWAP{" "}
            {num(symbol.pass?.technical.vwap)} · MACD hist {num(symbol.pass?.technical.macdHistogram)}
          </p>
          <p className="term-sub">{symbol.pass?.news.summary ?? "No news flag yet."}</p>
          {(symbol.pass?.decisions.length ?? 0) === 0 ? (
            <p className="term-sub">No shared-scan ticket on the latest closed 15-minute candle.</p>
          ) : (
            symbol.pass?.decisions.map((decision) => (
              <p key={`${symbol.symbol}-${decision.ticket.setup}`}>
                <Chip tone={decision.risk.action === "approve" ? "ok" : "bad"}>
                  {decision.risk.action === "approve" ? "APPROVED" : "VETOED"}
                </Chip>{" "}
                Shared scan {decision.ticket.side} {decision.ticket.setup.replaceAll("_", " ")}. Entry{" "}
                {priceFmt(decision.ticket.entry)}, stop {priceFmt(decision.ticket.stop)}, target{" "}
                {priceFmt(decision.ticket.targets[0] ?? 0)}. {decision.risk.reason} {decision.headNote}
              </p>
            ))
          )}
          {symbol.error ? <p className="term-note">{symbol.error}</p> : null}
        </Panel>
      ))}
      <Panel title="Aster rate limits" fk="6">
        {(props.snapshot.rateLimits ?? []).length === 0 ? (
          <p className="term-empty">Exchange rate limits have not loaded.</p>
        ) : (
          <table className="term-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Interval</th>
                <th className="term-right">Limit</th>
              </tr>
            </thead>
            <tbody>
              {props.snapshot.rateLimits?.map((limit) => (
                <tr key={`${limit.rateLimitType}-${limit.interval}-${limit.intervalNum}`}>
                  <td>{limit.rateLimitType}</td>
                  <td>
                    {limit.intervalNum} {limit.interval}
                  </td>
                  <td className="term-right">{limit.limit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function RsiBars({ rsi }: { rsi: Record<string, number | null> | undefined }) {
  const frames = ["5m", "15m", "1h", "4h", "1d"];
  if (!rsi) return <p className="term-sub">RSI has not been calculated.</p>;
  return (
    <div className="term-bars">
      {frames.map((frame) => {
        const value = rsi[frame];
        const width = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
        return (
          <div className="term-bar-row" key={frame}>
            <span>{frame} RSI</span>
            <div className="term-track">
              <span style={{ width: `${width}%` }} />
            </div>
            <span className="term-right">{num(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Log(props: Props) {
  if (props.events.length === 0) return <Panel title="Agent log" fk="7"><p className="term-empty">No observations yet.</p></Panel>;
  return (
    <Panel title="Agent log" fk="7">
      <table className="term-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Agent</th>
            <th>Kind</th>
            <th>Record</th>
          </tr>
        </thead>
        <tbody>
          {props.events.map((event) => (
            <tr key={event.id}>
              <td>{utcTime(event.ts)}</td>
              <td>{event.agent.toUpperCase()}</td>
              <td>{event.kind}</td>
              <td>{eventText(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Kv({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <tr>
      <td>{label}</td>
      <td className={`tone-${tone}`}>{value}</td>
    </tr>
  );
}

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

function clip(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1)}…`;
}

function labelRegime(regime: string | undefined): string {
  if (!regime) return "—";
  return regime.replaceAll("_", " ");
}
