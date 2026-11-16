import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanScheduler, crossedBoundary, isScanKline, nextScanAt } from "./schedule.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("scan schedule", () => {
  it("aligns the next run to the following 15-minute boundary", () => {
    const at = Date.parse("2026-11-16T12:07:00.000Z");
    expect(new Date(nextScanAt(at)).toISOString()).toBe("2026-11-16T12:15:00.000Z");
    expect(crossedBoundary(at, Date.parse("2026-11-16T12:14:59.000Z"))).toBe(false);
    expect(crossedBoundary(at, Date.parse("2026-11-16T12:15:00.000Z"))).toBe(true);
  });

  it("treats a closed 15m candle, and the last 1m of the bucket, as a scan", () => {
    const open = Date.parse("2026-11-16T12:14:00.000Z");
    expect(isScanKline({ x: true, i: "1m", t: open })).toBe(true);
    expect(isScanKline({ x: "true", i: "1m", t: open })).toBe(true);
    expect(isScanKline({ x: 1, i: "15m", t: Date.parse("2026-11-16T12:00:00.000Z") })).toBe(true);
    expect(isScanKline({ x: false, i: "1m", t: open })).toBe(false);
    expect(isScanKline({ x: true, i: "1m", t: Date.parse("2026-11-16T12:13:00.000Z") })).toBe(false);
    expect(isScanKline({ x: true, i: "5m", t: open })).toBe(false);
  });

  it("fires on each boundary and once after a clock jump", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T12:07:00.000Z"));
    const reasons: string[] = [];
    const scheduler = new ScanScheduler((reason) => reasons.push(reason));
    scheduler.start();

    vi.advanceTimersByTime(8 * 60 * 1000);
    expect(reasons).toEqual(["15m-close"]);

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(reasons).toEqual(["15m-close", "15m-close"]);

    vi.setSystemTime(new Date("2026-11-16T14:00:00.000Z"));
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(reasons).toEqual(["15m-close", "15m-close", "clock-jump"]);

    scheduler.stop();
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(reasons).toHaveLength(3);
  });
});
