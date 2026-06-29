import { useMemo, useState } from "react";
import { api, money } from "../lib/api";
import { AppItem, guessUnit, suggestItem } from "../lib/productMatch";
import { isExtraItem, parseGroceryList, SAMPLE_GROCERY_LIST } from "../lib/parseGroceryList";
import type { ParsedGroceryItem } from "../lib/parseGroceryList";
import type { PProduct, ProviderId } from "../pages/FindProductsPage";

interface ListSummary { id: string; name: string; items: any[] }

interface Props {
  provider: ProviderId;
  providerLabel: string;
  configured: boolean;
  hasStores: boolean;
  selectedStore: { locationId: string; name: string | null } | null;
  items: AppItem[];
  lists: ListSummary[];
  onChanged: () => void;
}

type GroupStatus = "idle" | "searching" | "ready" | "no_match" | "error";

interface ItemGroup {
  key: string;
  item: ParsedGroceryItem;
  queries: string[];
  status: GroupStatus;
  results: PProduct[];
  error?: string;
  selectedId?: string;
  manualTerm: string;
}

const NEW_LIST = "__new__";
const ALCOHOL_RE = /\b(vodka|whiskey|whisky|wine|beer|tequila|rum|gin|liquor|seltzer|white\s*claw|claw)\b/i;

/** The search queries for an item: its name first, then any alternatives. */
function queriesFor(item: ParsedGroceryItem): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [item.name, ...(item.alternatives ?? [])]) {
    const t = q.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Search failed";
}

