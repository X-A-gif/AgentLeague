/**
 * Scans used to run only when one websocket frame arrived: a closed 1m kline
 * whose open minute is 14, 29, 44, or 59, and only if `k.x` was the boolean
 * `true`. Startup still scanned over REST, so a restart always looked fresh.
 * A missed frame, a close flag that was not a boolean, a half-open socket, or
 * a paused process left `updatedAt` stuck until the next restart.
 * The clock below is the trigger. REST klines run on that trigger. The socket
 * is only an extra hint, and it is replaced with backoff when it goes quiet.
 */
export const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
export const CLOCK_JUMP_MS = 30_000;
export const STREAM_STALE_MS = 45_000;

export function nextScanAt(now: number, interval = FIFTEEN_MINUTES_MS): number {
  return (Math.floor(now / interval) + 1) * interval;
}

export function crossedBoundary(from: number, to: number, interval = FIFTEEN_MINUTES_MS): boolean {
  if (!(to > from)) return false;
  return Math.floor(to / interval) > Math.floor(from / interval);
}

export function isClosedFlag(flag: unknown): boolean {
  return flag === true || flag === 1 || flag === "true";
}

export function isScanKline(kline: { x?: unknown; i?: unknown; t?: unknown } | null | undefined): boolean {
  if (!kline || !isClosedFlag(kline.x)) return false;
  const interval = String(kline.i ?? "");
  if (interval === "15m") return true;
  if (interval !== "1m") return false;
  const open = Number(kline.t);
  return Number.isFinite(open) && new Date(open).getUTCMinutes() % 15 === 14;
}

export class ScanScheduler {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly scan: (reason: "15m-close" | "clock-jump") => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    this.stopped = false;
    this.arm(this.now());
  }

  stop(): void {
    this.stopped = true;
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
  }

  private arm(from: number): void {
    if (this.stopped) return;
    const target = nextScanAt(from, FIFTEEN_MINUTES_MS);
    const delay = Math.max(0, target - this.now());
    this.handle = setTimeout(() => {
      this.handle = null;
      if (this.stopped) return;
      const now = this.now();
      if (crossedBoundary(from, now)) {
        this.scan(now - target > 5_000 ? "clock-jump" : "15m-close");
      }
      this.arm(now);
    }, delay);
  }
}
