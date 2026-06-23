import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function SystemStatus() {
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ ok: boolean }>("/api/health/db")
      .then(() => setError(""))
      .catch((err) => setError(err.message));
  }, []);

  if (!error) return null;

  return (
    <div className="system-alert">
      <strong>Database is offline.</strong>
      <span>{error}</span>
      <code>docker compose up postgres</code>
      <code>npx prisma migrate dev</code>
    </div>
  );
}
