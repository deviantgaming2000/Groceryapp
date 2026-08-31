const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });
  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    throw new Error(parsed?.error || parsed?.message || friendlyHttpError(response, text));
  }
  return (parsed ?? undefined) as T;
}

/**
 * A failure that never reached the API - a proxy timeout, a bad gateway - answers
 * with an HTML error page. Rendering that raw dumped nginx markup into the UI, so
 * fall back to a readable message whenever the body is not JSON.
 */
function friendlyHttpError(response: Response, text: string): string {
  const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
  if (!looksLikeHtml && text.trim()) return text;
  switch (response.status) {
    case 502:
    case 503:
      return "The server is unreachable right now. It may still be starting up - try again in a moment.";
    case 504:
      return "This took too long and the connection timed out. Long lookups may still be running in the background; check back before retrying.";
    default:
      return `Request failed (${response.status} ${response.statusText || "error"}).`;
  }
}

export function money(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  return `$${Number(value).toFixed(2)}`;
}

export function dateOnly(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}