export function GroceryListSearch({ provider, providerLabel, configured, hasStores, selectedStore, items, lists, onChanged }: Props) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedGroceryItem[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [cartListId, setCartListId] = useState<string>(NEW_LIST);
  const [newListName, setNewListName] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const coreCount = useMemo(() => parsed.filter((i) => !isExtraItem(i)).length, [parsed]);
  const extraCount = parsed.length - coreCount;
  const selectedCount = groups.filter((g) => g.selectedId).length;

  function updateGroup(key: string, patch: Partial<ItemGroup>) {
    setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function handleParse() {
    setError("");
    setMessage("");
    const next = parseGroceryList(text);
    setParsed(next);
    setGroups(
      next.map((item, idx) => ({
        key: `${idx}-${item.name}`,
        item,
        queries: queriesFor(item),
        status: "idle" as GroupStatus,
        results: [],
        manualTerm: ""
      }))
    );
  }

  function loadSample() {
    setText(SAMPLE_GROCERY_LIST);
    setParsed([]);
    setGroups([]);
    setMessage("");
    setError("");
  }

  function clearAll() {
    setText("");
    setParsed([]);
    setGroups([]);
    setMessage("");
    setError("");
  }

  /** Run every query for a single group, OR-ing results into one deduped set. */
  async function searchGroup(key: string, queries: string[]) {
    updateGroup(key, { status: "searching", error: undefined });
    const collected = new Map<string, PProduct>();
    let failures = 0;
    let lastError = "";
    for (const q of queries) {
      try {
        const res = await api<PProduct[]>(`/api/${provider}/products/search?term=${encodeURIComponent(q)}`);
        for (const p of res) if (!collected.has(p.externalProductId)) collected.set(p.externalProductId, p);
      } catch (e) {
        failures++;
        lastError = errMessage(e);
      }
    }
    const results = [...collected.values()];
    if (results.length) {
      updateGroup(key, { status: "ready", results, selectedId: results[0].externalProductId });
    } else if (failures >= queries.length && failures > 0) {
      updateGroup(key, { status: "error", results: [], error: lastError });
    } else {
      updateGroup(key, { status: "no_match", results: [] });
    }
  }

  /** Search every parsed item sequentially so one failure never aborts the rest. */
  async function searchAll() {
    if (!groups.length || !configured) return;
    setError("");
    setMessage("");
    setSearching(true);
    setProgress({ done: 0, total: groups.length });
    const snapshot = groups.map((g) => ({ key: g.key, queries: g.queries }));
    for (let i = 0; i < snapshot.length; i++) {
      try {
        await searchGroup(snapshot[i].key, snapshot[i].queries);
      } catch (e) {
        updateGroup(snapshot[i].key, { status: "error", error: errMessage(e) });
      }
      setProgress({ done: i + 1, total: snapshot.length });
    }
    setSearching(false);
  }

  async function manualSearch(key: string) {
    const g = groups.find((x) => x.key === key);
    if (!g || !g.manualTerm.trim()) return;
    await searchGroup(key, [g.manualTerm.trim()]);
  }

  async function addPicks() {
    const picks = groups.filter((g) => g.selectedId);
    if (!picks.length) return;
    setAdding(true);
    setError("");
    setMessage("");
    try {
      // Resolve the target list (reuse an existing one or create a fresh cart).
      let listId = cartListId;
      let listName = lists.find((l) => l.id === cartListId)?.name ?? "";
      if (!listId || listId === NEW_LIST) {
        const name = newListName.trim() || "Find Products picks";
        const created = await api<{ id: string; name: string }>("/api/lists", {
          method: "POST",
          body: JSON.stringify({ name })
        });
        listId = created.id;
        listName = created.name;
      }

      let added = 0;
      const failures: string[] = [];
      for (const g of picks) {
        const product = g.results.find((r) => r.externalProductId === g.selectedId);
        if (!product) continue;
        try {
          // Reuse the existing import path: attach the product as a price under a
          // comparable item (linking to an existing one, else creating a generic one).
          const match = suggestItem(product.title, items);
          const body = match
            ? { productId: product.externalProductId, groceryItemId: match.id }
            : {
                productId: product.externalProductId,
                newItem: { name: g.item.name, category: g.item.category || "Grocery", unitType: guessUnit(product.size) }
              };
          const imported = await api<{ item: AppItem }>(`/api/${provider}/import`, {
            method: "POST",
            body: JSON.stringify(body)
          });
          // …then add that item to the running list/cart.
          await api(`/api/lists/${listId}/items`, {
            method: "POST",
            body: JSON.stringify({ groceryItemId: imported.item.id, quantityNeeded: 1, unitType: imported.item.unitType || "each" })
          });
          added++;
        } catch (e) {
          failures.push(`${g.item.name}: ${errMessage(e)}`);
        }
      }

      setCartListId(listId);
      setNewListName("");
      const base = `Added ${added} pick${added === 1 ? "" : "s"} to "${listName}".`;
      setMessage(failures.length ? `${base} ${failures.length} could not be added.` : base);
      if (failures.length) setError(failures.join(" · "));
      onChanged();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setAdding(false);
    }
  }

  const needsStoreHint = hasStores && !selectedStore;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div>
        <h2 style={{ margin: 0 }}>Paste a grocery list</h2>
        <p style={{ margin: "4px 0 0" }}>
          Paste a free-text list, parse it into items, then search <strong style={{ color: "var(--ink)" }}>{providerLabel}</strong> for
          each one. Review the matches grouped by item, pick the best, and add your picks to a list.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Chicken thighs or chicken breast, 4-5 lb\nEggs, 18 count\nSpinach\n…"}
        rows={6}
        style={{ width: "100%", marginTop: 12, resize: "vertical", fontFamily: "inherit", fontSize: 14, padding: 10 }}
      />

      <div className="action-row" style={{ marginTop: 10 }}>
        <button type="button" onClick={handleParse} disabled={!text.trim()}>Parse list</button>
        <button type="button" className="secondary" onClick={loadSample}>Load sample (30 items)</button>
        {(text || parsed.length > 0) && <button type="button" className="secondary" onClick={clearAll}>Clear</button>}
        <button type="button" onClick={searchAll} disabled={!groups.length || searching || !configured}>
          {searching ? `Searching… ${progress?.done ?? 0}/${progress?.total ?? 0}` : `Search ${providerLabel}`}
        </button>
      </div>

      {parsed.length > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>
          Parsed <strong style={{ color: "var(--ink)" }}>{coreCount}</strong> core item{coreCount === 1 ? "" : "s"}
          {extraCount > 0 && <> + <strong style={{ color: "var(--ink)" }}>{extraCount}</strong> drinks/extras (separate)</>}.
        </p>
      )}

      {provider === "kroger" && !configured && (
        <div className="system-alert" style={{ marginTop: 12 }}>
          <strong>Fry's search runs through the Kroger provider, which isn't configured.</strong>
          <span>Fry's Food Stores is a Kroger banner — add Kroger API keys under <strong>Settings → API Keys</strong> and pick a Fry's store to search Fry's. Manual entry still works.</span>
        </div>
      )}
      {provider !== "kroger" && !configured && (
        <div className="system-alert" style={{ marginTop: 12 }}>
          <strong>{providerLabel} is not configured.</strong>
          <span>Add API keys under <strong>Settings → API Keys</strong> to enable live search.</span>
        </div>
      )}
      {configured && needsStoreHint && (
        <p className="warn" style={{ marginTop: 10, fontSize: 13 }}>
          No store selected yet — pick one above for local prices and to add picks to your list.
        </p>
      )}

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      {message && <p className="warn badge-pulse" style={{ marginTop: 10 }}>{message}</p>}

      {/* Cart controls: where picked items land */}
      {groups.some((g) => g.status === "ready") && (
        <div className="toolbar" style={{ marginTop: 14, alignItems: "end" }}>
          <label className="field" style={{ minWidth: 200 }}>
            <span>Add picks to</span>
            <select value={cartListId} onChange={(e) => setCartListId(e.target.value)}>
              <option value={NEW_LIST}>➕ New list…</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.items?.length ?? 0})</option>)}
            </select>
          </label>
          {(!cartListId || cartListId === NEW_LIST) && (
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              <span>New list name</span>
              <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Find Products picks" />
            </label>
          )}
          <button type="button" onClick={addPicks} disabled={!selectedCount || adding}>
            {adding ? "Adding…" : `Add ${selectedCount} pick${selectedCount === 1 ? "" : "s"} to list`}
          </button>
        </div>
      )}

      {/* Grouped results, one block per grocery item */}
      {groups.map((g) => (
        <ItemGroupBlock
          key={g.key}
          group={g}
          providerLabel={providerLabel}
          hasStores={hasStores}
          selectedStore={selectedStore}
          onSelect={(id) => updateGroup(g.key, { selectedId: id })}
          onManualTerm={(t) => updateGroup(g.key, { manualTerm: t })}
          onManualSearch={() => manualSearch(g.key)}
        />
      ))}
    </div>
  );
}

