# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Backend error handling

The global Fastify error handler in `backend/src/server.ts` sanitizes unexpected failures: any unhandled 5xx-class error is logged server-side via `request.log.error` and returned to the client as a generic `{ error: "Internal server error" }`, so absolute source paths, stack traces, and ORM internals never leak.
Two behaviors are preserved deliberately: the friendly "database not running" message for `Can't reach database server`, and any error carrying a 4xx `statusCode` (Fastify schema validation, or an error a route raised with an explicit status) passes through with its own message and status - real 4xx responses are never collapsed into 500s.
Even with this net, route handlers must still map expected "resource not found / not owned" cases explicitly, e.g. `findFirst` + `if (!row) return reply.status(404).send({ error: "..." })`, so clients get a meaningful 404 rather than a generic 500.
Do not use `findUniqueOrThrow` for request-scoped lookups: its `P2025` is a 5xx and would now surface only as the generic message.

## Workspaces and dependency hygiene

The root `workspaces` array is `["backend","frontend","mcp-server"]` and the root `build` script compiles all three (`mcp-server` is package `grocery-mcp`, built with `tsc`).
Workspace members do not carry their own `package-lock.json`: the single root lockfile governs every workspace, so do not commit a nested lock inside `backend/`, `frontend/`, or `mcp-server/`.

`npm audit` intentionally still reports the dev-only `vite` / `vitest` / `vite-node` / `@vitest/mocker` / `esbuild` chain (currently 3 moderate + 1 high + 1 critical rolled-up).
These are cleared only by the breaking `vitest@4` upgrade, which is a deliberately separate task - do NOT run `npm audit fix --force` to silence them, as that bumps vitest/vite/esbuild and can break the test setup.
Plain `npm audit fix` (non-breaking) is fine and already cleared the `shell-quote` (critical, via `concurrently`) and `@babel/core` (high) advisories.

## Frontend tests

The frontend now has its own Vitest suite (`frontend` package `test` script = `vitest run`, config under `test` in `frontend/vite.config.ts`, node environment, `src/**/*.test.ts`).
The root `npm test` runs both workspaces: `npm run test --workspace backend && npm run test --workspace frontend`.
Vitest is a shared dev tool already in the tree; it lives in the root lockfile (no nested lock under `frontend/`).

## Pasted grocery-list search (Find Products)

`frontend/src/lib/parseGroceryList.ts` turns free-text grocery lists into structured `ParsedGroceryItem` objects (`name`, optional `category`/`quantity`/`alternatives`/`notes`).
It strips list numbering/bullets, pulls a trailing-comma quantity ("18 count", "4-5 lb", "large tub"), and splits OR-groups three ways: plain `A or B`, Oxford `A, B, or C` (full options), and `noun, mod or mod` (expands to `mod noun` options, e.g. "Berries, fresh or frozen" -> "fresh berries"/"frozen berries"). Lines ending in `:` are section headers and tag following items as `category`; `isExtraItem` flags the drinks/extras section. Keep its tests (`parseGroceryList.test.ts`) as the source of truth - that is the highest-value test surface for this feature.
`frontend/src/components/GroceryListSearch.tsx` (embedded in `FindProductsPage`) runs each item + alternatives through the existing `GET /api/:provider/products/search`, groups results by item, and "Add picks" reuses the existing `POST /api/:provider/import` then `POST /api/lists/:id/items` so picks become real list items. Per-item search failures are caught individually so one item never aborts the others. Fry's is the Kroger provider at a Fry's store - no separate Fry's path exists or should be added.
Shared product-match helpers (`tokenize`/`suggestItem`/`guessUnit`) live in `frontend/src/lib/productMatch.ts`, used by both the single-term search and the grouped list search.

## Frontend bundle size (Three.js / Vanta)

Three.js + Vanta.js are heavy (~625 kB combined) and power only the visual-only fog in `frontend/src/components/VantaBackground.tsx`.
They MUST be pulled in via dynamic `import()` inside the component's effect, never as static top-level imports.
Static imports pull Three into the main entry chunk (~924 kB, over Vite's 500 kB advisory); the dynamic import keeps the entry chunk ~298 kB and emits Three/Vanta as separate async chunks that load after first paint.
The remaining Vite size warning refers only to the deferred `three.module` vendor chunk, which is inherent to Three.js and not the blocking entry chunk.
