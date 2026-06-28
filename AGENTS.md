# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Backend error handling

The global Fastify error handler in `backend/src/server.ts` turns any uncaught error into a `500` whose body echoes the raw error message (except the friendly "database not running" case).
That raw message includes the absolute source path and ORM internals, so it must never be the path for an expected condition.
Route handlers must map expected "resource not found / not owned" cases explicitly, e.g. `findFirst` + `if (!row) return reply.status(404).send({ error: "..." })`.
Do not use `findUniqueOrThrow` for request-scoped lookups: its `P2025` falls through to the global handler and leaks internals.

## Workspaces and dependency hygiene

The root `workspaces` array is `["backend","frontend","mcp-server"]` and the root `build` script compiles all three (`mcp-server` is package `grocery-mcp`, built with `tsc`).
Workspace members do not carry their own `package-lock.json`: the single root lockfile governs every workspace, so do not commit a nested lock inside `backend/`, `frontend/`, or `mcp-server/`.

`npm audit` intentionally still reports the dev-only `vite` / `vitest` / `vite-node` / `@vitest/mocker` / `esbuild` chain (currently 3 moderate + 1 high + 1 critical rolled-up).
These are cleared only by the breaking `vitest@4` upgrade, which is a deliberately separate task - do NOT run `npm audit fix --force` to silence them, as that bumps vitest/vite/esbuild and can break the test setup.
Plain `npm audit fix` (non-breaking) is fine and already cleared the `shell-quote` (critical, via `concurrently`) and `@babel/core` (high) advisories.
