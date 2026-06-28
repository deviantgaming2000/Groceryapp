# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Backend error handling

The global Fastify error handler in `backend/src/server.ts` turns any uncaught error into a `500` whose body echoes the raw error message (except the friendly "database not running" case).
That raw message includes the absolute source path and ORM internals, so it must never be the path for an expected condition.
Route handlers must map expected "resource not found / not owned" cases explicitly, e.g. `findFirst` + `if (!row) return reply.status(404).send({ error: "..." })`.
Do not use `findUniqueOrThrow` for request-scoped lookups: its `P2025` falls through to the global handler and leaks internals.
