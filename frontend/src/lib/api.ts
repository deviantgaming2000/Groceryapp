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
    throw new Error(parsed?.error || parsed?.message || text || response.statusText);
  }
  return (parsed ?? undefined) as T;
}

export function money(value: number | string | null | undefined) {
  if (value == null || value === "") return "-";
  return `$${Number(value).toFixed(2)}`;
}

export function dateOnly(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}
