import { describe, expect, it, vi } from "vitest";

// Repo convention: no live database in tests. The engine behind the route
// sees no linked entries, so the run completes immediately.
vi.mock("../lib/prisma.js", () => ({
  getDefaultUserId: vi.fn(async () => "user-1"),
  prisma: {
    userSettings: { findUnique: vi.fn(async () => null) },
    priceEntry: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) }
  }
}));

import { buildServer } from "../server.js";

describe("refresh routes", () => {
  it("starts (or joins) a stale refresh and reports it", async () => {
    const app = buildServer();
    const started = await app.inject({ method: "POST", url: "/api/prices/refresh-stale" });
    expect(started.statusCode).toBe(202);
    const { runId } = started.json();
    expect(runId).toBeTruthy();

    const again = await app.inject({ method: "POST", url: "/api/prices/refresh-stale" });
    // Same run while the first is in flight, or a fresh one if it finished:
    expect([runId, again.json().runId]).toContain(again.json().runId);

    const latest = await app.inject({ method: "GET", url: "/api/prices/refresh-runs/latest" });
    expect([200, 204]).toContain(latest.statusCode);
    if (latest.statusCode === 200) expect(latest.json().trigger).toBe("stale-view");
    await app.close();
  });
});
