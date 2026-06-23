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
  const load = () => api<any[]>("/api/items").then(setItems);
  useEffect(() => { void load(); }, []);

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
      <table><thead><tr><th>Name</th><th>Category</th><th>Need</th><th>Brand</th><th>Source</th><th>Active</th><th>Actions</th></tr></thead><tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{item.name}</td>
            <td>{item.category}</td>
            <td>{item.quantityNeeded} {item.unitType}</td>
            <td>{item.preferredBrand || "-"}</td>
            <td><SourceBadge source={item.source} /></td>
            <td>{String(item.isActive)}</td>
            <td><button className="secondary" type="button" onClick={() => { setMergeSource(item); setMergeTargetId(""); }}>Merge into…</button></td>
          </tr>
        ))}
      </tbody></table>

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
