const form = document.querySelector("#compare-form");
const results = document.querySelector("#results");
const summary = document.querySelector("#summary");
const manualPanel = document.querySelector("#manual-panel");
const manualForm = document.querySelector("#manual-form");
const sessionsPanel = document.querySelector("#sessions-panel");
const sessionForm = document.querySelector("#session-form");
const sessionStatus = document.querySelector("#session-status");
const diagnosticsPanel = document.querySelector("#diagnostics-panel");
const diagnosticsOutput = document.querySelector("#diagnostics-output");

function money(value) {
  if (value === null || value === undefined) return "-";
  return `$${Number(value).toFixed(2)}`;
}

function sourceLabel(row) {
  if (row.source_type === "manual") return `<span class="manual-label">Manual price</span>`;
  return `<span class="source">${row.source_type}</span>`;
}

function linkify(value) {
  if (!value) return "-";
  return `<a href="${value}" target="_blank" rel="noreferrer">Open</a>`;
}

function debugLink(path) {
  if (!path) return "";
  const name = path.split("/").pop();
  return `<a href="/debug-snapshots/${name}" target="_blank" rel="noreferrer">${name}</a>`;
}

function debugLinks(...paths) {
  const links = paths.filter(Boolean).map(debugLink);
  return links.length ? links.join(" | ") : "-";
}

function firstItem() {
  return document.querySelector("#items").value.split(/[,\n]/).map(x => x.trim()).filter(Boolean)[0] || "milk";
}

function selectedStores() {
  return [...document.querySelectorAll("input[name=store]:checked")].map(x => x.value);
}

function nextStepFor(row) {
  if (row.source_type === "manual") return "Manual price is included.";
  if (row.scrape_status === "ok") return "Live extraction worked.";
  if (row.store_slug === "kroger" && row.scrape_status === "api_credentials_missing") {
    return "Add Kroger API credentials or configure a signed-in Fry's browser profile.";
  }
  if (row.scrape_status === "scraper_blocked") {
    return "The store showed a bot/CAPTCHA challenge to Playwright. Use a signed-in browser profile or manual price entry; the app will not bypass the challenge.";
  }
  if (row.scrape_status === "location_required") {
    return "Configure Store sign-in / location, then select the store inside that browser profile.";
  }
  return "Run diagnostics to inspect the saved HTML and screenshot, then update selectors or session setup.";
}

