import { FormEvent, useEffect, useState } from "react";
import { Input, Select, Textarea, units } from "../components/FormFields";
import { api } from "../lib/api";

function SourceBadge({ source }: { source?: string }) {
  const label = source === "kroger" ? "Kroger" : source === "walmart" ? "Walmart" : "Manual";
  const cls = source === "kroger" || source === "walmart" ? source : "manual";
  return <span className={`source-badge ${cls}`}>{label}</span>;
}

export function ItemsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [mergeSource, setMergeSource] = useState<any | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const [weightItem, setWeightItem] = useState<any | null>(null);
  const [weightQty, setWeightQty] = useState("");
  const [weightUnit, setWeightUnit] = useState("lb");
  const [minQty, setMinQty] = useState("");
  const [minUnit, setMinUnit] = useState("lb");
  const [savingWeight, setSavingWeight] = useState(false);
  const load = () => api<any[]>("/api/items").then(setItems);
  useEffect(() => { void load(); }, []);

  function openWeight(item: any) {
    setWeightItem(item);
    setWeightQty(item.eachEquivQuantity != null ? String(item.eachEquivQuantity) : "");
    setWeightUnit(item.eachEquivUnit ?? "lb");
    setMinQty(item.minPurchaseQuantity != null ? String(item.minPurchaseQuantity) : "");
    setMinUnit(item.minPurchaseUnit ?? "lb");
    setError("");
  }

  async function saveWeight() {
    if (!weightItem) return;
    setSavingWeight(true);
    setError("");
    try {
      const eqQty = weightQty.trim() ? Number(weightQty) : null;
      const mnQty = minQty.trim() ? Number(minQty) : null;
      await api(`/api/items/${weightItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          eachEquivQuantity: eqQty,
          eachEquivUnit: eqQty ? weightUnit : null,
          minPurchaseQuantity: mnQty,
          minPurchaseUnit: mnQty ? minUnit : null
        })
      });
      setWarning(`Saved sizing for "${weightItem.name}".`);
      setWeightItem(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save sizing");
    } finally {
      setSavingWeight(false);
    }
  }

  async function confirmMerge() {
    if (!mergeSource || !mergeTargetId) return;
    setError("");
    setMerging(true);
    try {
      const res = await api<any>(`/api/items/${mergeSource.id}/merge`, { method: "POST", body: JSON.stringify({ targetItemId: mergeTargetId }) });
      setWarning(`Merged "${mergeSource.name}" into "${res.target?.name}" (${res.movedPrices} price${res.movedPrices === 1 ? "" : "s"} moved).`);
      setMergeSource(null);
      setMergeTargetId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not merge items");
    } finally {
      setMerging(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api<any>("/api/items", { method: "POST", body: JSON.stringify({ ...data, quantityNeeded: Number(data.quantityNeeded), commonlyUsed: data.commonlyUsed === "on" }) });
      setWarning(result.duplicateWarnings?.length ? `Similar items: ${result.duplicateWarnings.join(", ")}` : "Item added.");
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item");
    }
  }

  return (
    <section>
      <h1>Items</h1>
      <form className="grid-form" onSubmit={submit}>
        <Input label="Item name" name="name" required />
        <Input label="Category" name="category" required />
        <Input label="Quantity needed" name="quantityNeeded" type="number" step="0.01" defaultValue="1" required />
        <Select label="Unit" name="unitType" options={units} />
        <Input label="Preferred brand" name="preferredBrand" />
        <Input label="UPC / barcode" name="upc" />
        <Textarea label="Notes" name="notes" />
        <label className="check"><input name="commonlyUsed" type="checkbox" /> Commonly used</label>
        <button>Add item</button>
      </form>
      {error && <p className="error">{error}</p>}
      {warning && <p className="warn">{warning}</p>}
      <table><thead><tr><th>Name</th><th>Category</th><th>Need</th><th>~ per each</th><th>Brand</th><th>Source</th><th>Active</th><th>Actions</th></tr></thead><tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.category}</td>
            <td>{item.quantityNeeded} {item.unitType}</td>
            <td>{item.eachEquivQuantity != null ? `${item.eachEquivQuantity} ${item.eachEquivUnit}` : "-"}</td>
            <td>{item.preferredBrand || "-"}</td>
            <td><SourceBadge source={item.source} /></td>
            <td>{String(item.isActive)}</td>
            <td className="action-row">
              <button className="secondary" type="button" onClick={() => openWeight(item)}>⚖ Sizing</button>
              <button className="secondary" type="button" onClick={() => { setMergeSource(item); setMergeTargetId(""); }}>Merge into…</button>
            </td>
          </tr>
        ))}
      </tbody></table>

      {weightItem && (
        <div className="modal-backdrop" onClick={() => !savingWeight && setWeightItem(null)}>
          <div className="modal-card panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Sizing · {weightItem.name}</h2>

            <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Approx weight per each</p>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-soft)" }}>
              How much one weighs, so prices sold "each" compare against per-pound/ounce prices (e.g. 1 apple ≈ 0.4 lb). Leave blank to clear.
            </p>
            <div className="toolbar" style={{ margin: "0 0 18px" }}>
              <label className="field" style={{ minWidth: 120 }}>
                <span>1 each ≈</span>
                <input type="number" step="0.01" value={weightQty} onChange={(e) => setWeightQty(e.target.value)} placeholder="0.4" />
              </label>
              <label className="field" style={{ minWidth: 100 }}>
                <span>Unit</span>
                <select value={weightUnit} onChange={(e) => setWeightUnit(e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              </label>
            </div>

            <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600 }}>Minimum purchase (whole cuts)</p>
            <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-soft)" }}>
              For items sold only as a whole piece by weight (e.g. brisket ~6 lb). Comparisons will cost the whole cut, not a per-pound sliver. Leave blank if it's sold by any amount.
            </p>
            <div className="toolbar" style={{ margin: 0 }}>
              <label className="field" style={{ minWidth: 120 }}>
                <span>Sold in min. of</span>
                <input type="number" step="0.01" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="6" />
              </label>
              <label className="field" style={{ minWidth: 100 }}>
                <span>Unit</span>
                <select value={minUnit} onChange={(e) => setMinUnit(e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
              </label>
            </div>

            <div className="action-row" style={{ marginTop: 18 }}>
              <button type="button" onClick={saveWeight} disabled={savingWeight}>{savingWeight ? "Saving…" : "Save"}</button>
              <button type="button" className="secondary" onClick={() => setWeightItem(null)} disabled={savingWeight}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {mergeSource && (
        <div className="modal-backdrop" onClick={() => !merging && setMergeSource(null)}>
          <div className="modal-card panel" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Merge item</h2>
            <p style={{ margin: "0 0 14px", fontSize: 14 }}>
              Move all prices and list entries from <strong style={{ color: "var(--ink)" }}>{mergeSource.name}</strong> into another item, then delete it. Useful for consolidating imported products like "Fry's Whole Milk" under a generic "Whole Milk".
            </p>
            <label className="field">
              <span>Merge into</span>
              <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                <option value="">Select target item…</option>
                {items.filter((i) => i.id !== mergeSource.id).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.category})</option>)}
              </select>
            </label>
            <div className="action-row" style={{ marginTop: 16 }}>
              <button type="button" onClick={confirmMerge} disabled={merging || !mergeTargetId}>{merging ? "Merging…" : "Merge"}</button>
              <button type="button" className="secondary" onClick={() => setMergeSource(null)} disabled={merging}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
