import { FormEvent, useEffect, useState } from "react";
import { Input, Select, Textarea, units } from "../components/FormFields";
import { api } from "../lib/api";

export function ItemsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const load = () => api<any[]>("/api/items").then(setItems);
  useEffect(() => { void load(); }, []);

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
      <table><thead><tr><th>Name</th><th>Category</th><th>Need</th><th>Brand</th><th>Active</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.category}</td><td>{item.quantityNeeded} {item.unitType}</td><td>{item.preferredBrand || "-"}</td><td>{String(item.isActive)}</td></tr>)}
      </tbody></table>
    </section>
  );
}
