import { FastifyInstance } from "fastify";
import { getDefaultUserId, prisma } from "../lib/prisma.js";
import { latestRun, startRefreshRun } from "../services/refresh.js";

export async function refreshRoutes(app: FastifyInstance) {
  // Fired by the price page on load: refresh anything older than the user's
  // stale threshold. Returns immediately; the page polls the latest run.
  app.post("/prices/refresh-stale", async (_request, reply) => {
    const userId = await getDefaultUserId();
    const settings = await prisma.userSettings.findUnique({ where: { userId } });
    const staleHours = settings?.staleAfterHours ?? 24;
    const run = startRefreshRun({ trigger: "stale-view", staleHours });
    reply.code(202);
    return { runId: run.id, status: run.status };
  });

  app.get("/prices/refresh-runs/latest", async (_request, reply) => {
    const run = latestRun();
    if (!run) return reply.code(204).send();
    return run;
  });
}
