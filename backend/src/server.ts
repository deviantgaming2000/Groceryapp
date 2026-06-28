import cors from "@fastify/cors";
import Fastify, { type FastifyError } from "fastify";
import { itemRoutes } from "./routes/items.js";
import { storeRoutes } from "./routes/stores.js";
import { listRoutes } from "./routes/lists.js";
import { priceRoutes } from "./routes/prices.js";
import { couponRoutes } from "./routes/coupons.js";
import { settingsRoutes } from "./routes/settings.js";
import { distanceRoutes } from "./routes/distance.js";
import { compareRoutes } from "./routes/compare.js";
import { csvRoutes } from "./routes/csv.js";
import { providerRoutes } from "./routes/providers.js";
import { credentialRoutes } from "./routes/credentials.js";
import { dealRoutes } from "./routes/deals.js";
import { dataRoutes } from "./routes/data.js";
import { prisma } from "./lib/prisma.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const rawMessage = error instanceof Error ? error.message : String(error);

    // Intentional: surface the friendly database-unreachable guidance.
    if (rawMessage.includes("Can't reach database server")) {
      request.log.error(error);
      return reply.status(500).send({
        error: "Database is not running. Start PostgreSQL, then run Prisma migrations."
      });
    }

    // Client errors (4xx) - including Fastify schema validation and any error
    // a route raised with an explicit statusCode - carry safe, useful messages.
    // Pass them through unchanged; never collapse a real 4xx into a 500.
    const statusCode =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    if (statusCode < 500) {
      return reply.status(statusCode).send({ error: rawMessage });
    }

    // Unexpected/unhandled (5xx) errors: log the real error server-side so
    // debugging information is preserved, but return a generic body so we never
    // leak the server's filesystem paths, stack traces, or ORM internals.
    request.log.error(error);
    return reply.status(statusCode).send({ error: "Internal server error" });
  });

  app.get("/health", async () => ({ ok: true }));
  async function dbHealth(_request: unknown, reply: any) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return reply.status(503).send({
        ok: false,
        error: "Database is not running. Start PostgreSQL on localhost:5432 or run Docker Compose, then run migrations."
      });
    }
  }

  app.get("/health/db", dbHealth);
  app.get("/api/health/db", dbHealth);
  app.register(itemRoutes, { prefix: "/api" });
  app.register(storeRoutes, { prefix: "/api" });
  app.register(listRoutes, { prefix: "/api" });
  app.register(priceRoutes, { prefix: "/api" });
  app.register(couponRoutes, { prefix: "/api" });
  app.register(settingsRoutes, { prefix: "/api" });
  app.register(distanceRoutes, { prefix: "/api" });
  app.register(compareRoutes, { prefix: "/api" });
  app.register(csvRoutes, { prefix: "/api" });
  app.register(providerRoutes, { prefix: "/api" });
  app.register(credentialRoutes, { prefix: "/api" });
  app.register(dealRoutes, { prefix: "/api" });
  app.register(dataRoutes, { prefix: "/api" });

  return app;
}

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  buildServer().listen({ port, host: "0.0.0.0" });
}
