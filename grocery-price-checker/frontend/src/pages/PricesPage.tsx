import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { confidenceLevels, Input, Select, Textarea, units } from "../components/FormFields";
import { api, dateOnly, money } from "../lib/api";

type UnitType = typeof units[number];

const unitBase: Record<UnitType, { unit: UnitType; factor: number }> = {
  each: { unit: "each", factor: 1 },
  count: { unit: "count", factor: 1 },
  pack: { unit: "count", factor: 1 },
  case: { unit: "count", factor: 1 },
  lb: { unit: "oz", factor: 16 },
  oz: { unit: "oz", factor: 1 },
  gallon: { unit: "fl_oz", factor: 128 },
  quart: { unit: "fl_oz", factor: 32 },
  pint: { unit: "fl_oz", factor: 16 },
  fl_oz: { unit: "fl_oz", factor: 1 }
};

function unitsCompatible(a: UnitType, b: UnitType) {
  return unitBase[a]?.unit === unitBase[b]?.unit;
}

function quantityAsUnit(quantity: number, fromUnit: UnitType, toUnit: UnitType) {
  if (!unitsCompatible(fromUnit, toUnit)) return null;
  return (quantity * unitBase[fromUnit].factor) / unitBase[toUnit].factor;
}

function equivalentUnitPrice(price: any, item: any) {
  const packageUnit = price.packageUnit as UnitType;
  const itemUnit = item?.unitType as UnitType | undefined;
  const packageQuantity = Number(price.packageQuantity);
  const amount = Number(price.price);
  if (!amount || !packageQuantity || !packageUnit) return "-";
  const targetUnit = itemUnit && unitsCompatible(packageUnit, itemUnit) ? itemUnit : unitBase[packageUnit]?.unit;
  if (!targetUnit) return "-";
  const targetQuantity = quantityAsUnit(packageQuantity, packageUnit, targetUnit);
  if (!targetQuantity) return "-";
  return `${money(amount / targetQuantity)}/${targetUnit}`;
}

