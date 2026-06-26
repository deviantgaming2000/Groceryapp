import { resolveConfig } from "./credentials.js";
import { ProviderError } from "./providers/types.js";

// Local vision OCR via an Ollama vision model (e.g. llama3.2-vision on the user's Mac).
// Reads a price/deal off a flyer clipping image so image-only flyer items become usable.
// Configured in Settings → API Keys ("Local Vision OCR (Ollama)").

export interface ReadDealResult {
  price: number | null;
  dealText: string | null;
  raw?: string;
}

export async function isVisionConfigured(): Promise<boolean> {
  const cfg = await resolveConfig("ollama-vision");
  return Boolean(cfg.baseUrl);
}

async function imageToBase64(imageUrl: string): Promise<string> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(String(res.status));
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    throw new ProviderError("Couldn't download the flyer image to read.", "network", 502);
  }
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return value > 0 ? value : null;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** Ask the local vision model to read price + deal text off a flyer clipping image. */
export async function readDealFromImage(imageUrl: string, productName?: string): Promise<ReadDealResult> {
  const cfg = await resolveConfig("ollama-vision");
  const base = (cfg.baseUrl || "").replace(/\/$/, "");
  const model = cfg.model || "llama3.2-vision";
  if (!base) {
    throw new ProviderError("Local vision model isn't configured. Add the Ollama URL in Settings → API Keys.", "not_configured", 503);
  }

  const image = await imageToBase64(imageUrl);
  const prompt =
    `This is a cropped grocery store flyer ad${productName ? ` for "${productName}"` : ""}. ` +
    `Read the sale price and any deal wording. Respond with STRICT JSON only, no prose: ` +
    `{"price": <the per-item sale price in dollars as a number, or null>, ` +
    `"deal": "<short deal text like '2 for $5' or 'Buy 1 Get 1 Free', or null>"}.`;

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // vision inference can be slow
    res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        images: [image],
        stream: false,
        format: "json",
        options: { temperature: 0 }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
  } catch {
    throw new ProviderError(
      `Couldn't reach the Ollama vision model at ${base}. Is it running (ollama serve) and reachable on your network?`,
      "network",
      502
    );
  }
  if (res.status === 404) {
    throw new ProviderError(`Ollama doesn't have the model "${model}". Pull it first: ollama pull ${model}.`, "not_found", 502);
  }
  if (!res.ok) {
    throw new ProviderError(`Ollama returned an error (${res.status}).`, "upstream", 502);
  }

  const json = (await res.json()) as { response?: string };
  const text = (json.response ?? "").trim();
  try {
    const parsed = JSON.parse(text) as { price?: unknown; deal?: unknown };
    const dealText = typeof parsed.deal === "string" && parsed.deal.trim() ? parsed.deal.trim() : null;
    return { price: parsePrice(parsed.price), dealText, raw: text };
  } catch {
    // Model didn't return clean JSON — salvage a price with a regex.
    const m = text.match(/\$?\s*(\d+(?:\.\d{2})?)/);
    return { price: m ? parsePrice(m[1]) : null, dealText: text.slice(0, 80) || null, raw: text };
  }
}
