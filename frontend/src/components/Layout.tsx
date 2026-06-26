import { BarChart3, ClipboardList, Home, Newspaper, Percent, Search, Settings, ShoppingBasket, Sparkles, Store, Tags } from "lucide-react";
import { ReactNode } from "react";
import { SystemStatus } from "./SystemStatus";
import { PageTransition } from "./PageTransition";

const nav = [
  ["Dashboard", "dashboard", Home],
  ["Grocery Lists", "lists", ClipboardList],
  ["Items", "items", ShoppingBasket],
  ["Find Products", "kroger", Search],
  ["Stores", "stores", Store],
  ["Price Entry", "prices", Tags],
  ["Comparison", "compare", BarChart3],
  ["Deals", "deals", Sparkles],
  ["Flyers", "flyers", Newspaper],
  ["Coupons", "coupons", Percent],
  ["Settings", "settings", Settings]
] as const;

export function Layout({ page, setPage, children }: { page: string; setPage: (page: string) => void; children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="Grocery Math" className="brand-logo" />
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
        <PageTransition pageKey={page}>{children}</PageTransition>
      </main>
    </div>
  );
}