export function PricesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [editingPriceId, setEditingPriceId] = useState("");
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => Promise.all([api<any[]>("/api/items"), api<any[]>("/api/stores"), api<any[]>("/api/prices")]).then(([i, s, p]) => {
    setItems(i);
    setStores(s);
    setPrices(p);
    if (!selectedItemId && i[0]) setSelectedItemId(i[0].id);
  });
  useEffect(() => { void load(); }, []);

  const sortedItems = useMemo(() => [...items].sort((a, b) => `${a.category} ${a.name}`.localeCompare(`${b.category} ${b.name}`)), [items]);
  const sortedStores = useMemo(() => [...stores].sort((a, b) => a.name.localeCompare(b.name)), [stores]);
  const selectedItem = items.find((item) => item.id === selectedItemId);
  const groupedPrices = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = prices.filter((price) => {
      const text = [
        price.groceryItem?.name,
        price.groceryItem?.category,
        price.store?.name,
        price.brand,
        price.notes
      ].filter(Boolean).join(" ").toLowerCase();
      return (!term || text.includes(term)) && (storeFilter === "all" || price.storeId === storeFilter);
    });
    const groups = new Map<string, { item: any; prices: any[] }>();
    for (const price of filtered) {
      const key = price.groceryItemId;
      const existing = groups.get(key) ?? { item: price.groceryItem, prices: [] };
      existing.prices.push(price);
      groups.set(key, existing);
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        prices: group.prices.sort((a, b) => a.store?.name.localeCompare(b.store?.name) || Number(a.price) - Number(b.price))
      }))
      .sort((a, b) => `${a.item?.category ?? ""} ${a.item?.name ?? ""}`.localeCompare(`${b.item?.category ?? ""} ${b.item?.name ?? ""}`));
  }, [prices, search, storeFilter]);

  function cleanPricePayload(data: Record<string, FormDataEntryValue>) {
    const payload: Record<string, unknown> = {
      ...data,
      price: Number(data.price),
      packageQuantity: Number(data.packageQuantity),
      salePrice: data.salePrice === "on",
      couponApplied: data.couponApplied === "on",
      taxApplicable: data.taxApplicable === "on"
    };
    if (payload.expiresAt === "") payload.expiresAt = null;
    for (const key of ["brand", "couponDetails", "notes", "recordedAt"]) {
      if (payload[key] === "") delete payload[key];
    }
    return payload;
  }

  function dateInput(value: string | Date | null | undefined) {
    if (!value) return "";
    return new Date(value).toISOString().slice(0, 10);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      const payloads = sortedStores.flatMap((store) => {
        const price = data[`price:${store.id}`];
        if (price === "" || price == null) return [];
        return [{
          groceryItemId: data.groceryItemId,
          storeId: store.id,
          price,
          packageQuantity: data[`packageQuantity:${store.id}`],
          packageUnit: data[`packageUnit:${store.id}`],
          brand: data[`brand:${store.id}`],
          salePrice: data[`salePrice:${store.id}`],
          couponApplied: data[`couponApplied:${store.id}`],
          taxApplicable: data[`taxApplicable:${store.id}`],
          confidence: data.confidence,
          recordedAt: data.recordedAt,
          expiresAt: data.expiresAt,
          notes: data.notes
        }];
      });
      if (!payloads.length) throw new Error("Enter a price for at least one store.");
      await Promise.all(payloads.map((payload) => api("/api/prices", { method: "POST", body: JSON.stringify(cleanPricePayload(payload)) })));
      setMessage(`${payloads.length} ${payloads.length === 1 ? "price" : "prices"} added.`);
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add price");
    }
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await api<any>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          quantityNeeded: Number(data.quantityNeeded),
          commonlyUsed: data.commonlyUsed === "on"
        })
      });
      setSelectedItemId(result.item.id);
      setMessage(result.duplicateWarnings?.length ? `Item added. Similar existing items: ${result.duplicateWarnings.join(", ")}` : "Item added and selected.");
      setShowNewItemForm(false);
      form.reset();
      await load();
      setSelectedItemId(result.item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add item");
    }
  }

  async function updatePrice(event: FormEvent<HTMLFormElement>, priceId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api(`/api/prices/${priceId}`, { method: "PATCH", body: JSON.stringify(cleanPricePayload(data)) });
      setMessage("Price updated.");
      setEditingPriceId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update price");
    }
  }

  async function deletePrice(priceId: string) {
    if (!confirm("Remove this price entry from active comparisons?")) return;
    setError("");
    try {
      await api(`/api/prices/${priceId}`, { method: "DELETE" });
      setMessage("Price removed from active comparisons.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove price");
    }
  }

  return (
    <section>
      <h1>Price Entry</h1>
      <div className="toolbar page-actions">
        <button type="button" onClick={() => setShowNewItemForm((value) => !value)}>{showNewItemForm ? "Close new item" : "Add new item"}</button>
      </div>
      {showNewItemForm && (
        <form className="grid-form compact" onSubmit={createItem}>
          <Input label="Item name" name="name" placeholder="Breakfast Sausage" required />
          <Input label="Category" name="category" placeholder="meat, dairy, produce" required />
          <Input label="Quantity needed" name="quantityNeeded" type="number" step="0.01" defaultValue="1" required />
          <Select label="Unit" name="unitType" options={units} />
          <Input label="Preferred brand" name="preferredBrand" />
          <Input label="UPC / barcode" name="upc" />
          <Textarea label="Notes" name="notes" />
          <label className="check"><input name="commonlyUsed" type="checkbox" /> Commonly used</label>
          <div className="action-row">
            <button>Add item and select it</button>
            <button className="secondary" type="button" onClick={() => setShowNewItemForm(false)}>Cancel</button>
          </div>
        </form>
      )}
      <form className="grid-form price-batch-form" onSubmit={submit}>
        <label className="field"><span>Item</span><select name="groceryItemId" value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>{sortedItems.map((item) => <option key={item.id} value={item.id}>{item.category ? `${item.category} - ` : ""}{item.name}</option>)}</select></label>
        <Select label="Confidence" name="confidence" options={confidenceLevels} />
        <Input label="Recorded at" name="recordedAt" type="date" />
        <Input label="Expiration date" name="expiresAt" type="date" />
        <Textarea label="Coupon details / notes" name="notes" />
        <div className="wide table-wrap">
          <table key={selectedItemId} className="entry-grid"><thead><tr><th>Store</th><th>Price</th><th>Package qty</th><th>Unit</th><th>Brand</th><th>Flags</th></tr></thead><tbody>
            {sortedStores.map((store) => (
              <tr key={store.id}>
                <td><strong>{store.name}</strong><small>{store.storeType}</small></td>
                <td><input aria-label={`${store.name} price`} name={`price:${store.id}`} type="number" step="0.01" placeholder="-" /></td>
                <td><input aria-label={`${store.name} package quantity`} name={`packageQuantity:${store.id}`} type="number" step="0.01" defaultValue={selectedItem?.quantityNeeded ?? 1} /></td>
                <td><select aria-label={`${store.name} package unit`} name={`packageUnit:${store.id}`} defaultValue={selectedItem?.unitType ?? "each"}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></td>
                <td><input aria-label={`${store.name} brand`} name={`brand:${store.id}`} placeholder="Optional" /></td>
                <td className="flag-stack">
                  <label className="check"><input name={`salePrice:${store.id}`} type="checkbox" /> Sale</label>
                  <label className="check"><input name={`couponApplied:${store.id}`} type="checkbox" /> Coupon</label>
                  <label className="check"><input name={`taxApplicable:${store.id}`} type="checkbox" /> Tax</label>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <button>Add prices for item</button>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="warn">{message}</p>}
      <div className="panel">
        <h2>Saved prices grouped by item</h2>
        <div className="toolbar">
          <Input label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item, category, store, brand" />
          <label className="field"><span>Store</span><select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}>
            <option value="all">All stores</option>
            {sortedStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select></label>
        </div>
      </div>
      <table><thead><tr><th>Store</th><th>Price</th><th>Package</th><th>Equivalent unit price</th><th>Brand</th><th>Recorded</th><th>Expires</th><th>Confidence</th><th>Actions</th></tr></thead><tbody>
        {groupedPrices.map((group) => (
          <Fragment key={group.item?.id ?? "unknown-item"}>
            <tr key={`${group.item?.id}-group`} className="group-row"><td colSpan={9}>{group.item?.name ?? "Unknown item"}<small>{group.item?.category ?? "Uncategorized"} · comparing as {group.item?.unitType ?? "entered"} · {group.prices.length} saved {group.prices.length === 1 ? "price" : "prices"}</small></td></tr>
            {group.prices.map((price) => editingPriceId === price.id ? (
              <tr key={price.id}>
                <td colSpan={9}>
                  <form className="inline-edit" onSubmit={(event) => updatePrice(event, price.id)}>
                    <label className="field"><span>Item</span><select name="groceryItemId" defaultValue={price.groceryItemId}>{sortedItems.map((item) => <option key={item.id} value={item.id}>{item.category ? `${item.category} - ` : ""}{item.name}</option>)}</select></label>
                    <label className="field"><span>Store</span><select name="storeId" defaultValue={price.storeId}>{sortedStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
                    <Input label="Price" name="price" type="number" step="0.01" defaultValue={price.price} required />
                    <Input label="Size / quantity sold" name="packageQuantity" type="number" step="0.01" defaultValue={price.packageQuantity} required />
                    <Select label="Package unit" name="packageUnit" options={units} defaultValue={price.packageUnit} />
                    <Input label="Brand" name="brand" defaultValue={price.brand ?? ""} />
                    <Select label="Confidence" name="confidence" options={confidenceLevels} defaultValue={price.confidence} />
                    <Input label="Recorded at" name="recordedAt" type="date" defaultValue={dateInput(price.recordedAt)} />
                    <Input label="Expiration date" name="expiresAt" type="date" defaultValue={dateInput(price.expiresAt)} />
                    <label className="check"><input name="salePrice" type="checkbox" defaultChecked={price.salePrice} /> Sale price</label>
                    <label className="check"><input name="couponApplied" type="checkbox" defaultChecked={price.couponApplied} /> Coupon applied</label>
                    <label className="check"><input name="taxApplicable" type="checkbox" defaultChecked={price.taxApplicable} /> Tax applies</label>
                    <Textarea label="Coupon details / notes" name="notes" defaultValue={price.notes ?? ""} />
                    <div className="action-row">
                      <button>Save</button>
                      <button className="secondary" type="button" onClick={() => setEditingPriceId("")}>Cancel</button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={price.id}>
                <td>{price.store?.name}</td>
                <td>{money(price.price)}</td>
                <td>{price.packageQuantity} {price.packageUnit}</td>
                <td>{equivalentUnitPrice(price, group.item)}</td>
                <td>{price.brand || "-"}</td>
                <td>{dateOnly(price.recordedAt)}</td>
                <td>{dateOnly(price.expiresAt)}</td>
                <td>{price.confidence}</td>
                <td className="action-row">
                  <button type="button" onClick={() => setEditingPriceId(price.id)}>Edit</button>
                  <button className="danger" type="button" onClick={() => deletePrice(price.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody></table>
    </section>
  );
}
