import { FormEvent, useEffect, useState } from "react";
import { Input, Select, Textarea, units } from "../components/FormFields";
import { api } from "../lib/api";

export function ListsPage() {
  const [lists, setLists] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [editingListItemId, setEditingListItemId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => Promise.all([api<any[]>("/api/lists"), api<any[]>("/api/items")]).then(([l, i]) => {
    setLists(l);
    setItems(i);
    if (!selected && l[0]) setSelected(l[0].id);
    if (!selectedItemId && i[0]) setSelectedItemId(i[0].id);
  });
  useEffect(() => { load(); }, []);
  const current = lists.find((list) => list.id === selected);
  const selectedItem = items.find((item) => item.id === selectedItemId);

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/lists", { method: "POST", body: JSON.stringify(data) });
      setMessage("List created.");
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create list");
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api(`/api/lists/${selected}/items`, { method: "POST", body: JSON.stringify({ ...data, quantityNeeded: Number(data.quantityNeeded) }) });
      setMessage("Item added to list.");
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item to list");
    }
  }

  async function updateListItem(event: FormEvent<HTMLFormElement>, listItemId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api(`/api/lists/${selected}/items/${listItemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          quantityNeeded: Number(data.quantityNeeded),
          unitType: data.unitType,
          checkedOff: data.checkedOff === "on"
        })
      });
      setMessage("List item updated.");
      setEditingListItemId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update list item");
    }
  }

  async function toggleCheckedOff(listItemId: string, current: boolean) {
    try {
      await api(`/api/lists/${selected}/items/${listItemId}`, {
        method: "PATCH",
        body: JSON.stringify({ checkedOff: !current })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update list item");
    }
  }

  async function deleteListItem(listItemId: string) {
    if (!confirm("Remove this item from the grocery list?")) return;
    setError("");
    try {
      await api(`/api/lists/${selected}/items/${listItemId}`, { method: "DELETE" });
      setMessage("Item removed from list.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove list item");
    }
  }

  async function archiveList() {
    if (!current) return;
    const action = current.isActive ? "archive" : "restore";
    if (!confirm(`${action === "archive" ? "Archive" : "Restore"} "${current.name}"?`)) return;
    try {
      await api(`/api/lists/${selected}`, { method: "PATCH", body: JSON.stringify({ isActive: !current.isActive }) });
      setMessage(`List ${action}d.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update list");
    }
  }

  const checkedCount = current?.items.filter((i: any) => i.checkedOff).length ?? 0;
  const totalCount = current?.items.length ?? 0;
  const progressPct = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;

  return (
    <section>
      <h1>Grocery Lists</h1>
      <form className="grid-form compact" onSubmit={createList}>
        <Input label="List name" name="name" placeholder="Weekly groceries" required />
        <Textarea label="Notes" name="notes" />
        <button>Create list</button>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="warn">{message}</p>}
      <div className="toolbar">
        <label className="field" style={{ flex: 1 }}><span>Selected list</span>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {lists.map((list) => <option key={list.id} value={list.id}>{list.name}{!list.isActive ? " (archived)" : ""}</option>)}
          </select>
        </label>
        {current && (
          <button className="secondary" type="button" style={{ marginTop: 22 }} onClick={archiveList}>
            {current.isActive ? "Archive" : "Restore"}
          </button>
        )}
      </div>
      {current && <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{current.name}{!current.isActive && <span style={{ marginLeft: 8, fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>Archived</span>}</h2>
          {totalCount > 0 && (
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
              {checkedCount}/{totalCount} items
              <span style={{ marginLeft: 8, display: "inline-block", width: 80, height: 6, background: "var(--line)", borderRadius: 3, verticalAlign: "middle" }}>
                <span style={{ display: "block", width: `${progressPct}%`, height: "100%", background: "var(--accent)", borderRadius: 3, transition: "width 0.3s" }} />
              </span>
              <span style={{ marginLeft: 6, color: progressPct === 100 ? "var(--accent)" : "var(--ink-soft)" }}>{progressPct}%</span>
            </span>
          )}
        </div>
        {current.isActive && (
          <form className="grid-form compact" onSubmit={addItem}>
            <label className="field"><span>Item</span>
              <select name="groceryItemId" value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
                {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <Input key={`${selectedItemId}-quantity`} label="Quantity" name="quantityNeeded" type="number" step="0.01" defaultValue={selectedItem?.quantityNeeded ?? 1} />
            <Select key={`${selectedItemId}-unit`} label="Unit" name="unitType" options={units} defaultValue={selectedItem?.unitType ?? "each"} />
            <button>Add to list</button>
          </form>
        )}
        <table><thead><tr><th>Item</th><th>Quantity</th><th>Got it?</th><th>Actions</th></tr></thead><tbody>
          {current.items.map((item: any) => editingListItemId === item.id ? (
            <tr key={item.id}>
              <td>{item.groceryItem.name}</td>
              <td colSpan={3}>
                <form className="inline-edit" onSubmit={(event) => updateListItem(event, item.id)}>
                  <Input label="Quantity" name="quantityNeeded" type="number" step="0.01" defaultValue={item.quantityNeeded} required />
                  <Select label="Unit" name="unitType" options={units} defaultValue={item.unitType} />
                  <label className="check"><input name="checkedOff" type="checkbox" defaultChecked={item.checkedOff} /> Purchased</label>
                  <div className="action-row">
                    <button>Save</button>
                    <button className="secondary" type="button" onClick={() => setEditingListItemId("")}>Cancel</button>
                  </div>
                </form>
              </td>
            </tr>
          ) : (
            <tr key={item.id} style={item.checkedOff ? { opacity: 0.55, textDecoration: "line-through" } : {}}>
              <td>{item.groceryItem.name}</td>
              <td>{item.quantityNeeded} {item.unitType}</td>
              <td>
                <button
                  type="button"
                  className={item.checkedOff ? "secondary" : ""}
                  style={{ padding: "4px 10px", fontSize: 16 }}
                  onClick={() => toggleCheckedOff(item.id, item.checkedOff)}
                  title={item.checkedOff ? "Mark as needed" : "Mark as purchased"}
                >
                  {item.checkedOff ? "✓" : "○"}
                </button>
              </td>
              <td className="action-row">
                <button type="button" onClick={() => setEditingListItemId(item.id)}>Edit</button>
                <button className="danger" type="button" onClick={() => deleteListItem(item.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>}
    </section>
  );
}
