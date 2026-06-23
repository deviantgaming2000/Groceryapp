import { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearCredentials, getCredentialStatuses, getSpec, saveCredentials } from "../services/credentials.js";

export async function credentialRoutes(app: FastifyInstance) {
  // Masked status for every integration — never returns raw secrets.
  app.get("/credentials", async () => {
    return getCredentialStatuses();
  });

  // Upsert credentials for one provider. Blank fields are left unchanged.
  app.put("/credentials/:provider", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!getSpec(provider)) return reply.code(404).send({ error: `Unknown integration "${provider}".` });
    const body = z.record(z.string()).parse(request.body ?? {});
    await saveCredentials(provider, body);
    const statuses = await getCredentialStatuses();
    return statuses.find((s) => s.provider === provider);
  });

  // Remove stored credentials for a provider (env fallback, if any, still applies).
  app.delete("/credentials/:provider", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!getSpec(provider)) return reply.code(404).send({ error: `Unknown integration "${provider}".` });
    await clearCredentials(provider);
    const statuses = await getCredentialStatuses();
    return statuses.find((s) => s.provider === provider);
  });
}