interface BlockProps {
  group: ItemGroup;
  providerLabel: string;
  hasStores: boolean;
  selectedStore: { locationId: string; name: string | null } | null;
  onSelect: (id: string) => void;
  onManualTerm: (t: string) => void;
  onManualSearch: () => void;
}

function ItemGroupBlock({ group, providerLabel, hasStores, selectedStore, onSelect, onManualTerm, onManualSearch }: BlockProps) {
  const { item, status, results } = group;
  const restricted = ALCOHOL_RE.test(item.name);

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line, rgba(255,255,255,0.08))", paddingTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>
          {item.name}
          {item.quantity && <span style={{ color: "var(--ink-soft)", fontWeight: 500, fontSize: 13 }}> · {item.quantity}</span>}
        </h3>
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
          {status === "searching" && "Searching…"}
          {status === "ready" && `${results.length} match${results.length === 1 ? "" : "es"}`}
          {status === "idle" && "Not searched yet"}
        </span>
      </div>
      {(item.alternatives?.length || item.notes) && (
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--ink-soft)" }}>
          {item.alternatives?.length ? <>or {item.alternatives.join(", ")}</> : null}
          {item.alternatives?.length && item.notes ? " · " : null}
          {item.notes ? <em>{item.notes}</em> : null}
        </p>
      )}

      {status === "searching" && (
        <div className="kroger-grid" aria-hidden="true" style={{ marginTop: 10 }}>
          {[0, 1, 2].map((i) => <article key={i} className="skeleton skeleton-card" style={{ height: 140 }} />)}
        </div>
      )}

      {status === "error" && (
        <p className="error" style={{ marginTop: 10, fontSize: 13 }}>Couldn't search this item: {group.error}</p>
      )}

      {(status === "no_match" || status === "error") && (
        <div className="toolbar" style={{ marginTop: 10 }}>
          <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            {status === "no_match"
              ? restricted
                ? "No match found — may be age-restricted or not carried at this store."
                : "No match found."
              : null}
          </span>
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span>Search manually for this item</span>
            <input
              value={group.manualTerm}
              onChange={(e) => onManualTerm(e.target.value)}
              placeholder={`Try another term for "${item.name}"`}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onManualSearch(); } }}
            />
          </label>
          <button type="button" className="secondary" disabled={!group.manualTerm.trim()} onClick={onManualSearch}>Search</button>
        </div>
      )}

      {status === "ready" && results.length > 0 && (
        <div className="kroger-grid" style={{ marginTop: 10 }}>
          {results.map((p) => {
            const picked = group.selectedId === p.externalProductId;
            return (
              <article
                key={p.externalProductId}
                className="kroger-card"
                style={picked ? { outline: "2px solid var(--accent)", outlineOffset: 2 } : undefined}
              >
                <div className="kroger-thumb">
                  {p.imageUrl ? <img src={p.imageUrl} alt={p.title} loading="lazy" /> : <span>No image</span>}
                </div>
                <div className="kroger-info">
                  <strong>{p.title}</strong>
                  <span className="kroger-meta">
                    {[providerLabel, p.storeName, p.brand, p.size].filter(Boolean).join(" · ") || "—"}
                  </span>
                  <div className="kroger-price">
                    {p.price != null ? (
                      <>
                        <b>{money(p.promoPrice ?? p.price)}</b>
                        {p.promoPrice != null && p.regularPrice != null && <span className="kroger-was">{money(p.regularPrice)}</span>}
                        {p.unitPrice != null && <span className="kroger-unit">{money(p.unitPrice)}/unit</span>}
                      </>
                    ) : (
                      <span style={{ color: "var(--ink-soft)" }}>
                        Price unavailable{hasStores && !selectedStore ? " (select a store)" : ""}
                      </span>
                    )}
                  </div>
                  <div className="kroger-badges">
                    {p.couponEligible && <span className="source-badge promo">Deal</span>}
                    {p.fulfillmentType === "store" && <span className="source-badge promo">Local pickup</span>}
                    {p.fulfillmentType === "warehouse" && <span className="source-badge stale">Ships</span>}
                    {p.fulfillmentType === "marketplace" && <span className="source-badge stale">Marketplace</span>}
                    {!p.available && <span className="source-badge stale">Out of stock</span>}
                    {p.productUrl && (
                      <a href={p.productUrl} target="_blank" rel="noreferrer" className="source-badge" style={{ textDecoration: "none" }}>
                        View ↗
                      </a>
                    )}
                  </div>
                  <button type="button" className={picked ? "" : "secondary"} onClick={() => onSelect(p.externalProductId)}>
                    {picked ? "✓ Selected" : "Select"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