async function loadStoreSessions() {
  const response = await fetch("/api/store-sessions");
  const sessions = await response.json();
  sessionStatus.innerHTML = sessions.map(session => `
    <div class="session-card">
      <strong>${session.store_name}</strong>
      <div>Profile: ${session.profile_dir || "Not configured"} ${session.profile_dir_exists ? "(found)" : ""}</div>
      <div>Selected store: ${session.selected_store_name || session.selected_store_id || "Not configured"}</div>
      <div class="warning">${(session.warnings || []).join("; ")}</div>
    </div>
  `).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  results.innerHTML = "Checking live sources...";
  summary.innerHTML = "";
  const items = document.querySelector("#items").value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
  const stores = selectedStores();
  const payload = {
    items,
    stores,
    zip_code: document.querySelector("#zip").value.trim(),
    include_manual: document.querySelector("#include-manual").checked,
    include_coupons: document.querySelector("#include-coupons").checked
  };
  const response = await fetch("/api/compare", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  summary.innerHTML = `
    <div class="card">Best single store<strong>${data.best_single_store.store || "Unavailable"}</strong>${money(data.best_single_store.total)}</div>
    <div class="card">Cheapest split cart<strong>${money(data.split_cart.total)}</strong>${(data.split_cart.stores_required || []).join(", ")}</div>
    <div class="card">Estimated savings<strong>${money(data.estimated_savings)}</strong>${data.recommendation}</div>
  `;
  results.innerHTML = data.items.map(item => `
    <article class="item">
      <h2>${item.query}</h2>
      ${item.cheapest ? "" : `<p class="warning">No live price found. Add manual price?</p>`}
      <div class="table-wrap">
        <table>
	          <thead><tr><th>Item</th><th>Best Store</th><th>Product</th><th>Size</th><th>Price</th><th>Final</th><th>Unit Price</th><th>Confidence</th><th>Status</th><th>Source</th><th>Location</th><th>Search URL</th><th>Debug</th><th>Next Step</th><th>Warnings</th><th>Checked At</th><th>Product Link</th></tr></thead>
          <tbody>
            ${item.store_results.map(row => `
              <tr>
                <td>${item.query}</td>
                <td>${row.store}</td>
                <td>${row.product_name}</td>
                <td>${row.size_text || "-"}</td>
                <td>${money(row.price)}</td>
                <td>${money(row.final_price)}</td>
	                <td>${row.final_unit_price ? `${row.final_unit_price} / ${row.unit_price_unit || ""}` : "-"}</td>
	                <td>${row.scrape_status === "ok" && row.confidence_score !== null ? Number(row.confidence_score).toFixed(2) : "-"}</td>
	                <td>${row.scrape_status}</td>
	                <td>${sourceLabel(row)}</td>
		                <td>${row.location_status || "-"}</td>
		                <td>${linkify(row.search_url)}</td>
		                <td>${debugLinks(row.debug_html_path, row.debug_screenshot_path)}</td>
		                <td>${nextStepFor(row)}</td>
		                <td class="warning">${(row.warnings || []).join("; ")}</td>
                <td>${row.checked_at}</td>
                <td>${row.product_url ? `<a href="${row.product_url}" target="_blank" rel="noreferrer">Open</a>` : "-"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <details><summary>Raw product matches</summary><pre>${JSON.stringify(item.store_results, null, 2)}</pre></details>
    </article>
  `).join("");
});

document.querySelector("#manual-open").addEventListener("click", () => {
  manualPanel.classList.toggle("hidden");
});

document.querySelector("#sessions-open").addEventListener("click", async () => {
  sessionsPanel.classList.toggle("hidden");
  if (!sessionsPanel.classList.contains("hidden")) {
    await loadStoreSessions();
  }
});

document.querySelector("#diagnostics-open").addEventListener("click", () => {
  diagnosticsPanel.classList.toggle("hidden");
});

document.querySelector("#diagnostics-run").addEventListener("click", async () => {
  diagnosticsOutput.innerHTML = "Running diagnostics...";
  const query = firstItem();
  const zipCode = document.querySelector("#zip").value.trim();
  const stores = selectedStores();
  const payloads = stores.map(store => fetch("/api/debug/diagnose", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({store, query, zip_code: zipCode})
  }).then(r => r.json()));
  const diagnostics = await Promise.all(payloads);
  diagnosticsOutput.innerHTML = diagnostics.map(item => `
    <div class="session-card">
      <strong>${item.store_slug}</strong>
      <div>Search URL: ${linkify(item.search_url)}</div>
      <div>Profile: ${item.session?.profile_dir || "Not configured"}</div>
      <div>Selected store: ${item.session?.selected_store_name || item.session?.selected_store_id || "Not configured"}</div>
      <div>HTTP status: ${item.browser?.http_status || "-"}</div>
      <div>Page state: ${item.browser?.page_state || "-"}</div>
      <div>Product card selector: <code>${item.browser?.card_selector || "-"}</code></div>
      <div>Product cards found: ${item.browser?.card_count ?? "-"}</div>
      <div>HTML: ${debugLink(item.browser?.html_path) || "-"}</div>
      <div>Screenshot: ${debugLink(item.browser?.screenshot_path) || "-"}</div>
      <div class="warning">${item.error || item.api_warning || (item.session?.warnings || []).join("; ")}</div>
    </div>
  `).join("");
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(manualForm);
  const payload = Object.fromEntries(formData.entries());
  payload.in_stock = formData.get("in_stock") === "on";
  for (const key of ["price", "sale_price", "unit_price"]) {
    if (payload[key] === "") payload[key] = null;
  }
  if (payload.expires_at === "") payload.expires_at = null;
  const response = await fetch("/api/manual-prices", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });
  if (response.ok) {
    manualForm.reset();
    manualPanel.classList.add("hidden");
  } else {
    alert("Manual price could not be saved.");
  }
});

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(sessionForm);
  const payload = Object.fromEntries(formData.entries());
  for (const key of ["profile_dir", "selected_store_id", "selected_store_name", "notes"]) {
    if (payload[key] === "") payload[key] = null;
  }
  const response = await fetch("/api/store-sessions", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload)
  });
  if (response.ok) {
    sessionForm.reset();
    await loadStoreSessions();
  } else {
    alert("Store session could not be saved.");
  }
});
