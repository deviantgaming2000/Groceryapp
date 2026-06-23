import { useEffect, useState } from "react";
import { api, money } from "../lib/api";
import { AnimatedNumber } from "../components/AnimatedNumber";

const asMoney = (n: number) => `$${n.toFixed(2)}`;

function AgeBadge({ staleStatus }: { staleStatus?: string }) {
  if (!staleStatus || staleStatus === "current") return null;
  const old = staleStatus === "very_old_price";
  return (
    <span style={{
      display: "inline-block", fontSize: 10, fontWeight: 700, padding: "1px 5px",
      borderRadius: 4, marginLeft: 5, verticalAlign: "middle",
      background: old ? "var(--error)" : "var(--warn)", color: "#000", opacity: 0.85
    }}>
      {old ? "VERY STALE" : "STALE"}
    </span>
  );
}

export function ComparePage() {
  const [lists, setLists] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { api<any[]>("/api/lists").then((rows) => { setLists(rows); if (rows[0]) setSelected(rows[0].id); }); }, []);

  async function run(id = selected) {
    if (!id) return;
    setLoading(true);
    try {
      setComparison(await api(`/api/compare/${id}`));
    } finally {
      setLoading(false);
    }
  }

  const winnerSingleId = comparison?.bestSingleStore?.storeId;
  const winnerAdjustedId = comparison?.bestAdjustedStore?.storeId;

  function storeRowClass(store: any) {
    if (!store.complete) return "muted-row";
    if (store.storeId === winnerAdjustedId) return "winner-row";
    return "";
  }

  const savings = (() => {
    if (!comparison?.bestAdjustedStore || !comparison?.storeTotals) return null;
    const complete = comparison.storeTotals.filter((s: any) => s.complete);
    if (complete.length < 2) return null;
    const sorted = [...complete].sort((a: any, b: any) => a.adjustedTotal - b.adjustedTotal);
    return sorted[1].adjustedTotal - sorted[0].adjustedTotal;
  })();

  return (
    <section>
      <h1>Price Comparison</h1>
      <div className="toolbar">
        <label className="field">
          <span>Grocery list</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </label>
        <button onClick={() => run()} disabled={loading}>{loading ? "Comparing…" : "Compare list"}</button>
      </div>

      {loading && (
        <div className="summary-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <article key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      )}

      {comparison && !loading && <div>
        <div className="summary-grid">
          <article style={winnerSingleId ? { borderColor: "var(--accent)" } : {}}>
            <span>Best single-store option</span>
            <strong>{comparison.bestSingleStore?.storeName || "Not enough data"}</strong>
            <b style={{ color: "var(--accent)" }}><AnimatedNumber value={comparison.bestSingleStore?.groceryTotal != null ? Number(comparison.bestSingleStore.groceryTotal) : null} format={asMoney} /></b>
          </article>
          <article style={winnerAdjustedId ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent-dark)" } : {}}>
            <span>Best with driving cost</span>
            <strong>
              {comparison.bestAdjustedStore?.storeName || "Not enough data"}
              {savings != null && <span className="badge-pulse" style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>saves <AnimatedNumber value={savings} format={asMoney} /> vs next</span>}
            </strong>
            <b style={{ color: "var(--accent)" }}><AnimatedNumber value={comparison.bestAdjustedStore?.adjustedTotal != null ? Number(comparison.bestAdjustedStore.adjustedTotal) : null} format={asMoney} /></b>
          </article>
          <article>
            <span>Best mixed-store option</span>
            <strong>{comparison.mixedStoreStrategy.complete ? "Complete" : "Incomplete"}</strong>
            <b><AnimatedNumber value={comparison.mixedStoreStrategy.checkoutTotal != null ? Number(comparison.mixedStoreStrategy.checkoutTotal) : null} format={asMoney} /></b>
          </article>
        </div>

        {comparison.warnings.length > 0 && (
          <div className="warn-list">{comparison.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}</div>
        )}

        <h2>Store Totals</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Store</th>
                <th>Grocery total</th>
                <th>Missing</th>
                <th>Stale</th>
                <th>Distance</th>
                <th>Driving cost</th>
                <th>Adjusted total</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {[...comparison.storeTotals].sort((a: any, b: any) => {
                if (a.complete && !b.complete) return -1;
                if (!a.complete && b.complete) return 1;
                return a.adjustedTotal - b.adjustedTotal;
              }).map((store: any, idx: number) => (
                <tr key={store.storeId} className={storeRowClass(store)}>
                  <td>
                    {store.storeName}
                    {store.storeId === winnerAdjustedId && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: "var(--accent)" }}>★ BEST</span>}
                    {store.storeId !== winnerAdjustedId && store.complete && idx > 0 && comparison.bestAdjustedStore && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--ink-soft)" }}>
                        +{money(store.adjustedTotal - comparison.bestAdjustedStore.adjustedTotal)}
                      </span>
                    )}
                  </td>
                  <td>{money(store.groceryTotal)}</td>
                  <td>{store.missingCount > 0 ? <span className="warn">{store.missingCount}</span> : "—"}</td>
                  <td>{store.oldPriceCount > 0 ? <span className="warn">{store.oldPriceCount}</span> : "—"}</td>
                  <td>{store.oneWayMiles != null ? `${store.oneWayMiles} mi` : "—"}</td>
                  <td>{money(store.drivingCost)}</td>
                  <td>{store.complete ? <strong>{money(store.adjustedTotal)}</strong> : <span className="muted-row" style={{ padding: 0 }}>Incomplete</span>}</td>
                  <td style={{ fontSize: 12 }}>{store.warnings.join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Item Prices</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Item</th><th>Needed</th><th>Cheapest</th><th>Prices by store</th></tr>
            </thead>
            <tbody>
              {comparison.itemRows.map((row: any) => (
                <tr key={row.itemId}>
                  <td>{row.itemName}</td>
                  <td>{row.neededQuantity} {row.neededUnit}</td>
                  <td style={{ color: "var(--accent)", fontWeight: 700 }}>{row.cheapestStoreName || <span className="error">Missing data</span>}</td>
                  <td>
                    {row.prices.map((price: any) => (
                      <div key={price.storeId} className={price.storeId === row.cheapestStoreId ? "cheap" : ""} style={{ marginBottom: 4 }}>
                        <strong>{price.storeName}:</strong>{" "}
                        {price.missing
                          ? <span style={{ color: "var(--ink-soft)" }}>missing</span>
                          : <>
                              {money(price.finalCheckoutPrice)}
                              {price.couponDiscount > 0 && <span style={{ fontSize: 11, color: "var(--accent)", marginLeft: 4 }}>({money(price.couponDiscount)} coupon)</span>}
                              {" · "}{money(price.unitPrice)}/{price.unitPriceUnit}
                              {" · leftover "}{price.leftoverQuantity.toFixed(2)} {price.leftoverUnit}
                              <AgeBadge staleStatus={price.staleStatus} />
                            </>
                        }
                        {price.warnings?.length > 0 && <small>{price.warnings.join("; ")}</small>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
    </section>
  );
}
