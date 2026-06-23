import { FormEvent, useEffect, useState } from "react";
import { Input, Textarea } from "../components/FormFields";
import { api } from "../lib/api";

export function StoresPage() {
  const [stores, setStores] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => api<any[]>("/api/stores").then(setStores);
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/stores", { method: "POST", body: JSON.stringify({ ...data, membershipRequired: data.membershipRequired === "on", favorite: data.favorite === "on" }) });
      setMessage("Store added.");
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add store");
    }
  }

  async function remove(store: any) {
    setError("");
    setMessage("");
    if (!window.confirm(`Remove "${store.name}"? This cannot be undone.`)) return;
    try {
      await api(`/api/stores/${store.id}`, { method: "DELETE" });
      setMessage("Store removed.");
      await load();
    } catch (err) {
      // Backend returns 409 when the store is referenced by price history.
      // Offer to archive (soft-delete) it instead so price records stay intact.
      const msg = err instanceof Error ? err.message : "Could not remove store";
      if (/price history/i.test(msg)) {
        if (window.confirm(`"${store.name}" has saved prices, so it can't be deleted outright. Hide it from your stores list instead? (Price history is kept.)`)) {
          try {
            await api(`/api/stores/${store.id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
            setMessage("Store hidden. Its price history is preserved.");
            await load();
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : "Could not hide store");
          }
        }
      } else {
        setError(msg);
      }
    }
  }

  return (
    <section>
      <h1>Stores</h1>
      <form className="grid-form" onSubmit={submit}>
        <Input label="Store name" name="name" required />
        <Input label="Store type" name="storeType" placeholder="Walmart, Costco, local butcher" required />
        <Input label="Address" name="address" required />
        <Input label="City" name="city" required />
        <Input label="State" name="state" required />
        <Input label="ZIP" name="zip" required />
        <Input label="Phone" name="phone" />
        <label className="check"><input name="membershipRequired" type="checkbox" /> Membership required</label>
        <label className="check"><input name="favorite" type="checkbox" /> Favorite</label>
        <Textarea label="Notes" name="notes" />
        <button>Add store</button>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="warn">{message}</p>}
      <table><thead><tr><th>Name</th><th>Type</th><th>Address</th><th>Membership</th><th>Favorite</th><th></th></tr></thead><tbody>
        {stores.map((store) => <tr key={store.id}><td>{store.name}</td><td>{store.storeType}</td><td>{store.address}, {store.city}</td><td>{String(store.membershipRequired)}</td><td>{String(store.favorite)}</td><td><button type="button" className="danger" onClick={() => remove(store)}>Remove</button></td></tr>)}
      </tbody></table>
    </section>
  );
}
