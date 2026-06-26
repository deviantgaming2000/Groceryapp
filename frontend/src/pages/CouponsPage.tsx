import { FormEvent, useEffect, useState } from "react";
import { Input, Select, Textarea } from "../components/FormFields";
import { api, dateOnly, money } from "../lib/api";

const couponTypes = ["dollar_off", "percent_off", "bogo", "buy_x_get_y_free", "buy_x_save_z", "membership_discount", "digital_coupon"] as const;
type CouponType = typeof couponTypes[number];

const couponTypeLabels: Record<CouponType, string> = {
  dollar_off: "$ Off",
  percent_off: "% Off",
  bogo: "BOGO (Buy 1 Get 1)",
  buy_x_get_y_free: "Buy X Get Y Free",
  buy_x_save_z: "Buy X Save $Z",
  membership_discount: "Membership Discount",
  digital_coupon: "Digital Coupon"
};

function promoDescription(coupon: any): string {
  if (coupon.couponType === "buy_x_get_y_free") {
    const limit = coupon.limitPerTransaction ? `, max ${coupon.limitPerTransaction}x` : "";
    return `Buy ${coupon.buyQuantity ?? "?"} get ${coupon.freeQuantity ?? "?"} free${limit}`;
  }
  if (coupon.couponType === "buy_x_save_z") {
    const limit = coupon.limitPerTransaction ? `, max ${coupon.limitPerTransaction}x` : "";
    return `Buy ${coupon.buyQuantity ?? "?"} save ${money(coupon.amountOff)}${limit}`;
  }
  if (coupon.couponType === "bogo") return "Buy 1, get 1 free";
  if (coupon.amountOff) return money(coupon.amountOff) + " off";
  if (coupon.percentOff) return `${coupon.percentOff}% off`;
  return "—";
}

