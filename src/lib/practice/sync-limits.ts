// Sync limits shared by the server engine and the browser uploader. ⚠ THIS FILE MUST NEVER IMPORT.
//
// ⚠ IT EXISTS FOR THE REASON sync-appliers/entity-types.ts EXISTS, and that reason cost a live 500 on
// 2026-08-11: a "use client" module importing ONE VALUE from sync-engine.ts pulls the whole module, and
// sync-engine reaches parameters.ts -> access.ts -> next/headers. tsc, eslint and every harness stayed
// green; the page was dead.
//
// ⚠ AND IT IS STILL ONE NUMBER, NOT TWO. The sync harness asserts "the batch ceiling is the engine
// constant, not a second number" -- sync-engine re-exports this, so there remains exactly one definition
// and the uploader cannot drift from the ceiling the server enforces. A client that batched 200 against a
// server that refuses above 100 would have every upload rejected WHOLE, which the route does on purpose.

/** COMP-SYNC-001 s7 is incremental: one upload must not hold a connection open indefinitely. */
export const SYNC_MAX_BATCH = 100;
