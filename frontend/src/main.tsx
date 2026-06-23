import { ReactElement, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Layout } from "./components/Layout";
import { VantaBackground } from "./components/VantaBackground";
import { Dashboard } from "./pages/Dashboard";
import { ListsPage } from "./pages/ListsPage";
import { ItemsPage } from "./pages/ItemsPage";
import { StoresPage } from "./pages/StoresPage";
import { PricesPage } from "./pages/PricesPage";
import { ComparePage } from "./pages/ComparePage";
import { SettingsPage } from "./pages/SettingsPage";
import { CouponsPage } from "./pages/CouponsPage";
import { FindProductsPage } from "./pages/FindProductsPage";
import "./styles/app.css";

function App() {
  const [page, setPage] = useState("dashboard");
  const views: Record<string, ReactElement> = {
    dashboard: <Dashboard setPage={setPage} />,
    lists: <ListsPage />,
    items: <ItemsPage />,
    stores: <StoresPage />,
    prices: <PricesPage />,
    compare: <ComparePage />,
    coupons: <CouponsPage />,
    kroger: <FindProductsPage />,
    settings: <SettingsPage />
  };
  return (
    <>
      <VantaBackground />
      <Layout page={page} setPage={setPage}>{views[page]}</Layout>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