export function CouponsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponType, setCouponType] = useState<CouponType>("dollar_off");
  const [showInactive, setShowInactive] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () => Promise.all([api<any[]>("/api/items"), api<any[]>("/api/stores"), api<any[]>("/api/lists"), api<any[]>("/api/coupons")]).then(([i, s, l, c]) => { setItems(i); setStores(s); setLists(l); setCoupons(c); });
  useEffect(() => { void load(); }, []);

  async function deactivate(id: string) {
    setError("");
    try {
      await api(`/api/coupons/${id}`, { method: "DELETE" });
      setMessage("Coupon deactivated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate coupon");
    }
  }

  async function reactivate(id: string) {
    setError("");
    try {
      await api(`/api/coupons/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
      setMessage("Coupon reactivated.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reactivate coupon");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    try {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/coupons", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          storeId: data.storeId || null,
          groceryItemId: data.groceryItemId || null,
          groceryListId: data.groceryListId || null,
          amountOff: data.amountOff ? Number(data.amountOff) : null,
          percentOff: data.percentOff ? Number(data.percentOff) : null,
          buyQuantity: data.buyQuantity ? Number(data.buyQuantity) : null,
          freeQuantity: data.freeQuantity ? Number(data.freeQuantity) : null,
          limitPerTransaction: data.limitPerTransaction ? Number(data.limitPerTransaction) : null,
          allowExpired: data.allowExpired === "on"
        })
      });
      setMessage("Coupon added.");
      form.reset();
      setCouponType("dollar_off");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add coupon");
    }
  }

  const isPromo = couponType === "buy_x_get_y_free" || couponType === "buy_x_save_z" || couponType === "bogo";

  return (
    <section>
      <h1>Coupons &amp; Deals</h1>
      <form className="grid-form" onSubmit={submit}>
        <Input label="Coupon / deal name" name="name" placeholder='e.g. "Pepsi 12-pack BOGO"' required />
        <div className="field">
          <span>Type</span>
          <select name="couponType" value={couponType} onChange={(e) => setCouponType(e.target.value as CouponType)}>
            {couponTypes.map((t) => <option key={t} value={t}>{couponTypeLabels[t]}</option>)}
          </select>
        </div>
        <Select label="Applies to" name="scope" options={["item", "store", "grocery_list", "order_total"]} />
        <label className="field"><span>Store</span><select name="storeId"><option value="">Any</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label className="field"><span>Item</span><select name="groceryItemId"><option value="">Any</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>List</span><select name="groceryListId"><option value="">Any</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>

        {/* Promo quantity fields */}
        {(couponType === "buy_x_get_y_free" || couponType === "buy_x_save_z" || couponType === "bogo") && (
          <>
            {couponType !== "bogo" && <Input label="Buy quantity (X)" name="buyQuantity" type="number" step="1" placeholder="3" />}
            {couponType === "buy_x_get_y_free" && <Input label="Free quantity (Y)" name="freeQuantity" type="number" step="1" placeholder="1" />}
            {(couponType === "buy_x_save_z" || couponType === "bogo") && <Input label="Save amount ($)" name="amountOff" type="number" step="0.01" placeholder="0.00" />}
            <Input label="Max uses per trip" name="limitPerTransaction" type="number" step="1" placeholder="Optional" />
          </>
        )}

        {/* Standard discount fields */}
        {(couponType === "dollar_off" || couponType === "membership_discount" || couponType === "digital_coupon") && (
          <Input label="Amount off ($)" name="amountOff" type="number" step="0.01" />
        )}
        {couponType === "percent_off" && (
          <Input label="Percent off (%)" name="percentOff" type="number" step="0.01" />
        )}

        <Input label="Expires" name="expiresAt" type="date" />
        <label className="check"><input name="allowExpired" type="checkbox" /> Allow expired manually</label>
        <Textarea label="Description / notes" name="description" />
        <button>Add deal</button>
      </form>

      {error && <p className="error">{error}</p>}
      {message && <p className="warn">{message}</p>}

      <h2>Active deals</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Type</th><th>Scope</th><th>Deal</th><th>Item / Store</th><th>Expires</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {coupons.filter((c) => c.isActive).map((coupon) => {
            const expired = coupon.expiresAt ? new Date(coupon.expiresAt) < new Date() : false;
            return (
              <tr key={coupon.id} style={expired ? { opacity: 0.5 } : {}}>
                <td>{coupon.name}</td>
                <td>{couponTypeLabels[coupon.couponType as CouponType] ?? coupon.couponType}</td>
                <td>{coupon.scope}</td>
                <td className="cheap">{promoDescription(coupon)}</td>
                <td style={{ fontSize: 12 }}>{[coupon.groceryItem?.name, coupon.store?.name].filter(Boolean).join(" · ") || "Any"}</td>
                <td>{dateOnly(coupon.expiresAt) || "—"}</td>
                <td>{expired ? <span className="error">Expired</span> : <span style={{ color: "var(--accent)" }}>Active</span>}</td>
                <td><button type="button" className="danger" onClick={() => deactivate(coupon.id)}>Deactivate</button></td>
              </tr>
            );
          })}
          {coupons.filter((c) => c.isActive).length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--ink-soft)" }}>No active deals.</td></tr>
          )}
        </tbody>
      </table>

      {coupons.some((c) => !c.isActive) && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="secondary" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? "Hide" : "Show"} inactive deals ({coupons.filter((c) => !c.isActive).length})
          </button>
          {showInactive && (
            <table style={{ marginTop: 10, opacity: 0.85 }}>
              <thead>
                <tr><th>Name</th><th>Type</th><th>Deal</th><th>Item / Store</th><th>Expires</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {coupons.filter((c) => !c.isActive).map((coupon) => (
                  <tr key={coupon.id}>
                    <td>{coupon.name}</td>
                    <td>{couponTypeLabels[coupon.couponType as CouponType] ?? coupon.couponType}</td>
                    <td className="cheap">{promoDescription(coupon)}</td>
                    <td style={{ fontSize: 12 }}>{[coupon.groceryItem?.name, coupon.store?.name].filter(Boolean).join(" · ") || "Any"}</td>
                    <td>{dateOnly(coupon.expiresAt) || "—"}</td>
                    <td><button type="button" onClick={() => reactivate(coupon.id)}>Reactivate</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
