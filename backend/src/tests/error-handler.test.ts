import { describe, expect, it, vi } from "vitest";

// The routes import prisma; mock it so buildServer() works without a live
// database. We only exercise the global error handler here, via ad-hoc routes
// registered on the built app.
vi.mock("../lib/prisma.js", () => ({
  getDefaultUserId: vi.fn(async () => "user-1"),
  prisma: {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }])
  }
}));

import { buildServer } from "../server.js";

describe("global error handler", () => {
  it("returns a generic 500 body for unexpected errors, leaking no internals", async () => {
    const app = buildServer();
    // Simulate an unhandled error whose message embeds the server's filesystem
    // path and ORM internals - exactly what must never reach the client.
    app.get("/api/__boom", async () => {
      throw new Error(
        "Invalid `prisma.groceryList.findUnique()` invocation in /Users/mikehansen/app/backend/src/routes/compare.ts:42:17"
      );
    });

    try {
      const response = await app.inject({ method: "GET", url: "/api/__boom" });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal server error" });

      const body = response.body;
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/prisma/i);
      expect(body).not.toMatch(/findUnique/i);
    } finally {
      await app.close();
    }
  });

  it("passes a deliberate 4xx response through with its intended message/status", async () => {
    const app = buildServer();
    app.get("/api/__forbidden", async (_request, reply) =>
      reply.status(403).send({ error: "You do not own this resource" })
    );

    try {
      const response = await app.inject({ method: "GET", url: "/api/__forbidden" });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "You do not own this resource" });
    } finally {
      await app.close();
    }
  });

  it("keeps Fastify schema validation errors as useful 400 messages", async () => {
    const app = buildServer();
    app.post(
      "/api/__validated",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } }
          }
        }
      },
      async () => ({ ok: true })
    );

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/__validated",
        payload: {}
      });

      expect(response.statusCode).toBe(400);
      // The client-facing validation message is preserved, not replaced by a
      // generic "Internal server error", and carries no filesystem path.
      const json = response.json();
      expect(json.error ?? json.message).toMatch(/name/i);
      expect(response.body).not.toMatch(/\/Users\//);
    } finally {
      await app.close();
    }
  });
});
