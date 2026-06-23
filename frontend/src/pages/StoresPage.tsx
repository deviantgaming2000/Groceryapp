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
      <table><thead><tr><th>Name</th><th>Type</th><th>Address</th><th>Membership</th><th>Favorite</th></tr></thead><tbody>
        {stores.map((store) => <tr key={store.id}><td>{store.name}</td><td>{store.storeType}</td><td>{store.address}, {store.city}</td><td>{String(store.membershipRequired)}</td><td>{String(store.favorite)}</td></tr>)}
      </tbody></table>
    </section>
  );
}
