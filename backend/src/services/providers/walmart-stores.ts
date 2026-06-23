import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zipcodes from "zipcodes";
import { NormalizedLocation } from "./types.js";

// Bundled Walmart store directory (store_id + ZIP + address). Walmart has no public
// store API, so we ship this list and resolve city/state from the ZIP code, which lets
// users browse stores by state → city entirely offline.

interface RawStore {
  store_id: string;
  postal_code: string;
  address: string;
  latitude?: string;
  longitude?: string;
  country?: string;
}

function loadRaw(): RawStore[] {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(dir, "../../data/walmart-stores.json"), // dev: src/data, prod: dist/data
    path.resolve(dir, "../../../src/data/walmart-stores.json"), // prod fallback to src
    path.resolve(process.cwd(), "src/data/walmart-stores.json"),
    path.resolve(process.cwd(), "dist/data/walmart-stores.json")
  ];
  for (const file of candidates) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as RawStore[];
    } catch {
      /* try next */
    }
  }
  return [];
}

// Addresses use a non-breaking space (0xA0, sometimes shown as "Â") around separators.
function normalizeAddress(addr: string): string {
  return addr.replace(/ /g, " ").replace(/Â/g, " ").replace(/\s+/g, " ").trim();
}
function parseCityState(addr: string): { city: string; state: string } | null {
  const m = normalizeAddress(addr).match(/,\s*([^,]+?),\s*([A-Z]{2})\s+\d{5}/);
  return m ? { city: m[1].trim(), state: m[2] } : null;
}
function streetOf(addr: string): string {
  return normalizeAddress(addr).split(",")[0].trim();
}

interface DirStore extends NormalizedLocation {
  searchText: string;
}

let cache: DirStore[] | null = null;

function build(): DirStore[] {
  if (cache) return cache;
  const raw = loadRaw().filter((s) => s.country !== "MX");
  cache = raw
    .map((s): DirStore => {
      const z = zipcodes.lookup(s.postal_code);
      const parsed = parseCityState(s.address);
      const city = (z?.city || parsed?.city || "").trim();
      const state = (z?.state || parsed?.state || "").trim();
      const street = streetOf(s.address);
      return {
        source: "walmart",
        externalId: String(s.store_id),
        name: city ? `Walmart — ${city}, ${state}` : `Walmart #${s.store_id}`,
        chain: "Walmart",
        address: street,
        city,
        state,
        zip: s.postal_code,
        latitude: z?.latitude ?? (s.latitude ? Number(s.latitude) : null),
        longitude: z?.longitude ?? (s.longitude ? Number(s.longitude) : null),
        searchText: `${street} ${city} ${state} ${s.postal_code} ${s.store_id}`.toLowerCase()
      };
    })
    .filter((s) => s.state);
  return cache;
}

function strip(store: DirStore): NormalizedLocation {
  const { searchText, ...loc } = store;
  void searchText;
  return loc;
}

export function listStates(): { state: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of build()) counts.set(s.state!, (counts.get(s.state!) ?? 0) + 1);
  return [...counts.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => a.state.localeCompare(b.state));
}

export function listCities(state: string): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of build()) {
    if (s.state === state && s.city) counts.set(s.city, (counts.get(s.city) ?? 0) + 1);
  }
  return [...counts.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => a.city.localeCompare(b.city));
}

export function findStores(opts: { state?: string; city?: string; q?: string; limit?: number }): NormalizedLocation[] {
  const q = opts.q?.trim().toLowerCase();
  let rows = build();
  if (opts.state) rows = rows.filter((s) => s.state === opts.state);
  if (opts.city) rows = rows.filter((s) => s.city === opts.city);
  if (q) rows = rows.filter((s) => s.searchText.includes(q));
  return rows.slice(0, opts.limit ?? 100).map(strip);
}

export function getStoreById(id: string): NormalizedLocation | undefined {
  const match = build().find((s) => s.externalId === String(id));
  return match ? strip(match) : undefined;
}
