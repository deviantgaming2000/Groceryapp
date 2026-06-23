#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.GROCERY_API_URL ?? "http://192.168.1.60:8080";
const FLIPP_POSTAL_CODE = process.env.FLIPP_POSTAL_CODE ?? "";
const FLIPP_BASE = "https://backflipp.wishabi.com";

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`API PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function apiDelete<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API DELETE ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function ok(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ── Flipp API ────────────────────────────────────────────────────────────────

async function flippSearch(query: string, postalCode: string) {
  const url = `${FLIPP_BASE}/flipp/items/search?q=${encodeURIComponent(query)}&locale=en-us&postal_code=${encodeURIComponent(postalCode)}&limit=30`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Flipp API → ${res.status}`);
  return res.json();
}

async function flippPublications(postalCode: string, merchantFilter?: string) {
  const url = `${FLIPP_BASE}/flipp/publications?locale=en-us&postal_code=${encodeURIComponent(postalCode)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Flipp publications API → ${res.status}`);
  const data: any = await res.json();
  const pubs = Array.isArray(data) ? data : (data.publications ?? data.flyers ?? []);
  if (merchantFilter) {
    return pubs.filter((p: any) =>
      (p.merchant ?? p.name ?? "").toLowerCase().includes(merchantFilter.toLowerCase())
    );
  }
  return pubs;
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "grocery-price-checker", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const TOOLS = [
  // ── Dashboard ──
  {
    name: "grocery_get_dashboard",
    description: "Get a high-level summary: active lists, recent price updates, favorite stores, active coupons.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },

  // ── Stores ──
  {
    name: "grocery_list_stores",
    description: "List all stores in the grocery database. Returns id, name, storeType, city, state, favorite flag.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "grocery_create_store",
    description: "Add a new store to the database.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Store name, e.g. 'Walmart Supercenter'" },
        storeType: { type: "string", description: "Store type, e.g. 'grocery', 'warehouse', 'pharmacy'" },
        address: { type: "string" },
        city: { type: "string" },
        state: { type: "string", description: "2-letter state code" },
        zip: { type: "string" },
        membershipRequired: { type: "boolean" },
        favorite: { type: "boolean" }
      },
      required: ["name", "storeType", "address", "city", "state", "zip"]
    }
  },

  // ── Items ──
  {
    name: "grocery_search_items",
    description: "Search grocery items by name or category. Use this before creating an item to avoid duplicates.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Name or partial name to search" },
        category: { type: "string", description: "Filter by category (optional)" }
      },
      required: []
    }
  },
  {
    name: "grocery_create_item",
    description: "Create a new grocery item. Call grocery_search_items first to check for existing matches.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Item name, e.g. 'Pepsi 12-pack'" },
        category: { type: "string", description: "Category, e.g. 'beverages', 'dairy', 'meat', 'produce', 'snacks', 'frozen'" },
        quantityNeeded: { type: "number", description: "Default quantity needed per shopping trip" },
        unitType: {
          type: "string",
          enum: ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"],
          description: "Unit type matching quantityNeeded"
        },
        preferredBrand: { type: "string" },
        upc: { type: "string" },
        notes: { type: "string" },
        commonlyUsed: { type: "boolean" }
      },
      required: ["name", "category", "quantityNeeded", "unitType"]
    }
  },
  {
    name: "grocery_update_item",
    description: "Update an existing grocery item's details.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Item ID from grocery_search_items" },
        name: { type: "string" },
        category: { type: "string" },
        quantityNeeded: { type: "number" },
        unitType: { type: "string", enum: ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"] },
        preferredBrand: { type: "string" },
        notes: { type: "string" }
      },
      required: ["id"]
    }
  },

  // ── Prices ──
  {
    name: "grocery_get_prices",
    description: "Get saved price entries, optionally filtered by item or store.",
    inputSchema: {
      type: "object",
      properties: {
        groceryItemId: { type: "string", description: "Filter by item ID (optional)" },
        storeId: { type: "string", description: "Filter by store ID (optional)" }
      },
      required: []
    }
  },
  {
    name: "grocery_add_price",
    description: "Record a price for a grocery item at a store. Use today's date for recordedAt unless you know the actual date.",
    inputSchema: {
      type: "object",
      properties: {
        groceryItemId: { type: "string", description: "ID from grocery_search_items" },
        storeId: { type: "string", description: "ID from grocery_list_stores" },
        price: { type: "number", description: "Price in dollars (e.g. 4.99)" },
        packageQuantity: { type: "number", description: "Quantity in the package (e.g. 12 for a 12-pack)" },
        packageUnit: {
          type: "string",
          enum: ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"],
          description: "Unit for packageQuantity"
        },
        brand: { type: "string" },
        salePrice: { type: "boolean", description: "Is this a sale/temporary price?" },
        confidence: { type: "string", enum: ["confirmed", "estimated", "old", "unknown"] },
        recordedAt: { type: "string", description: "ISO date string, defaults to today" },
        expiresAt: { type: "string", description: "ISO date if this is a limited-time price" },
        notes: { type: "string" }
      },
      required: ["groceryItemId", "storeId", "price", "packageQuantity", "packageUnit"]
    }
  },

  // ── Lists ──
  {
    name: "grocery_get_lists",
    description: "Get all grocery lists with their items. Returns id, name, isActive, item count.",
    inputSchema: {
      type: "object",
      properties: {
        activeOnly: { type: "boolean", description: "If true, only return active (non-archived) lists" }
      },
      required: []
    }
  },
  {
    name: "grocery_create_list",
    description: "Create a new grocery list.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name, e.g. 'Weekly Shop'" },
        notes: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "grocery_add_to_list",
    description: "Add a grocery item to a list. Use grocery_search_items to find the item ID first.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "List ID from grocery_get_lists" },
        groceryItemId: { type: "string", description: "Item ID from grocery_search_items" },
        quantityNeeded: { type: "number", description: "How many needed for this trip" },
        unitType: {
          type: "string",
          enum: ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"]
        }
      },
      required: ["listId", "groceryItemId", "quantityNeeded", "unitType"]
    }
  },
  {
    name: "grocery_update_list_item",
    description: "Update quantity, unit, or checked-off status for an item already on a list.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        listItemId: { type: "string", description: "ID of the GroceryListItem row (from grocery_get_lists)" },
        quantityNeeded: { type: "number" },
        unitType: { type: "string", enum: ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"] },
        checkedOff: { type: "boolean" }
      },
      required: ["listId", "listItemId"]
    }
  },
  {
    name: "grocery_remove_from_list",
    description: "Remove an item from a grocery list.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        listItemId: { type: "string" }
      },
      required: ["listId", "listItemId"]
    }
  },
  {
    name: "grocery_archive_list",
    description: "Archive (or restore) a grocery list. Archived lists are hidden from the active view.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        isActive: { type: "boolean", description: "true = restore, false = archive" }
      },
      required: ["listId", "isActive"]
    }
  },

  // ── Coupons / Deals ──
  {
    name: "grocery_list_coupons",
    description: "List all coupons and promotional deals.",
    inputSchema: {
      type: "object",
      properties: {
        activeOnly: { type: "boolean" }
      },
      required: []
    }
  },
  {
    name: "grocery_add_coupon",
    description: `Add a coupon or promotional deal.
Coupon types:
- dollar_off / percent_off / membership_discount / digital_coupon: standard discounts
- bogo: buy 1 get 1 free
- buy_x_get_y_free: e.g. "buy 3 cases get 1 free" → buyQuantity=3, freeQuantity=1
- buy_x_save_z: e.g. "buy 2 save $1" → buyQuantity=2, amountOff=1.00

The comparison engine auto-applies promo deals when list quantity qualifies.`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: 'Deal name, e.g. "Pepsi Buy 3 Get 1 Free"' },
        couponType: {
          type: "string",
          enum: ["dollar_off", "percent_off", "bogo", "buy_x_get_y_free", "buy_x_save_z", "membership_discount", "digital_coupon"]
        },
        scope: {
          type: "string",
          enum: ["item", "store", "grocery_list", "order_total"],
          description: "What the coupon applies to"
        },
        storeId: { type: "string", description: "Limit to a specific store (optional)" },
        groceryItemId: { type: "string", description: "Limit to a specific item (optional)" },
        amountOff: { type: "number", description: "Dollar amount off (for dollar_off, buy_x_save_z, bogo)" },
        percentOff: { type: "number", description: "Percentage off (for percent_off)" },
        buyQuantity: { type: "number", description: "How many to buy to trigger the deal (for buy_x_get_y_free, buy_x_save_z)" },
        freeQuantity: { type: "number", description: "How many you get free (for buy_x_get_y_free)" },
        limitPerTransaction: { type: "number", description: "Max times this deal can trigger per shopping trip" },
        expiresAt: { type: "string", description: "ISO date when deal expires" },
        description: { type: "string" }
      },
      required: ["name", "couponType", "scope"]
    }
  },
  {
    name: "grocery_deactivate_coupon",
    description: "Deactivate (soft-delete) a coupon.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    }
  },

  // ── Comparison ──
  {
    name: "grocery_compare_list",
    description: "Run price comparison for a grocery list. Returns best single-store, best with driving cost, mixed-store strategy, and per-item price breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string", description: "List ID from grocery_get_lists" }
      },
      required: ["listId"]
    }
  },

  // ── Flipp ──
  {
    name: "flipp_search_deals",
    description: `Search Flipp for current deals matching a product name near a postal code.
Returns deal name, price, sale story (promo description like "3 for $5"), store/merchant, and expiry date.
If the API fails, falls back to Chrome scraping instructions.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Product to search, e.g. "pepsi", "chicken breast", "milk"' },
        postalCode: { type: "string", description: `ZIP/postal code. Defaults to ${FLIPP_POSTAL_CODE || "(set FLIPP_POSTAL_CODE env var)"}` }
      },
      required: ["query"]
    }
  },
  {
    name: "flipp_get_store_flyer",
    description: `Get the current weekly flyer for a specific store chain near a postal code.
Returns available flyer titles, date ranges, and item counts.
If the API fails, provides Chrome scraping instructions for flipp.com.`,
    inputSchema: {
      type: "object",
      properties: {
        storeName: { type: "string", description: 'Store chain to look for, e.g. "Walmart", "Kroger", "Safeway"' },
        postalCode: { type: "string", description: `ZIP/postal code. Defaults to ${FLIPP_POSTAL_CODE || "(set FLIPP_POSTAL_CODE env var)"}` }
      },
      required: ["storeName"]
    }
  },
  {
    name: "flipp_import_deal",
    description: `Import a Flipp deal as either a price entry or a coupon/promo in the grocery database.
Use after flipp_search_deals to actually save the deal. Automatically detects promo type from sale_story text.`,
    inputSchema: {
      type: "object",
      properties: {
        itemName: { type: "string", description: "Item name from Flipp deal" },
        storeName: { type: "string", description: "Store name from Flipp deal" },
        price: { type: "number", description: "Price from Flipp deal" },
        saleStory: { type: "string", description: "Promo text from Flipp, e.g. '3 for $5', 'Buy 2 Get 1 Free'" },
        packageQuantity: { type: "number", description: "Package size/quantity" },
        packageUnit: { type: "string", enum: ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"] },
        expiresAt: { type: "string", description: "Deal expiry date (ISO)" },
        importAs: { type: "string", enum: ["price", "coupon", "both"], description: "Whether to save as a price entry, coupon, or both" }
      },
      required: ["itemName", "storeName", "price", "packageQuantity", "packageUnit", "importAs"]
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, any>;

  try {
    switch (name) {
      // ── Dashboard ──
      case "grocery_get_dashboard": {
        const [lists, prices, stores, coupons] = await Promise.all([
          apiGet<any[]>("/api/lists"),
          apiGet<any[]>("/api/prices"),
          apiGet<any[]>("/api/stores"),
          apiGet<any[]>("/api/coupons")
        ]);
        return ok({
          activeLists: lists.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name, itemCount: l.items?.length ?? 0 })),
          recentPrices: prices.slice(0, 8).map((p) => ({ item: p.groceryItem?.name, store: p.store?.name, recordedAt: p.recordedAt })),
          favoriteStores: stores.filter((s) => s.favorite).map((s) => ({ id: s.id, name: s.name, city: s.city })),
          activeCoupons: coupons.filter((c) => c.isActive).length
        });
      }

      // ── Stores ──
      case "grocery_list_stores":
        return ok(await apiGet("/api/stores"));

      case "grocery_create_store":
        return ok(await apiPost("/api/stores", a));

      // ── Items ──
      case "grocery_search_items": {
        const params = new URLSearchParams();
        if (a.search) params.set("search", a.search);
        if (a.category) params.set("category", a.category);
        return ok(await apiGet(`/api/items?${params}`));
      }

      case "grocery_create_item":
        return ok(await apiPost("/api/items", a));

      case "grocery_update_item": {
        const { id, ...data } = a;
        return ok(await apiPatch(`/api/items/${id}`, data));
      }

      // ── Prices ──
      case "grocery_get_prices": {
        const params = new URLSearchParams();
        if (a.groceryItemId) params.set("groceryItemId", a.groceryItemId);
        if (a.storeId) params.set("storeId", a.storeId);
        return ok(await apiGet(`/api/prices?${params}`));
      }

      case "grocery_add_price":
        return ok(await apiPost("/api/prices", a));

      // ── Lists ──
      case "grocery_get_lists": {
        const lists = await apiGet<any[]>("/api/lists");
        const filtered = a.activeOnly ? lists.filter((l: any) => l.isActive) : lists;
        return ok(filtered);
      }

      case "grocery_create_list":
        return ok(await apiPost("/api/lists", a));

      case "grocery_add_to_list": {
        const { listId, ...data } = a;
        return ok(await apiPost(`/api/lists/${listId}/items`, data));
      }

      case "grocery_update_list_item": {
        const { listId, listItemId, ...data } = a;
        return ok(await apiPatch(`/api/lists/${listId}/items/${listItemId}`, data));
      }

      case "grocery_remove_from_list":
        return ok(await apiDelete(`/api/lists/${a.listId}/items/${a.listItemId}`));

      case "grocery_archive_list":
        return ok(await apiPatch(`/api/lists/${a.listId}`, { isActive: a.isActive }));

      // ── Coupons ──
      case "grocery_list_coupons": {
        const coupons = await apiGet<any[]>("/api/coupons");
        return ok(a.activeOnly ? coupons.filter((c: any) => c.isActive) : coupons);
      }

      case "grocery_add_coupon":
        return ok(await apiPost("/api/coupons", a));

      case "grocery_deactivate_coupon":
        return ok(await apiDelete(`/api/coupons/${a.id}`));

      // ── Compare ──
      case "grocery_compare_list":
        return ok(await apiGet(`/api/compare/${a.listId}`));

      // ── Flipp ──
      case "flipp_search_deals": {
        const zip = a.postalCode || FLIPP_POSTAL_CODE;
        if (!zip) return err("No postal code provided. Pass postalCode or set FLIPP_POSTAL_CODE env var.");
        try {
          const data = await flippSearch(a.query, zip);
          const items = Array.isArray(data) ? data : (data.items ?? data.flyer_items ?? []);
          if (!items.length) return ok({ message: "No deals found on Flipp.", query: a.query, zip });
          return ok(items.slice(0, 20).map((item: any) => ({
            name: item.name ?? item.description,
            price: item.current_price ?? item.price,
            originalPrice: item.original_price ?? item.pre_price,
            saleStory: item.sale_story ?? item.promo_text,
            merchant: item.merchant_name ?? item.merchant ?? item.flyer_merchant,
            merchantId: item.merchant_id,
            flyerId: item.flyer_id,
            validFrom: item.valid_from,
            validTo: item.valid_to,
            category: item._L2 ?? item._L1 ?? item.category_names?.[0]
          })));
        } catch (e) {
          return ok({
            apiError: String(e),
            fallback: "The Flipp API is unavailable. To get deals manually, ask the Chrome extension to navigate to https://www.flipp.com and search for this item, then paste the deal details back here.",
            scrapePrompt: `Navigate to https://www.flipp.com/search#query=${encodeURIComponent(a.query)}&postal_code=${zip} and extract all current deals with their price, promo text, store name, and expiry date.`
          });
        }
      }

      case "flipp_get_store_flyer": {
        const zip = a.postalCode || FLIPP_POSTAL_CODE;
        if (!zip) return err("No postal code provided. Pass postalCode or set FLIPP_POSTAL_CODE env var.");
        try {
          const pubs = await flippPublications(zip, a.storeName);
          if (!pubs.length) return ok({ message: `No Flipp flyer found for "${a.storeName}" near ${zip}.` });
          return ok(pubs.slice(0, 5).map((p: any) => ({
            id: p.id,
            merchant: p.merchant_name ?? p.merchant ?? p.name,
            title: p.name ?? p.merchant_name ?? p.merchant,
            validFrom: p.valid_from,
            validTo: p.valid_to,
            itemCount: p.num_items ?? p.item_count
          })));
        } catch (e) {
          return ok({
            apiError: String(e),
            fallback: "The Flipp API is unavailable.",
            scrapePrompt: `Navigate to https://www.flipp.com/flyers and find the current ${a.storeName} flyer near ${zip}. Extract all sale items with prices, promo descriptions, and expiry dates.`
          });
        }
      }

      case "flipp_import_deal": {
        // Resolve item — search first, create if needed
        const items = await apiGet<any[]>(`/api/items?search=${encodeURIComponent(a.itemName)}`);
        let item = (items as any[]).find((i) => i.name.toLowerCase().includes(a.itemName.toLowerCase()));
        if (!item) {
          const result = await apiPost<any>("/api/items", {
            name: a.itemName,
            category: "imported",
            quantityNeeded: a.packageQuantity,
            unitType: a.packageUnit
          });
          item = result.item ?? result;
        }

        // Resolve store
        const stores = await apiGet<any[]>("/api/stores");
        const store = (stores as any[]).find((s) => s.name.toLowerCase().includes(a.storeName.toLowerCase()));
        if (!store) return err(`Store "${a.storeName}" not found. Add it first with grocery_create_store.`);

        const results: any[] = [];

        if (a.importAs === "price" || a.importAs === "both") {
          const price = await apiPost("/api/prices", {
            groceryItemId: item.id,
            storeId: store.id,
            price: a.price,
            packageQuantity: a.packageQuantity,
            packageUnit: a.packageUnit,
            salePrice: true,
            confidence: "confirmed",
            expiresAt: a.expiresAt ?? null,
            notes: a.saleStory ?? null
          });
          results.push({ added: "price", data: price });
        }

        if ((a.importAs === "coupon" || a.importAs === "both") && a.saleStory) {
          // Parse promo from saleStory
          const story = (a.saleStory ?? "").toLowerCase();
          let couponPayload: any = {
            name: `${a.storeName}: ${a.saleStory}`,
            scope: "item",
            storeId: store.id,
            groceryItemId: item.id,
            expiresAt: a.expiresAt ?? null,
            description: a.saleStory
          };

          // "buy 3 get 1 free" / "buy 2 get 1 free"
          const buyGetFree = story.match(/buy\s+(\d+)\s+get\s+(\d+)\s+free/);
          if (buyGetFree) {
            couponPayload = { ...couponPayload, couponType: "buy_x_get_y_free", buyQuantity: Number(buyGetFree[1]), freeQuantity: Number(buyGetFree[2]) };
          }
          // "bogo" or "buy 1 get 1"
          else if (story.includes("bogo") || story.match(/buy\s+1\s+get\s+1/)) {
            couponPayload = { ...couponPayload, couponType: "bogo" };
          }
          // "3 for $X" or "2 for $X"
          else if (story.match(/\d+\s+for\s+\$[\d.]+/)) {
            const m = story.match(/(\d+)\s+for\s+\$([\d.]+)/);
            if (m) {
              const qty = Number(m[1]), total = Number(m[2]);
              const each = total / qty;
              const savePerGroup = (a.price - each) * qty;
              couponPayload = { ...couponPayload, couponType: "buy_x_save_z", buyQuantity: qty, amountOff: parseFloat(savePerGroup.toFixed(2)) };
            }
          }
          // "save $X when you buy Y" / "buy X save $Y"
          else if (story.match(/save\s+\$[\d.]+/) || story.match(/\$[\d.]+\s+off/)) {
            const saveM = story.match(/\$?([\d.]+)\s+off/) ?? story.match(/save\s+\$?([\d.]+)/);
            const buyM = story.match(/buy\s+(\d+)/);
            couponPayload = {
              ...couponPayload,
              couponType: buyM ? "buy_x_save_z" : "dollar_off",
              amountOff: saveM ? Number(saveM[1]) : undefined,
              buyQuantity: buyM ? Number(buyM[1]) : undefined
            };
          }
          // "X% off"
          else if (story.match(/\d+%\s*off/)) {
            const pctM = story.match(/(\d+)%\s*off/);
            couponPayload = { ...couponPayload, couponType: "percent_off", percentOff: pctM ? Number(pctM[1]) : undefined };
          }
          else {
            couponPayload = { ...couponPayload, couponType: "digital_coupon", amountOff: null };
          }

          const coupon = await apiPost("/api/coupons", couponPayload);
          results.push({ added: "coupon", type: couponPayload.couponType, data: coupon });
        }

        return ok({ item: { id: item.id, name: item.name }, store: { id: store.id, name: store.name }, results });
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
