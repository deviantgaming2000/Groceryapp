import { useEffect, useState } from "react";
import { api, dateOnly } from "../lib/api";

function daysOld(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function PriceAgeBadge({ recordedAt }: { recordedAt: string }) {
  const age = daysOld(recordedAt);
  if (age < 14) return <span style={{ color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>{age}d ago</span>;
  if (age < 30) return <span style={{ color: "var(--warn)", fontSize: 11, fontWeight: 700 }}>{age}d — stale</span>;
  return <span style={{ color: "var(--error)", fontSize: 11, fontWeight: 700 }}>{age}d — very stale</span>;
}

export function Dashboard({ setPage }: { setPage: (page: string) => void }) {
  const [lists, setLists] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api<any[]>("/api/lists"),
      api<any[]>("/api/prices"),
      api<any[]>("/api/stores"),
      api<any[]>("/api/coupons")
    ]).then(([l, p, s, c]) => {
      setLists(l);
      setPrices(p.slice(0, 8));
      setStores(s.filter((store) => store.favorite));
      setCoupons(c.filter((coupon: any) => coupon.isActive));
    });
  }, []);

  const activeLists = lists.filter((list) => list.isActive);
  const expiringSoon = coupons.filter((c) => {
    if (!c.expiresAt) return false;
    const days = Math.floor((new Date(c.expiresAt).getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 7;
  });

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Manual prices, store totals, and driving-cost decisions. No scraped or fake prices.</p>
        </div>
      </div>
      <div className="quick-grid">
        {[
          ["Add item", "items"],
          ["Add store", "stores"],
          ["Add price", "prices"],
          ["Compare list", "compare"],
          ["Add deal", "coupons"],
          ["Update gas price", "settings"]
        ].map(([label, page]) => <button key={label} onClick={() => setPage(page)}>{label}</button>)}
      </div>

      {expiringSoon.length > 0 && (
        <div className="system-alert" style={{ marginTop: 12 }}>
          <strong>{expiringSoon.length} deal{expiringSoon.length > 1 ? "s" : ""} expiring within 7 days</strong>
          {expiringSoon.map((c) => (
            <span key={c.id}>{c.name} — expires {dateOnly(c.expiresAt)}</span>
          ))}
        </div>
      )}

      <div className="dashboard-grid">
        <article>
          <h2>Active Grocery Lists</h2>
          {activeLists.length === 0 && <p>No active lists.</p>}
          {activeLists.map((list) => {
            const checked = list.items?.filter((i: any) => i.checkedOff).length ?? 0;
            const total = list.items?.length ?? 0;
            const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
            return (
              <div className="row" key={list.id}>
                <div>
                  <strong>{list.name}</strong>
                  {total > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <div style={{ width: 80, height: 5, background: "var(--line)", borderRadius: 3 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>{checked}/{total}</span>
                    </div>
                  )}
                </div>
                <button className="secondary" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => setPage("compare")}>Compare</button>
              </div>
            );
          })}
        </article>

        <article>
          <h2>Recent Price Updates</h2>
          {prices.map((price) => (
            <div className="row" key={price.id}>
              <div>
                <strong>{price.groceryItem?.name}</strong>
                <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 12 }}>{price.store?.name}</small>
              </div>
              <div style={{ textAlign: "right" }}>
                <PriceAgeBadge recordedAt={price.recordedAt} />
                <small style={{ display: "block", color: "var(--ink-soft)", fontSize: 11 }}>{dateOnly(price.recordedAt)}</small>
              </div>
            </div>
          ))}
        </article>

        <article>
          <h2>Favorite Stores</h2>
          {stores.map((store) => <div className="row" key={store.id}><strong>{store.name}</strong><span>{store.city}, {store.state}</span></div>)}
        </article>

        {coupons.length > 0 && (
          <article>
            <h2>Active Deals</h2>
            {coupons.slice(0, 5).map((c) => (
              <div className="row" key={c.id}>
                <strong style={{ fontSize: 13 }}>{c.name}</strong>
                <span style={{ fontSize: 12 }}>{c.expiresAt ? `exp. ${dateOnly(c.expiresAt)}` : "no exp."}</span>
              </div>
            ))}
            {coupons.length > 5 && <p style={{ fontSize: 12, margin: "8px 0 0" }}>+{coupons.length - 5} more</p>}
          </article>
        )}
      </div>
    </section>
  );
}
