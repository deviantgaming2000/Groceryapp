import { FormEvent, useEffect, useState } from "react";
import { api, money } from "../lib/api";
import { units } from "../components/FormFields";

interface AppItem { id: string; name: string; category: string; unitType: string }

const STOP = new Set(["the", "and", "with", "for", "size", "each", "pack", "count", "value", "brand"]);
function tokenize(s: string): string[] {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
/** Suggest the existing item whose name best overlaps the product title. */
function suggestItem(title: string, items: AppItem[]): AppItem | null {
  const titleTokens = new Set(tokenize(title));
  let best: AppItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    const itTokens = tokenize(it.name);
    if (!itTokens.length) continue;
    const overlap = itTokens.filter((t) => titleTokens.has(t)).length;
    const score = overlap / itTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
function guessUnit(size?: string): string {
  const s = (size || "").toLowerCase();
  if (/fl\.?\s*oz|fluid/.test(s)) return "fl_oz";
  if (/\bgal|gallon/.test(s)) return "gallon";
  if (/\bqt|quart/.test(s)) return "quart";
  if (/\bpt|pint/.test(s)) return "pint";
  if (/\boz|ounce/.test(s)) return "oz";
  if (/\blb|pound/.test(s)) return "lb";
  return "each";
}

const PROVIDERS = [
  { id: "kroger", label: "Kroger / Fry's" },
  { id: "walmart", label: "Walmart" }
] as const;
type ProviderId = (typeof PROVIDERS)[number]["id"];

interface ProviderStatus {
  provider: string;
  label: string;
  hasStores: boolean;
  hasDirectory: boolean;
  configured: boolean;
  selectedStore: { locationId: string; name: string | null } | null;
}

interface PLocation {
  externalId: string;
  name: string;
  chain?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface PProduct {
  externalProductId: string;
  title: string;
  brand?: string;
  size?: string;
  imageUrl?: string;
  price: number | null;
  regularPrice: number | null;
  promoPrice: number | null;
  unitPrice: number | null;
  available: boolean;
  couponEligible: boolean;
}

export function FindProductsPage() {
  const [provider, setProvider] = useState<ProviderId>("kroger");
  const [status, setStatus] = useState<ProviderStatus | null>(null);

  const [changingStore, setChangingStore] = useState(false);
  const [zip, setZip] = useState("");
  const [directId, setDirectId] = useState("");
  const [locations, setLocations] = useState<PLocation[]>([]);
  const [searchingLocs, setSearchingLocs] = useState(false);

  // Directory browse (providers with hasDirectory, e.g. Walmart)
  const [states, setStates] = useState<{ state: string; count: number }[]>([]);
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [selState, setSelState] = useState("");
  const [selCity, setSelCity] = useState("");

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Import chooser: which comparable item should this product attach to?
  const [items, setItems] = useState<AppItem[]>([]);
  const [pending, setPending] = useState<PProduct | null>(null);
  const [targetItemId, setTargetItemId] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newUnit, setNewUnit] = useState("each");
  const [confirming, setConfirming] = useState(false);

  const loadItems = () => api<AppItem[]>("/api/items").then(setItems).catch(() => {});
  useEffect(() => { void loadItems(); }, []);

  const loadStatus = (p: ProviderId) =>
    api<ProviderStatus>(`/api/${p}/status`).then(setStatus).catch(() => setStatus(null));

  // Reload status when the provider changes; reset transient UI.
  useEffect(() => {
    setStatus(null);
    setResults([]);
    setSearched(false);
    setLocations([]);
    setChangingStore(false);
    setStates([]);
    setCities([]);
    setSelState("");
    setSelCity("");
    setMessage("");
    setError("");
    void loadStatus(provider);
  }, [provider]);

  // Load the state list when opening the store picker for a directory provider.
  async function openStorePicker() {
    setChangingStore((v) => !v);
    if (!changingStore && status?.hasDirectory && states.length === 0) {
      try {
        setStates(await api<{ state: string; count: number }[]>(`/api/${provider}/states`));
      } catch {
        /* leave empty */
      }
    }
  }

  async function pickState(state: string) {
    setSelState(state);
    setSelCity("");
    setLocations([]);
    setCities([]);
    if (!state) return;
    try {
      setCities(await api<{ city: string; count: number }[]>(`/api/${provider}/cities?state=${encodeURIComponent(state)}`));
    } catch {
      setCities([]);
    }
  }

  async function pickCity(city: string) {
    setSelCity(city);
    setLocations([]);
    if (!city) return;
    setSearchingLocs(true);
    try {
      setLocations(
        await api<PLocation[]>(`/api/${provider}/locations?state=${encodeURIComponent(selState)}&city=${encodeURIComponent(city)}`)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load stores");
    } finally {
      setSearchingLocs(false);
    }
  }

  // Suggest a ZIP from saved home settings.
  useEffect(() => {
    api<any>("/api/settings").then((s) => { if (s?.homeZip) setZip((z) => z || s.homeZip); }).catch(() => {});
  }, []);

  async function searchLocations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSearchingLocs(true);
    try {
      setLocations(await api<PLocation[]>(`/api/${provider}/locations?zip=${encodeURIComponent(zip)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search stores");
      setLocations([]);
    } finally {
      setSearchingLocs(false);
    }
  }

  async function selectStore(locationId: string) {
    setError("");
    try {
      await api(`/api/${provider}/store`, { method: "POST", body: JSON.stringify({ locationId }) });
      setMessage("Store saved.");
      setChangingStore(false);
      setLocations([]);
      setSelState("");
      setSelCity("");
      setCities([]);
      await loadStatus(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save store");
    }
  }

  async function searchProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSearching(true);
    setSearched(true);
    try {
      setResults(await api<PProduct[]>(`/api/${provider}/products/search?term=${encodeURIComponent(term)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search products");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  // Open the "compare as" chooser for a product, pre-selecting the best item match.
  function openImport(p: PProduct) {
    const match = suggestItem(p.title, items);
    setPending(p);
    setTargetItemId(match ? match.id : "__new__");
    setNewName(p.title);
    setNewCategory("");
    setNewUnit(guessUnit(p.size));
    setError("");
    setMessage("");
  }

  async function confirmImport() {
    if (!pending) return;
    const body: Record<string, unknown> = { productId: pending.externalProductId };
    let label = "";
    if (targetItemId === "__new__") {
      if (!newName.trim() || !newCategory.trim()) {
        setError("Enter an item name and category.");
        return;
      }
      body.newItem = { name: newName.trim(), category: newCategory.trim(), unitType: newUnit };
      label = newName.trim();
    } else {
      body.groceryItemId = targetItemId;
      label = items.find((i) => i.id === targetItemId)?.name ?? "item";
    }
    setError("");
    setConfirming(true);
    try {
      await api(`/api/${provider}/import`, { method: "POST", body: JSON.stringify(body) });
      setMessage(`Added — comparing under "${label}".`);
      setPending(null);
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import product");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Find Products</h1>
          <p>Search live grocery product data, or keep adding prices manually in Price Entry.</p>
        </div>
      </div>

      {/* Provider switcher */}
      <div className="provider-tabs">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`provider-tab ${provider === p.id ? "active" : "secondary"}`}
            onClick={() => setProvider(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {status && !status.configured && (
        <div className="system-alert" style={{ marginTop: 12 }}>
          <strong>{status.label} is not configured.</strong>
          <span>Add API keys under <strong>Settings → API Keys</strong> to enable live search. Manual entry still works.</span>
        </div>
      )}

      {/* Store selector (providers that support stores) */}
      {status?.hasStores && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Store</h2>
              <p style={{ margin: "4px 0 0" }}>
                {status.selectedStore
                  ? <>Searching prices at <strong style={{ color: "var(--ink)" }}>{status.selectedStore.name || status.selectedStore.locationId}</strong></>
                  : "No store selected yet — pick one to get local prices."}
              </p>
            </div>
            <button className="secondary" type="button" onClick={openStorePicker} disabled={!status.configured}>
              {changingStore ? "Cancel" : status.selectedStore ? "Change store" : "Choose store"}
            </button>
          </div>

          {changingStore && (
            <div style={{ marginTop: 14 }}>
              {status.hasDirectory ? (
                /* Directory browse: state → city (Walmart) */
                <div className="toolbar">
                  <label className="field" style={{ flex: 1, minWidth: 140 }}>
                    <span>State</span>
                    <select value={selState} onChange={(e) => pickState(e.target.value)}>
                      <option value="">Select state…</option>
                      {states.map((s) => <option key={s.state} value={s.state}>{s.state} ({s.count})</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ flex: 1, minWidth: 160 }}>
                    <span>City</span>
                    <select value={selCity} onChange={(e) => pickCity(e.target.value)} disabled={!selState}>
                      <option value="">{selState ? "Select city…" : "Pick a state first"}</option>
                      {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.count})</option>)}
                    </select>
                  </label>
                </div>
              ) : (
                /* Live ZIP search (Kroger) */
                <form className="toolbar" onSubmit={searchLocations}>
                  <label className="field" style={{ flex: 1, minWidth: 160 }}>
                    <span>Search by ZIP code</span>
                    <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 85281" />
                  </label>
                  <button disabled={searchingLocs || !zip}>{searchingLocs ? "Searching…" : "Search stores"}</button>
                </form>
              )}
              <div className="toolbar" style={{ marginTop: 10 }}>
                <label className="field" style={{ flex: 1, minWidth: 160 }}>
                  <span>Or enter a store ID directly</span>
                  <input value={directId} onChange={(e) => setDirectId(e.target.value)} placeholder={provider === "walmart" ? "e.g. 2280 (from the store's walmart.com URL)" : "store ID"} />
                </label>
                <button type="button" className="secondary" disabled={!directId.trim()} onClick={() => selectStore(directId.trim())}>Use this ID</button>
              </div>
              {locations.length > 0 && (
                <div className="dashboard-grid" style={{ marginTop: 12 }}>
                  {locations.map((loc) => (
                    <article key={loc.externalId}>
                      <strong>{loc.name}</strong>
                      <p style={{ margin: "4px 0 10px", fontSize: 13 }}>
                        {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(", ")}
                      </p>
                      <button type="button" onClick={() => selectStore(loc.externalId)}>Use this store</button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Product search */}
      <form className="toolbar" style={{ marginTop: 18 }} onSubmit={searchProducts}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          <span>Search products</span>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="milk, eggs, bread…" />
        </label>
        <button disabled={searching || !term || !status?.configured}>{searching ? "Searching…" : `Search ${status?.label ?? ""}`}</button>
      </form>

      {error && <p className="error">{error}</p>}
      {message && <p className="warn badge-pulse">{message}</p>}

      {searching && (
        <div className="kroger-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <article key={i} className="skeleton skeleton-card" style={{ height: 150 }} />)}
        </div>
      )}

      {!searching && searched && results.length === 0 && !error && (
        <div className="panel" style={{ marginTop: 14 }}><p style={{ margin: 0 }}>No products found. Try a different term.</p></div>
      )}

      {!searching && results.length > 0 && (
        <div className="kroger-grid">
          {results.map((p) => (
            <article key={p.externalProductId} className="kroger-card">
              <div className="kroger-thumb">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.title} loading="lazy" /> : <span>No image</span>}
              </div>
              <div className="kroger-info">
                <strong>{p.title}</strong>
                <span className="kroger-meta">{[p.brand, p.size].filter(Boolean).join(" · ") || "—"}</span>
                <div className="kroger-price">
                  {p.price != null ? (
                    <>
                      <b>{money(p.promoPrice ?? p.price)}</b>
                      {p.promoPrice != null && p.regularPrice != null && (
                        <span className="kroger-was">{money(p.regularPrice)}</span>
                      )}
                      {p.unitPrice != null && <span className="kroger-unit">{money(p.unitPrice)}/unit</span>}
                    </>
                  ) : (
                    <span style={{ color: "var(--ink-soft)" }}>No price{status?.hasStores && !status?.selectedStore ? " (select a store)" : ""}</span>
                  )}
                </div>
                <div className="kroger-badges">
                  {p.couponEligible && <span className="source-badge promo">Deal</span>}
                  {!p.available && <span className="source-badge stale">Out of stock</span>}
                </div>
                <button type="button" onClick={() => openImport(p)}>
                  {`Add from ${status?.label ?? "provider"}`}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* "Compare as" chooser — attach the product as a price under a comparable item */}
      {pending && (
        <div className="modal-backdrop" onClick={() => !confirming && setPending(null)}>
          <div className="modal-card panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Add to your list</h2>
            <p style={{ margin: "0 0 4px" }}><strong style={{ color: "var(--ink)" }}>{pending.title}</strong></p>
            <p style={{ margin: "0 0 14px", fontSize: 13 }}>
              {[pending.brand, pending.size].filter(Boolean).join(" · ")} · {pending.price != null ? money(pending.promoPrice ?? pending.price) : "no price"}
            </p>

            <label className="field">
              <span>Compare as</span>
              <select value={targetItemId} onChange={(e) => setTargetItemId(e.target.value)}>
                <option value="__new__">➕ Create new item…</option>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.category})</option>)}
              </select>
            </label>

            {targetItemId === "__new__" ? (
              <div className="inline-edit" style={{ marginTop: 12 }}>
                <label className="field"><span>Item name</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Whole Milk" /></label>
                <label className="field"><span>Category</span><input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Dairy" /></label>
                <label className="field"><span>Compare by unit</span>
                  <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
                </label>
              </div>
            ) : (
              <p style={{ fontSize: 13, marginTop: 10 }}>
                This {pending.brand || "product"} price will be added under <strong style={{ color: "var(--ink)" }}>{items.find((i) => i.id === targetItemId)?.name}</strong>, so it compares against other stores' prices for that item.
              </p>
            )}

            <div className="action-row" style={{ marginTop: 16 }}>
              <button type="button" onClick={confirmImport} disabled={confirming}>{confirming ? "Adding…" : "Add price"}</button>
              <button type="button" className="secondary" onClick={() => setPending(null)} disabled={confirming}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
