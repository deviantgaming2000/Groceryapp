import { describe, expect, it } from "vitest";
import { msUntilNightly } from "../services/scheduler.js";

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
