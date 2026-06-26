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

/** Decide whether the configured server speaks Ollama's API or the OpenAI API.
 *  Honors an explicit apiStyle; otherwise infers from the URL (LM Studio/MLX use /v1). */
function resolveStyle(apiStyle: string | undefined, base: string): "ollama" | "openai" {
  const s = (apiStyle || "").trim().toLowerCase();
  if (s === "ollama" || s === "openai") return s;
  if (/\/v1\b/.test(base) || /:1234\b/.test(base) || /:8000\b/.test(base)) return "openai";
  return "ollama";
}

const PROMPT_TAIL =
  ` Read the sale price and any deal wording. Respond with STRICT JSON only, no prose: ` +
  `{"price": <the per-item sale price in dollars as a number, or null>, ` +
  `"deal": "<short deal text like '2 for $5' or 'Buy 1 Get 1 Free', or null>"}.`;

function parseModelText(text: string): ReadDealResult {
  const trimmed = (text || "").trim();
  try {
    const parsed = JSON.parse(trimmed) as { price?: unknown; deal?: unknown };
    const dealText = typeof parsed.deal === "string" && parsed.deal.trim() ? parsed.deal.trim() : null;
    return { price: parsePrice(parsed.price), dealText, raw: trimmed };
  } catch {
    // Some models wrap JSON in prose — try to find a JSON object, else regex a price.
    const obj = trimmed.match(/\{[\s\S]*\}/);
    if (obj) {
      try {
        const parsed = JSON.parse(obj[0]) as { price?: unknown; deal?: unknown };
        const dealText = typeof parsed.deal === "string" && parsed.deal.trim() ? parsed.deal.trim() : null;
        return { price: parsePrice(parsed.price), dealText, raw: trimmed };
      } catch { /* fall through */ }
    }
    const m = trimmed.match(/\$?\s*(\d+(?:\.\d{2})?)/);
    return { price: m ? parsePrice(m[1]) : null, dealText: trimmed.slice(0, 80) || null, raw: trimmed };
  }
}

async function postJson(url: string, body: unknown, apiKey?: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // vision inference can be slow
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (res.status === 404) throw new ProviderError("The vision server returned 404 — check the URL and that the model is loaded/pulled.", "not_found", 502);
    if (!res.ok) throw new ProviderError(`The vision server returned an error (${res.status}).`, "upstream", 502);
    return await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`Couldn't reach the vision server at ${url}. Is it running and reachable on your network?`, "network", 502);
  } finally {
    clearTimeout(timeout);
  }
}

/** Ask the local vision model to read price + deal text off a flyer clipping image. */
export async function readDealFromImage(imageUrl: string, productName?: string): Promise<ReadDealResult> {
  const cfg = await resolveConfig("ollama-vision");
  const base = (cfg.baseUrl || "").replace(/\/$/, "");
  const model = cfg.model || "llama3.2-vision";
  if (!base) {
    throw new ProviderError("Local vision model isn't configured. Add the server URL in Settings → API Keys.", "not_configured", 503);
  }

  const image = await imageToBase64(imageUrl);
  const prompt = `This is a cropped grocery store flyer ad${productName ? ` for "${productName}"` : ""}.` + PROMPT_TAIL;
  const style = resolveStyle(cfg.apiStyle, base);

  if (style === "openai") {
    // OpenAI-compatible (LM Studio, FastMLX, mlx-vlm). Image goes as a data URI.
    const url = base.endsWith("/chat/completions")
      ? base
      : /\/v1$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const json = await postJson(url, {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
          ]
        }
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" }
    }, cfg.apiKey);
    return parseModelText(json?.choices?.[0]?.message?.content ?? "");
  }

  // Ollama native.
  const json = await postJson(`${base}/api/generate`, {
    model,
    prompt,
    images: [image],
    stream: false,
    format: "json",
    options: { temperature: 0 }
  });
  return parseModelText(json?.response ?? "");
}
