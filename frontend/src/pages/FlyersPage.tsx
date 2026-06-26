import { FormEvent, useEffect, useState } from "react";
import { api, money } from "../lib/api";

interface Flyer {
  id: number;
  merchant: string;
  validFrom: string | null;
  validTo: string | null;
  logoUrl: string | null;
}

interface Deal {
  source: string;
  storeName?: string;
  productName: string;
  brand?: string;
  salePrice: number | null;
  regularPrice: number | null;
  discountAmount: number | null;
  dealText?: string;
  digitalCoupon: boolean;
  loyaltyRequired: boolean;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  validTo?: string | null;
}

function dateRange(from: string | null, to: string | null) {
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (f && t) return `${fmt(f)} – ${fmt(t)}`;
  if (t) return `ends ${fmt(t)}`;
  return "";
}

export function FlyersPage() {
  const [zip, setZip] = useState("");
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [loadingFlyers, setLoadingFlyers] = useState(false);
  const [selected, setSelected] = useState<Flyer | null>(null);
  const [items, setItems] = useState<Deal[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [filter, setFilter] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [reading, setReading] = useState<Record<string, boolean>>({});
  const [visionOn, setVisionOn] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<any>("/api/settings").then((s) => { if (s?.homeZip) setZip((z) => z || s.homeZip); }).catch(() => {});
    api<{ configured: boolean }>("/api/deals/vision-status").then((s) => setVisionOn(s.configured)).catch(() => {});
  }, []);

  async function readImage(idx: number, key: string) {
    const deal = items[idx];
    if (!deal?.imageUrl) return;
    setError("");
    setReading((r) => ({ ...r, [key]: true }));
    try {
      const res = await api<{ price: number | null; dealText: string | null }>("/api/deals/read-image", {
        method: "POST",
        body: JSON.stringify({ imageUrl: deal.imageUrl, productName: deal.productName })
      });
      setItems((list) => list.map((d, i) => i === idx ? { ...d, salePrice: res.price ?? d.salePrice, dealText: res.dealText ?? d.dealText } : d));
      if (res.price == null && !res.dealText) setMessage(`Vision couldn't read a price for "${deal.productName}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vision read failed");
    } finally {
      setReading((r) => ({ ...r, [key]: false }));
    }
  }

  async function loadFlyers(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setError("");
    setSelected(null);
    setItems([]);
    setLoadingFlyers(true);
    try {
      const params = zip.trim() ? `?zip=${encodeURIComponent(zip.trim())}` : "";
      setFlyers(await api<Flyer[]>(`/api/deals/flyers${params}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load flyers");
      setFlyers([]);
    } finally {
      setLoadingFlyers(false);
    }
  }

  // Auto-load once a ZIP is known.
  useEffect(() => { if (zip && flyers.length === 0) void loadFlyers(); /* eslint-disable-next-line */ }, [zip]);

  async function openFlyer(flyer: Flyer) {
    setSelected(flyer);
    setItems([]);
    setFilter("");
    setError("");
    setLoadingItems(true);
    try {
      const params = new URLSearchParams({ merchant: flyer.merchant });
      if (zip.trim()) params.set("zip", zip.trim());
      setItems(await api<Deal[]>(`/api/deals/flyers/${flyer.id}?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this flyer");
    } finally {
      setLoadingItems(false);
    }
  }

  async function saveDeal(deal: Deal, key: string) {
    setError("");
    try {
      await api("/api/deals/save-coupon", {
        method: "POST",
        body: JSON.stringify({
          source: deal.source,
          storeName: deal.storeName ?? selected?.merchant ?? null,
          productName: deal.productName,
          brand: deal.brand ?? null,
          salePrice: deal.salePrice,
          regularPrice: deal.regularPrice,
          discountAmount: deal.discountAmount,
          digitalCoupon: deal.digitalCoupon,
          loyaltyRequired: deal.loyaltyRequired,
          description: deal.description ?? deal.dealText ?? null,
          validTo: deal.validTo ?? null
        })
      });
      setSaved((s) => ({ ...s, [key]: true }));
      setMessage(`Saved "${deal.productName}" to Coupons.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save to coupons");
    }
  }

  const shown = items.filter((d) => {
    const t = filter.trim().toLowerCase();
    return !t || `${d.productName} ${d.brand ?? ""} ${d.dealText ?? ""}`.toLowerCase().includes(t);
  });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Weekly Flyers</h1>
          <p>Browse the full printed weekly ads (far more than the deal search). Pick a store to see every item, with prices and clipping images. Save any to Coupons.</p>
        </div>
      </div>

      <form className="toolbar" style={{ marginTop: 12 }} onSubmit={loadFlyers}>
        <label className="field" style={{ minWidth: 150 }}>
          <span>ZIP code</span>
          <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 85194" />
        </label>
        <button disabled={loadingFlyers}>{loadingFlyers ? "Loading…" : "Load flyers"}</button>
      </form>

      {error && <p className="error">{error}</p>}
      {message && <p className="warn badge-pulse">{message}</p>}

      {/* Flyer picker */}
      {flyers.length > 0 && (
        <div className="dashboard-grid" style={{ marginTop: 14 }}>
          {flyers.map((f) => (
            <article
              key={f.id}
              onClick={() => openFlyer(f)}
              style={{ cursor: "pointer", borderColor: selected?.id === f.id ? "rgba(46,230,166,0.5)" : undefined }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {f.logoUrl && <img src={f.logoUrl} alt={f.merchant} style={{ width: 38, height: 38, objectFit: "contain", borderRadius: 6, background: "#fff" }} />}
                <div>
                  <strong>{f.merchant}</strong>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-soft)" }}>{dateRange(f.validFrom, f.validTo)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Selected flyer items */}
      {selected && (
        <div style={{ marginTop: 20 }}>
          <div className="toolbar" style={{ alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>{selected.merchant} — full flyer</h2>
            {items.length > 0 && (
              <label className="field" style={{ flex: 1, minWidth: 180 }}>
                <span>Filter items</span>
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="milk, chicken, soda…" />
              </label>
            )}
          </div>

          {loadingItems && (
            <div className="kroger-grid" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => <article key={i} className="skeleton skeleton-card" style={{ height: 150 }} />)}
            </div>
          )}

          {!loadingItems && items.length === 0 && !error && (
            <div className="panel" style={{ marginTop: 12 }}><p style={{ margin: 0 }}>No items found in this flyer.</p></div>
          )}

          {!loadingItems && shown.length > 0 && (
            <>
              <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>{shown.length} item{shown.length === 1 ? "" : "s"}{filter ? " match" : ""} · prices shown where Flipp provides them; others show the ad image.</p>
              <div className="kroger-grid">
                {shown.map((d, i) => {
                  const key = `${selected.id}-${i}-${d.productName}`;
                  return (
                    <article key={key} className="kroger-card">
                      <div className="kroger-thumb">
                        {d.imageUrl ? <img src={d.imageUrl} alt={d.productName} loading="lazy" /> : <span>No image</span>}
                      </div>
                      <div className="kroger-info">
                        <strong style={{ fontSize: 13 }}>{d.productName}</strong>
                        {d.brand && <span className="kroger-meta">{d.brand}</span>}
                        <div className="kroger-price">
                          {d.salePrice != null
                            ? <b>{money(d.salePrice)}</b>
                            : <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{d.dealText || "See ad image"}</span>}
                        </div>
                        <div className="kroger-badges">
                          {d.dealText && d.salePrice != null && <span className="source-badge promo">{d.dealText}</span>}
                          {d.digitalCoupon && <span className="source-badge kroger">Digital</span>}
                          {d.loyaltyRequired && <span className="source-badge stale">Loyalty</span>}
                        </div>
                        <div className="action-row" style={{ marginTop: "auto", gap: 6 }}>
                          {visionOn && d.salePrice == null && d.imageUrl && (
                            <button type="button" className="secondary" disabled={reading[key]} onClick={() => readImage(items.indexOf(d), key)}>
                              {reading[key] ? "Reading…" : "🔍 Read price"}
                            </button>
                          )}
                          <button type="button" className={saved[key] ? "secondary" : ""} disabled={saved[key]} onClick={() => saveDeal(d, key)}>
                            {saved[key] ? "✓ Saved" : "Save to coupons"}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
