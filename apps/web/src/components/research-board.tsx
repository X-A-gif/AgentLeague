"use client";

import { useEffect, useState } from "react";
import { TerminalDesk } from "@/components/terminal-desk";
import { TABS, type FeedEvent, type Snapshot, type TabId } from "@/lib/desk-model";

type Sample = { t: number; v: number };

export function ResearchBoard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [offline, setOffline] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [tab, setTab] = useState<TabId>("monitor");
  const [now, setNow] = useState<number | null>(null);
  const [marks, setMarks] = useState<Record<string, Sample[]>>({});
  const [equitySeries, setEquitySeries] = useState<Sample[]>([]);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlMessage, setControlMessage] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const index = "1234567".indexOf(event.key);
      if (index < 0) return;
      event.preventDefault();
      const next = TABS[index];
      if (next) setTab(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const [snapshotResponse, eventsResponse] = await Promise.all([
          fetch("/desk/snapshot", { cache: "no-store" }),
          fetch("/desk/events?limit=200", { cache: "no-store" }),
        ]);
        if (!snapshotResponse.ok || !eventsResponse.ok) {
          throw new Error(`Desk responded ${snapshotResponse.status}`);
        }
        const nextSnapshot = (await snapshotResponse.json()) as Snapshot;
        const nextEvents = (await eventsResponse.json()) as { events: FeedEvent[] };
        if (!stopped) {
          setSnapshot(nextSnapshot);
          setEvents(nextEvents.events);
          setOffline(null);
          const sampledAt = Date.now();
          const equity = nextSnapshot.league?.equity;
          if (typeof equity === "number") {
            setEquitySeries((current) => appendSample(current, sampledAt, equity));
          }
          setMarks((current) => {
            const next = { ...current };
            for (const symbol of nextSnapshot.symbols) {
              const price = symbol.quote?.mark ?? symbol.lastPrice;
              if (price === null || price === undefined) continue;
              next[symbol.symbol] = appendSample(current[symbol.symbol] ?? [], sampledAt, price);
            }
            return next;
          });
        }
      } catch (error) {
        if (!stopped) setOffline(error instanceof Error ? error.message : "Desk is unreachable");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refreshToken]);

  async function post(path: string) {
    setBusy(true);
    setControlMessage(null);
    try {
      const response = await fetch(path, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as { reason?: string };
        setControlMessage(body.reason ?? "The desk refused that control.");
      }
      setRefreshToken((value) => value + 1);
    } catch {
      setControlMessage("The desk did not answer.");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  if (!snapshot && offline) {
    return (
      <Boot
        title="The research desk is not running"
        body="Start it with npm run dev:desk, then refresh. This page only reads the local desk. It cannot place an order."
      />
    );
  }

  if (!snapshot) {
    return <Boot title="Connecting to the desk" body="Waiting for the first snapshot." />;
  }

  return (
    <TerminalDesk
      snapshot={snapshot}
      events={events}
      marks={marks}
      equitySeries={equitySeries}
      now={now}
      tab={tab}
      onTab={setTab}
      offline={offline}
      busy={busy}
      armed={armed}
      controlMessage={controlMessage}
      onArm={() => setArmed(true)}
      onKill={() => void post("/desk/kill")}
      onResume={() => void post("/desk/resume")}
      onPaper={() => void post("/desk/paper")}
    />
  );
}

function Boot({ title, body }: { title: string; body: string }) {
  return (
    <div className="term-boot">
      <section className="term-panel">
        <header>
          <h2>{title}</h2>
          <span>{"FK 1<GO>"}</span>
        </header>
        <div className="term-scroll">
          <p>{body}</p>
        </div>
      </section>
    </div>
  );
}

function appendSample(current: Sample[], time: number, value: number): Sample[] {
  const last = current[current.length - 1];
  if (last && time - last.t < 1500) return current;
  return [...current, { t: time, v: value }].slice(-180);
}
