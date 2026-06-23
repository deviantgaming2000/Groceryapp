import { FormEvent, useEffect, useState } from "react";
import { api, money } from "../lib/api";

interface DealProvider { id: string; label: string; needsConfig: boolean; configured: boolean }
interface Deal {
  source: string;
  storeName?: string;
  productName: string;
  brand?: string;
  size?: string;
  salePrice: number | null;
  regularPrice: number | null;
  discountAmount: number | null;
  couponRequired: boolean;
  digitalCoupon: boolean;
  loyaltyRequired: boolean;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  validTo?: string | null;
  matchedItemIds?: string[];
}

function endsLabel(validTo?: string | null) {
  if (!validTo) return null;
  const d = new Date(validTo);
  if (isNaN(d.getTime())) return null;
  return `ends ${d.toLocaleDateString()}`;
}

export function DealsPage() {
  const [providers, setProviders] = useState<DealProvider[]>([]);
  const [source, setSource] = useState("flipp");
  const [zip, setZip] = useState("");
  const [query, setQuery] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState("");
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  useEffect(() => {
    api<DealProvider[]>("/api/deals/providers").then(setProviders).catch(() => {});
    api<any>("/api/settings").then((s) => { if (s?.homeZip) setZip((z) => z || s.homeZip); }).catch(() => {});
  }, []);

  const current = providers.find((p) => p.id === source);
  const needsZip = source === "flipp";

  async function search(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ source });
      if (query.trim()) params.set("q", query.trim());
      if (zip.trim()) params.set("zip", zip.trim());
      setDeals(await api<Deal[]>(`/api/deals/search?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load deals");
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveCoupon(deal: Deal, idx: number) {
    setSavingIdx(idx);
    try {
      await api("/api/deals/save-coupon", { method: "POST", body: JSON.stringify(deal) });
      setSavedIds((prev) => new Set([...prev, idx]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save coupon");
    } finally {
      setSavingIdx(null);
    }
  }

  async function matchToList() {
    if (deals.length === 0) return;
    setError("");
    setMatching(true);
    try {
      const annotated = await api<Deal[]>("/api/deals/match-list", { method: "POST", body: JSON.stringify({ deals }) });
      setDeals(annotated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not match deals");
    } finally {
      setMatching(false);
    }
  }

  const matchedCount = deals.filter((d) => d.matchedItemIds && d.matchedItemIds.length > 0).length;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Deals</h1>
          <p>Find weekly-ad deals, sales, and coupons by store and location. Flipp covers many chains (incl. Safeway &amp; Fry's) by ZIP.</p>
        </div>
      </div>

      <div className="provider-tabs">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`provider-tab ${source === p.id ? "active" : "secondary"}`}
            onClick={() => { setSource(p.id); setDeals([]); setSearched(false); setError(""); }}
          >
            {p.label}{p.needsConfig && !p.configured ? " 🔒" : ""}
          </button>
        ))}
      </div>

      {current?.needsConfig && !current.configured && (
        <div className="system-alert" style={{ marginTop: 12 }}>
          <strong>{current.label} needs setup.</strong>
          <span>Add the API key under <strong>Settings → API Keys</strong> (and select a store in Find Products) to see its promotions.</span>
        </div>
      )}

      <form className="toolbar" style={{ marginTop: 14 }} onSubmit={search}>
        {needsZip && (
          <label className="field" style={{ flex: 1, minWidth: 130 }}>
            <span>ZIP code</span>
            <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 85281" />
          </label>
        )}
        <label className="field" style={{ flex: 2, minWidth: 180 }}>
          <span>Search {source === "manual" ? "your coupons" : "deals"}</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={source === "manual" ? "name, item, store…" : "milk, eggs, chicken…"} />
        </label>
        <button disabled={loading || (needsZip && !zip.trim())}>{loading ? "Searching…" : "Find deals"}</button>
        {deals.length > 0 && (
          <button type="button" className="secondary" onClick={matchToList} disabled={matching}>
            {matching ? "Matching…" : "Match to my list"}
          </button>
        )}
      </form>

      {error && <p className="error">{error}</p>}
      {matchedCount > 0 && <p className="warn badge-pulse">{matchedCount} deal{matchedCount === 1 ? "" : "s"} match items on your grocery list.</p>}

      {loading && (
        <div className="kroger-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <article key={i} className="skeleton skeleton-card" style={{ height: 150 }} />)}
        </div>
      )}

      {!loading && searched && deals.length === 0 && !error && (
        <div className="panel" style={{ marginTop: 14 }}><p style={{ margin: 0 }}>No deals found. Try a different search{needsZip ? " or ZIP code" : ""}.</p></div>
      )}

      {!loading && deals.length > 0 && (
        <div className="kroger-grid">
          {deals.map((d, i) => {
            const matched = d.matchedItemIds && d.matchedItemIds.length > 0;
            return (
              <article key={i} className="kroger-card" style={matched ? { borderColor: "rgba(46,230,166,0.5)", boxShadow: "0 0 0 1px rgba(46,230,166,0.25)" } : undefined}>
                <div className="kroger-thumb">
                  {d.imageUrl ? <img src={d.imageUrl} alt={d.productName} loading="lazy" /> : <span>{d.storeName || "Deal"}</span>}
                </div>
                <div className="kroger-info">
                  <strong>{d.productName}</strong>
                  <span className="kroger-meta">{[d.storeName, d.brand, d.size].filter(Boolean).join(" · ") || "—"}</span>
                  <div className="kroger-price">
                    {d.salePrice != null ? (
                      <>
                        <b>{money(d.salePrice)}</b>
                        {d.regularPrice != null && d.regularPrice > d.salePrice && <span className="kroger-was">{money(d.regularPrice)}</span>}
                      </>
                    ) : (
                      <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{d.description || "See offer"}</span>
                    )}
                  </div>
                  <div className="kroger-badges">
                    {matched && <span className="source-badge promo">On your list</span>}
                    {d.couponRequired && <span className="source-badge kroger">Coupon</span>}
                    {d.digitalCoupon && <span className="source-badge kroger">Digital</span>}
                    {d.loyaltyRequired && <span className="source-badge stale">Loyalty</span>}
                    {endsLabel(d.validTo) && <span className="source-badge manual">{endsLabel(d.validTo)}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
                    {d.sourceUrl && <a href={d.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--brand2)" }}>View source →</a>}
                    <button
                      type="button"
                      className={savedIds.has(i) ? "secondary" : ""}
                      style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}
                      disabled={savingIdx === i || savedIds.has(i)}
                      onClick={() => saveCoupon(d, i)}
                    >
                      {savedIds.has(i) ? "✓ Saved" : savingIdx === i ? "Saving…" : "+ Coupon"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
