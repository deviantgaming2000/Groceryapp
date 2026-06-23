import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface CredField {
  key: string;
  label: string;
  secret: boolean;
  set: boolean;
  hint: string | null;
  source: "db" | "env" | null;
}
interface CredStatus {
  provider: string;
  label: string;
  description: string;
  docsUrl?: string;
  configured: boolean;
  fields: CredField[];
}

function ProviderCard({ status, onChanged }: { status: CredStatus; onChanged: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
      if (Object.keys(payload).length === 0) {
        setNote("Nothing to save — enter a value first.");
        return;
      }
      await api(`/api/credentials/${status.provider}`, { method: "PUT", body: JSON.stringify(payload) });
      setValues({});
      setNote("Saved.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirm(`Remove saved keys for ${status.label}? (Any value set via .env still applies.)`)) return;
    setError("");
    try {
      await api(`/api/credentials/${status.provider}`, { method: "DELETE" });
      setValues({});
      setNote("Cleared.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear");
    }
  }

  return (
    <article>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>{status.label}</strong>
        <span className={`source-badge ${status.configured ? "promo" : "stale"}`}>
          {status.configured ? "Connected" : "Not set"}
        </span>
      </div>
      <p style={{ margin: "6px 0 12px", fontSize: 13 }}>
        {status.description}{" "}
        {status.docsUrl && <a href={status.docsUrl} target="_blank" rel="noreferrer" style={{ color: "var(--brand2)" }}>Get a key →</a>}
      </p>

      <div className="inline-edit" style={{ gridTemplateColumns: "1fr" }}>
        {status.fields.map((field) => (
          <label className="field" key={field.key}>
            <span>
              {field.label}
              {field.set && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--ink-soft)", textTransform: "none", letterSpacing: 0 }}>
                  saved {field.hint}{field.source === "env" ? " (from .env)" : ""}
                </span>
              )}
            </span>
            <input
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={field.set ? "•••••• (leave blank to keep)" : `Enter ${field.label}`}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>

      <div className="action-row" style={{ marginTop: 12 }}>
        <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        {status.fields.some((f) => f.source === "db") && (
          <button type="button" className="danger" onClick={clear}>Clear saved keys</button>
        )}
        {note && <span className="warn" style={{ fontSize: 12 }}>{note}</span>}
        {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
      </div>
    </article>
  );
}

export function ApiKeysPanel() {
  const [statuses, setStatuses] = useState<CredStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = () => api<CredStatus[]>("/api/credentials").then((s) => { setStatuses(s); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { void load(); }, []);

  if (!loaded) return <p>Loading integrations…</p>;
  return (
    <>
      <p style={{ marginTop: 0 }}>
        Keys entered here are stored in your database and take precedence over <code style={{ fontSize: 12 }}>.env</code>.
        Secrets are never shown again after saving — only a masked hint.
      </p>
      <div className="dashboard-grid">
        {statuses.map((status) => (
          <ProviderCard key={status.provider} status={status} onChanged={load} />
        ))}
      </div>
    </>
  );
}
