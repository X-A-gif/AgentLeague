import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET_REST, MAINNET_WS, type Interval } from "@aster/client";
import { DEFAULT_LIMITS, type AccountState } from "@aster/risk";

export const SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;
export const INTERVALS: Interval[] = ["5m", "15m", "1h", "4h", "1d"];
export const DESK_HOST = "127.0.0.1";
export const DESK_PORT = 47221;
export const WEB_ORIGIN = "http://127.0.0.1:47223";

export const RESEARCH_ACCOUNT: AccountState = {
  equity: 10_000,
  availableMargin: 10_000,
  grossExposure: 0,
  dailyRealizedLoss: 0,
  consecutiveLosses: 0,
  drawdownPct: 0,
  halted: false,
  maintenanceMarginRate: 0.005,
};

export const LIMITS = DEFAULT_LIMITS;

export function dataFile(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/research.sqlite");
}

export function restBase(): string {
  return process.env.ASTER_REST_BASE ?? MAINNET_REST;
}

export function wsBase(): string {
  return process.env.ASTER_WS_BASE ?? MAINNET_WS;
}

export function standDown(): boolean {
  return process.env.STAND_DOWN === "1";
}
