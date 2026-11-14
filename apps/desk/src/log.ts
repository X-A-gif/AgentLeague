import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_LIMITS, isLooser, type Limits } from "@aster/risk";

export type StoredEvent = {
  id: string;
  ts: number;
  agent: string;
  kind: string;
  correlationId: string | null;
  parentIds: string[];
  payload: Record<string, unknown>;
  valid: boolean;
};

export type LimitVersion = {
  id: number;
  createdTs: number;
  limits: Limits;
  confirmed: boolean;
  note: string;
};

export class DecisionLog {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        agent TEXT NOT NULL,
        kind TEXT NOT NULL,
        correlation_id TEXT,
        parent_ids TEXT NOT NULL,
        payload TEXT NOT NULL,
        valid INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS risk_limit_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_ts INTEGER NOT NULL,
        limits_json TEXT NOT NULL,
        confirmed INTEGER NOT NULL,
        note TEXT NOT NULL
      );
    `);
    if (!this.activeLimits()) {
      this.insertLimits(DEFAULT_LIMITS, true, "Accepted Stage 1 defaults");
    }
  }

  close(): void {
    this.db.close();
  }

  append(event: {
    ts: number;
    agent: string;
    kind: string;
    correlationId: string | null;
    parentIds: string[];
    payload: Record<string, unknown>;
    valid?: boolean;
  }): StoredEvent {
    const stored: StoredEvent = {
      id: randomUUID(),
      ts: event.ts,
      agent: event.agent,
      kind: event.kind,
      correlationId: event.correlationId,
      parentIds: event.parentIds,
      payload: event.payload,
      valid: event.valid ?? true,
    };
    this.db
      .prepare(
        `INSERT INTO events (id, ts, agent, kind, correlation_id, parent_ids, payload, valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.id,
        stored.ts,
        stored.agent,
        stored.kind,
        stored.correlationId,
        JSON.stringify(stored.parentIds),
        JSON.stringify(stored.payload),
        stored.valid ? 1 : 0,
      );
    return stored;
  }

  hasCorrelation(correlationId: string): boolean {
    const row = this.db.prepare(`SELECT 1 AS found FROM events WHERE correlation_id = ? LIMIT 1`).get(correlationId) as
      | { found: number }
      | undefined;
    return Boolean(row);
  }

  list(limit = 100): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, ts, agent, kind, correlation_id, parent_ids, payload, valid
         FROM events ORDER BY ts DESC, rowid DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      ts: Number(row.ts),
      agent: String(row.agent),
      kind: String(row.kind),
      correlationId: row.correlation_id === null ? null : String(row.correlation_id),
      parentIds: JSON.parse(String(row.parent_ids)) as string[],
      payload: JSON.parse(String(row.payload)) as Record<string, unknown>,
      valid: Number(row.valid) === 1,
    }));
  }

  activeLimits(): LimitVersion | null {
    const row = this.db
      .prepare(
        `SELECT id, created_ts, limits_json, confirmed, note
         FROM risk_limit_versions WHERE confirmed = 1 ORDER BY id DESC LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    return row ? toVersion(row) : null;
  }

  /**
   * Tightening becomes the active version immediately.
   * Loosening is stored and ignored until confirmLooser is set.
   */
  proposeLimits(next: Limits, note: string, confirmLooser = false): { version: LimitVersion; active: boolean } {
    const current = this.activeLimits();
    const looser = current ? isLooser(next, current.limits) : false;
    const confirmed = !looser || confirmLooser;
    const version = this.insertLimits(next, confirmed, note);
    return { version, active: confirmed };
  }

  private insertLimits(limits: Limits, confirmed: boolean, note: string): LimitVersion {
    const createdTs = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO risk_limit_versions (created_ts, limits_json, confirmed, note) VALUES (?, ?, ?, ?)`,
      )
      .run(createdTs, JSON.stringify(limits), confirmed ? 1 : 0, note);
    return {
      id: Number(result.lastInsertRowid),
      createdTs,
      limits,
      confirmed,
      note,
    };
  }
}

function toVersion(row: Record<string, unknown>): LimitVersion {
  return {
    id: Number(row.id),
    createdTs: Number(row.created_ts),
    limits: JSON.parse(String(row.limits_json)) as Limits,
    confirmed: Number(row.confirmed) === 1,
    note: String(row.note),
  };
}
