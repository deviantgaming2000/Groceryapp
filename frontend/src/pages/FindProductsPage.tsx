import { FormEvent, useEffect, useState } from "react";
import { api, money } from "../lib/api";

const PROVIDERS = [
  { id: "kroger", label: "Kroger / Fry's" },
  { id: "walmart", label: "Walmart" }
] as const;
type ProviderId = (typeof PROVIDERS)[number]["id"];

interface ProviderStatus {
  provider: string;
  label: string;
  hasStores: boolean;
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
  const [locations, setLocations] = useState<PLocation[]>([]);
  const [searchingLocs, setSearchingLocs] = useState(false);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importingId, setImportingId] = useState("");

  const loadStatus = (p: ProviderId) =>
    api<ProviderStatus>(`/api/${p}/status`).then(setStatus).catch(() => setStatus(null));

  // Reload status when the provider changes; reset transient UI.
  useEffect(() => {
    setStatus(null);
    setResults([]);
    setSearched(false);
    setLocations([]);
    setChangingStore(false);
    setMessage("");
    setError("");
    void loadStatus(provider);
  }, [provider]);

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

  async function importProduct(productId: string) {
    setError("");
    setImportingId(productId);
    try {
      await api(`/api/${provider}/import`, { method: "POST", body: JSON.stringify({ productId }) });
      setMessage("Added to your items and prices.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import product");
    } finally {
      setImportingId("");
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
            <button className="secondary" type="button" onClick={() => setChangingStore((v) => !v)} disabled={!status.configured}>
              {changingStore ? "Cancel" : status.selectedStore ? "Change store" : "Choose store"}
            </button>
          </div>

          {changingStore && (
            <div style={{ marginTop: 14 }}>
              <form className="toolbar" onSubmit={searchLocations}>
                <label className="field" style={{ flex: 1, minWidth: 160 }}>
                  <span>ZIP code</span>
                  <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 85281" />
                </label>
                <button disabled={searchingLocs || !zip}>{searchingLocs ? "Searching…" : "Search stores"}</button>
              </form>
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
                <button type="button" onClick={() => importProduct(p.externalProductId)} disabled={importingId === p.externalProductId}>
                  {importingId === p.externalProductId ? "Adding…" : `Add from ${status?.label ?? "provider"}`}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
