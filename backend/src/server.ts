import cors from "@fastify/cors";
import Fastify from "fastify";
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
import { prisma } from "./lib/prisma.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = rawMessage.includes("Can't reach database server")
      ? "Database is not running. Start PostgreSQL, then run Prisma migrations."
      : rawMessage;
    reply.status(500).send({ error: message });
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

  return app;
}

const port = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== "test") {
  buildServer().listen({ port, host: "0.0.0.0" });
}
