import { getDefaultUserId, prisma } from "../lib/prisma.js";

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface CredentialSpec {
  provider: string;
  label: string;
  description: string;
  docsUrl?: string;
  fields: CredentialField[];
  /** Maps each field key to the env var used as a fallback. */
  envMap: Record<string, string>;
}

// Single source of truth for which integrations need which keys.
export const CREDENTIAL_SPECS: CredentialSpec[] = [
  {
    provider: "kroger",
    label: "Kroger / Fry's",
    description: "Live product search and pricing from the Kroger Products & Locations APIs.",
    docsUrl: "https://developer.kroger.com",
    fields: [
      { key: "clientId", label: "Client ID", secret: false },
      { key: "clientSecret", label: "Client Secret", secret: true }
    ],
    envMap: { clientId: "KROGER_CLIENT_ID", clientSecret: "KROGER_CLIENT_SECRET" }
  },
  {
    provider: "walmart",
    label: "Walmart (via SerpApi)",
    description: "Walmart has no open API; product search comes through SerpApi's Walmart engine.",
    docsUrl: "https://serpapi.com/walmart-product-api",
    fields: [{ key: "apiKey", label: "SerpApi Key", secret: true }],
    envMap: { apiKey: "SERPAPI_KEY" }
  },
  {
    provider: "google_maps",
    label: "Google Maps (driving distance)",
    description: "Optional. Auto-calculates store distances via the Distance Matrix API.",
    docsUrl: "https://console.cloud.google.com/google/maps-apis",
    fields: [{ key: "apiKey", label: "API Key", secret: true }],
    envMap: { apiKey: "GOOGLE_MAPS_API_KEY" }
  },
  {
    provider: "walmart-scraper",
    label: "Walmart (self-hosted scraper)",
    description:
      "Free alternative to SerpApi: a self-hosted Walmart price scraper. Point this at the running scraper service — it can live on this machine or a remote server.",
    docsUrl: "https://github.com/deviantgaming2000/walmart-scraper",
    fields: [{ key: "baseUrl", label: "Scraper URL", secret: false, placeholder: "http://localhost:8090" }],
    envMap: { baseUrl: "WALMART_SCRAPER_URL" }
  },
  {
    provider: "ollama-vision",
    label: "Local Vision OCR (Ollama / MLX)",
    description:
      "Optional. Reads prices and deals off flyer clipping images with a local vision model — nothing leaves your network. Works with Ollama or any OpenAI-compatible server (LM Studio, FastMLX, mlx-vlm). API style auto-detects from the URL; set it explicitly if needed.",
    docsUrl: "https://ollama.com/search?c=vision",
    fields: [
      { key: "baseUrl", label: "Server URL", secret: false, placeholder: "http://192.168.1.50:11434 (Ollama) or http://192.168.1.50:1234/v1 (LM Studio)" },
      { key: "model", label: "Vision model", secret: false, placeholder: "llama3.2-vision or mlx-community/Qwen2.5-VL-7B-Instruct-4bit" },
      { key: "apiStyle", label: "API style (auto / ollama / openai)", secret: false, placeholder: "auto" }
    ],
    envMap: { baseUrl: "OLLAMA_URL", model: "OLLAMA_VISION_MODEL", apiStyle: "VISION_API_STYLE" }
  },
  {
    provider: "safeway",
    label: "Safeway (self-hosted scraper)",
    description:
      "Self-hosted Safeway price scraper (walmart-scraper repo, npm run safeway). It attaches to your real, signed-in Chrome, so prices come from the store your Safeway account has selected.",
    docsUrl: "https://github.com/deviantgaming2000/walmart-scraper",
    fields: [{ key: "baseUrl", label: "Scraper URL", secret: false, placeholder: "http://localhost:8092" }],
    envMap: { baseUrl: "SAFEWAY_SCRAPER_URL" }
  }
];

export function getSpec(provider: string): CredentialSpec | undefined {
  return CREDENTIAL_SPECS.find((s) => s.provider === provider);
}

/** Resolves a provider's config: DB values take precedence, env vars are the fallback. */
export async function resolveConfig(provider: string): Promise<Record<string, string>> {
  const spec = getSpec(provider);
  if (!spec) return {};
  const userId = await getDefaultUserId();
  const row = await prisma.apiCredential.findUnique({ where: { userId_provider: { userId, provider } } });
  const stored = (row?.data as Record<string, string> | undefined) ?? {};
  const config: Record<string, string> = {};
  for (const field of spec.fields) {
    const fromDb = stored[field.key];
    const fromEnv = spec.envMap[field.key] ? process.env[spec.envMap[field.key]] : undefined;
    const value = (fromDb && fromDb.trim()) || (fromEnv && fromEnv.trim()) || "";
    if (value) config[field.key] = value;
  }
  return config;
}

export async function isProviderConfigured(provider: string): Promise<boolean> {
  const spec = getSpec(provider);
  if (!spec) return false;
  const config = await resolveConfig(provider);
  return spec.fields.every((f) => Boolean(config[f.key]));
}

function maskValue(value: string): string {
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export interface CredentialStatus {
  provider: string;
  label: string;
  description: string;
  docsUrl?: string;
  configured: boolean;
  fields: Array<{ key: string; label: string; secret: boolean; set: boolean; hint: string | null; source: "db" | "env" | null }>;
}

/** Per-provider status for the UI — booleans + masked hints only, never raw secrets. */
export async function getCredentialStatuses(): Promise<CredentialStatus[]> {
  const userId = await getDefaultUserId();
  const rows = await prisma.apiCredential.findMany({ where: { userId } });
  const byProvider = new Map(rows.map((r) => [r.provider, (r.data as Record<string, string>) ?? {}]));

  return CREDENTIAL_SPECS.map((spec) => {
    const stored = byProvider.get(spec.provider) ?? {};
    const fields = spec.fields.map((field) => {
      const dbVal = stored[field.key]?.trim();
      const envVal = spec.envMap[field.key] ? process.env[spec.envMap[field.key]]?.trim() : undefined;
      const value = dbVal || envVal || "";
      const source: "db" | "env" | null = dbVal ? "db" : envVal ? "env" : null;
      return {
        key: field.key,
        label: field.label,
        secret: field.secret,
        set: Boolean(value),
        hint: value ? maskValue(value) : null,
        source
      };
    });
    return {
      provider: spec.provider,
      label: spec.label,
      description: spec.description,
      docsUrl: spec.docsUrl,
      configured: fields.every((f) => f.set),
      fields
    };
  });
}

/** Upsert provider credentials. Empty-string values are treated as "leave unchanged". */
export async function saveCredentials(provider: string, input: Record<string, string>) {
  const spec = getSpec(provider);
  if (!spec) throw new Error(`Unknown credential provider "${provider}".`);
  const userId = await getDefaultUserId();
  const existing = await prisma.apiCredential.findUnique({ where: { userId_provider: { userId, provider } } });
  const current = (existing?.data as Record<string, string> | undefined) ?? {};
  const next: Record<string, string> = { ...current };
  for (const field of spec.fields) {
    const value = input[field.key];
    if (value !== undefined && value.trim() !== "") next[field.key] = value.trim();
  }
  await prisma.apiCredential.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, data: next },
    update: { data: next }
  });
}

export async function clearCredentials(provider: string) {
  const userId = await getDefaultUserId();
  await prisma.apiCredential.deleteMany({ where: { userId, provider } });
}
