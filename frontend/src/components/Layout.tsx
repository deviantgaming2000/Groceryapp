import { BarChart3, ClipboardList, Gauge, Home, Percent, Settings, ShoppingBasket, Store, Tags } from "lucide-react";
import { ReactNode } from "react";
import { SystemStatus } from "./SystemStatus";

const nav = [
  ["Dashboard", "dashboard", Home],
  ["Grocery Lists", "lists", ClipboardList],
  ["Items", "items", ShoppingBasket],
  ["Stores", "stores", Store],
  ["Price Entry", "prices", Tags],
  ["Comparison", "compare", BarChart3],
  ["Coupons", "coupons", Percent],
  ["Settings", "settings", Settings]
] as const;

export function Layout({ page, setPage, children }: { page: string; setPage: (page: string) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Gauge size={22} />
          <span>Grocery Math</span>
        </div>
        <nav>
          {nav.map(([label, id, Icon]) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <SystemStatus />
        {children}
      </main>
    </div>
  );
}
