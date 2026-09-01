import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  getDefaultUserId: vi.fn(async () => "user-1"),
  prisma: {
    userSettings: { findUnique: vi.fn(async () => ({ autoRefreshHour: 3, autoRefreshEnabled: true })) }
  }
}));

import { msUntilNightly, startNightlyScheduler } from "../services/scheduler.js";

describe("msUntilNightly", () => {
  it("targets today's hour when it is still ahead", () => {
    const now = new Date("2026-08-31T01:00:00");
    const ms = msUntilNightly(now, 3, 0);
    expect(ms).toBe(2 * 3600 * 1000);
  });

  it("rolls to tomorrow when the hour has passed", () => {
    const now = new Date("2026-08-31T04:00:00");
    const ms = msUntilNightly(now, 3, 0);
    expect(ms).toBe(23 * 3600 * 1000);
  });

  it("adds bounded jitter", () => {
    const now = new Date("2026-08-31T01:00:00");
    const ms = msUntilNightly(now, 3, 30 * 60 * 1000, () => 0.5);
    expect(ms).toBe(2 * 3600 * 1000 + 15 * 60 * 1000);
  });
});

describe("startNightlyScheduler", () => {
  it("never arms a timer when stop() runs while schedule() is still awaiting its settings lookup", async () => {
    const run = vi.fn(async () => {});
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    const handle = startNightlyScheduler(run);
    // schedule() only runs synchronously up to its first await (getDefaultUserId()),
    // so calling stop() here races ahead of it - exactly the window where `timer`
    // is still null and stop()'s clearTimeout(timer) is a no-op.
    handle.stop();

    // Flush the pending awaits inside schedule() so it has a chance to (wrongly)
    // arm a timer that stop() already missed. No real nightly timer would ever
    // resolve this fast, so any setTimeout call other than the flush below
    // proves the race was lost.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const armedByScheduler = setTimeoutSpy.mock.calls.filter((call) => call[1] !== 20);
    expect(armedByScheduler).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });
});
