import { FormEvent, useEffect, useState } from "react";
import { Input } from "../components/FormFields";
import { ApiKeysPanel } from "../components/ApiKeysPanel";
import { api } from "../lib/api";

export function SettingsPage() {
  const [settings, setSettings] = useState<any>(null);
  const [distances, setDistances] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [dataSummary, setDataSummary] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const loadSummary = () => api<any>("/api/data/summary").then(setDataSummary).catch(() => {});
  const load = () => Promise.all([api<any>("/api/settings"), api<any[]>("/api/distances"), api<any[]>("/api/stores")]).then(([s, d, stores]) => {
    setSettings(s);
    setDistances(d);
    setStores(stores);
    if (!selectedStoreId && stores[0]) setSelectedStoreId(stores[0].id);
  });
  useEffect(() => { void load(); void loadSummary(); }, []);

  async function dataAction(path: string, confirmMsg: string, body?: Record<string, unknown>) {
    if (!confirm(confirmMsg)) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await api<any>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
      const [, count] = Object.entries(res)[0] ?? ["", 0];
      setMessage(`Done — ${count} price ${Number(count) === 1 ? "entry" : "entries"} affected.`);
      await Promise.all([load(), loadSummary()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ ...data, vehicleMpg: Number(data.vehicleMpg), gasPricePerGallon: Number(data.gasPricePerGallon), roundTrip: data.roundTrip === "on", costPerMileOverride: data.costPerMileOverride ? Number(data.costPerMileOverride) : null }) });
      setMessage("Settings saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    }
  }

  async function saveDistance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/distances/manual", { method: "POST", body: JSON.stringify({ ...data, oneWayMiles: Number(data.oneWayMiles), oneWayMinutes: data.oneWayMinutes ? Number(data.oneWayMinutes) : null }) });
      setMessage("Distance saved.");
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save distance");
    }
  }

  async function calculateDistance() {
    if (!selectedStoreId) return;
    setError("");
    try {
      await api(`/api/distances/calculate/${selectedStoreId}`, { method: "POST" });
      setMessage("Google Maps distance calculated and saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not calculate distance");
    }
  }

  if (!settings) return <p>Loading settings...</p>;
  return (
    <section>
      <h1>Settings</h1>

      <h2>Data Management</h2>
      <div className="panel">
        {!dataSummary ? <p style={{ margin: 0 }}>Loading data summary…</p> : (
          <>
            <div className="dashboard-grid" style={{ marginBottom: 12 }}>
              <article><strong>Prices</strong><p style={{ margin: "4px 0 0", fontSize: 13 }}>{dataSummary.prices.active} active · {dataSummary.prices.inactive} hidden</p></article>
              <article><strong>Items</strong><p style={{ margin: "4px 0 0", fontSize: 13 }}>{dataSummary.items.active} active · {dataSummary.items.inactive} hidden</p></article>
              <article><strong>Coupons</strong><p style={{ margin: "4px 0 0", fontSize: 13 }}>{dataSummary.coupons.active} active · {dataSummary.coupons.inactive} hidden</p></article>
              <article><strong>Stores / Lists</strong><p style={{ margin: "4px 0 0", fontSize: 13 }}>{dataSummary.stores} stores · {dataSummary.lists} lists</p></article>
            </div>

            <table><thead><tr><th>Store</th><th>Active prices</th><th>Hidden prices</th></tr></thead><tbody>
              {dataSummary.perStore.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.name}{!s.storeActive && <span className="source-badge stale" style={{ marginLeft: 6 }}>store hidden</span>}</td>
                  <td>{s.pricesActive}</td>
                  <td>{s.pricesInactive}</td>
                </tr>
              ))}
            </tbody></table>

            <div className="action-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" disabled={busy || dataSummary.prices.inactive === 0}
                onClick={() => dataAction("/api/data/prices/reactivate", `Reactivate all ${dataSummary.prices.inactive} hidden price entries so they show in comparisons?`)}>
                Restore {dataSummary.prices.inactive} hidden prices
              </button>
              <button type="button" className="danger" disabled={busy || dataSummary.prices.inactive === 0}
                onClick={() => dataAction("/api/data/prices/purge-inactive", `Permanently DELETE all ${dataSummary.prices.inactive} hidden price entries? This cannot be undone.`)}>
                Purge {dataSummary.prices.inactive} hidden prices
              </button>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 8 }}>
              "Hidden" prices are soft-deleted — kept in the database but excluded from Price Entry and comparisons. Restore brings them back; Purge removes them for good.
            </p>
          </>
        )}
      </div>

      <h2>API Keys &amp; Integrations</h2>
      <ApiKeysPanel />
      <form className="grid-form" onSubmit={save}>
        <Input label="Home address" name="homeAddress" defaultValue={settings.homeAddress || ""} />
        <Input label="City" name="homeCity" defaultValue={settings.homeCity || ""} />
        <Input label="State" name="homeState" defaultValue={settings.homeState || ""} />
        <Input label="ZIP" name="homeZip" defaultValue={settings.homeZip || ""} />
        <Input label="Vehicle MPG" name="vehicleMpg" type="number" step="0.1" defaultValue={settings.vehicleMpg} />
        <Input label="Gas price / gallon" name="gasPricePerGallon" type="number" step="0.01" defaultValue={settings.gasPricePerGallon} />
        <Input label="Cost per mile override" name="costPerMileOverride" type="number" step="0.001" defaultValue={settings.costPerMileOverride || ""} />
        <label className="check"><input name="roundTrip" type="checkbox" defaultChecked={settings.roundTrip} /> Round trip</label>
        <button>Save settings</button>
      </form>
      {error && <p className="error">{error}</p>}
      {message && <p className="warn">{message}</p>}
      <h2>Manual Distance Overrides</h2>
      <form className="grid-form compact" onSubmit={saveDistance}>
        <label className="field"><span>Store</span><select name="storeId" value={selectedStoreId} onChange={(event) => setSelectedStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <Input label="One-way miles" name="oneWayMiles" type="number" step="0.1" />
        <Input label="One-way minutes" name="oneWayMinutes" type="number" />
        <div className="action-row">
          <button>Save manual distance</button>
          <button className="secondary" type="button" onClick={calculateDistance}>Calculate with Google Maps</button>
        </div>
      </form>
      <table><thead><tr><th>Store</th><th>One-way miles</th><th>Minutes</th><th>Source</th></tr></thead><tbody>
        {distances.map((row) => <tr key={row.id}><td>{row.store?.name}</td><td>{row.oneWayMiles}</td><td>{row.oneWayMinutes || "-"}</td><td>{row.source}</td></tr>)}
      </tbody></table>
    </section>
  );
}
