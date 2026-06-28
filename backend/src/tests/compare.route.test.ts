import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the prisma layer so the route can be exercised without a live database.
vi.mock("../lib/prisma.js", () => ({
  getDefaultUserId: vi.fn(async () => "user-1"),
  prisma: {
    groceryList: { findFirst: vi.fn() },
    store: { findMany: vi.fn(async () => []) },
    priceEntry: { findMany: vi.fn(async () => []) },
    coupon: { findMany: vi.fn(async () => []) },
    userSettings: { findUnique: vi.fn(async () => null) },
    distanceCache: { findMany: vi.fn(async () => []) }
  }
}));

import { prisma } from "../lib/prisma.js";
import { buildServer } from "../server.js";

describe("GET /api/compare/:listId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.store.findMany as any).mockResolvedValue([]);
    (prisma.priceEntry.findMany as any).mockResolvedValue([]);
    (prisma.coupon.findMany as any).mockResolvedValue([]);
    (prisma.userSettings.findUnique as any).mockResolvedValue(null);
    (prisma.distanceCache.findMany as any).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a clean 404 when the list does not exist or is not owned", async () => {
    (prisma.groceryList.findFirst as any).mockResolvedValue(null);

    const app = buildServer();
    try {
      const response = await app.inject({ method: "GET", url: "/api/compare/nonexistent-id" });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "List not found" });

      // Must not leak server filesystem paths or ORM internals.
      const body = response.body;
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/prisma/i);
      expect(body).not.toMatch(/findUnique/i);
    } finally {
      await app.close();
    }
  });

  it("returns the comparison result for a valid list (settings falling back to defaults)", async () => {
    (prisma.groceryList.findFirst as any).mockResolvedValue({
      id: "weekly",
      name: "Weekly",
      userId: "user-1",
      items: [
        {
          id: "li1",
          quantityNeeded: 1,
          unitType: "lb",
          groceryItem: { id: "beef", name: "Ground beef", category: "Meat" }
        }
      ]
    });

    const app = buildServer();
    try {
      const response = await app.inject({ method: "GET", url: "/api/compare/weekly" });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result).toHaveProperty("itemRows");
      expect(result).toHaveProperty("storeTotals");
    } finally {
      await app.close();
    }
  });
});
