#!/usr/bin/env node
// Guarded launcher for the sibling Walmart scraper service.
//
// The scraper is a SEPARATE repo (default sibling `../walmart-scraper`) that the
// backend talks to over HTTP. This wrapper lets `npm run dev` bring it up alongside
// backend + frontend WITHOUT making it a hard dependency: if the directory is missing
// or its deps aren't installed, we print a single clear warning and exit cleanly so
// concurrently keeps backend + frontend running. Manual price entry never needs it.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
// Default to the sibling `../walmart-scraper`; allow an explicit override so a
// different on-disk layout still works.
const scraperDir = process.env.WALMART_SCRAPER_DIR
  ? resolve(process.env.WALMART_SCRAPER_DIR)
  : resolve(repoRoot, "..", "walmart-scraper");

function warn(message) {
  console.warn(`[scraper] ${message}`);
}

if (!existsSync(scraperDir)) {
  warn(`skipped: no scraper at ${scraperDir} (set WALMART_SCRAPER_DIR or clone ../walmart-scraper). App runs without it; manual entry unaffected.`);
  process.exit(0);
}

if (!existsSync(resolve(scraperDir, "node_modules"))) {
  warn(`skipped: deps not installed in ${scraperDir}. Run \`npm install\` there once (or \`npm run setup:scraper\`). App runs without it.`);
  process.exit(0);
}

warn(`starting from ${scraperDir} (npm run api)`);
const child = spawn("npm", ["run", "api"], {
  cwd: scraperDir,
  stdio: "inherit",
  shell: process.platform === "win32"
});

child.on("error", (err) => {
  // Never take the dev group down if launching the scraper fails.
  warn(`failed to start: ${err.message}. App continues without the scraper.`);
  process.exit(0);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});

// Relay termination so Ctrl-C / concurrently shutdown stops the scraper too.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
