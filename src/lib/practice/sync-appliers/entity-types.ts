// The entity types the sync engine can apply. ⚠ CONSTANTS ONLY, AND THIS FILE MUST NEVER IMPORT.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ WHY THIS FILE EXISTS AT ALL, AND IT IS A BUG THAT REACHED A RUNNING SERVER ON 2026-08-11.
//
// `MEASUREMENT_ENTITY_TYPE` lived in parameter-measurement.ts beside its applier, which is the obvious
// place for it. `offline-capture.ts` is a "use client" module and imported the constant from there --
// one string, nothing else.
//
// But an import pulls the whole MODULE, not the binding: parameter-measurement.ts imports
// `recordMeasurement` from parameters.ts, which imports access.ts, which imports `next/headers`. So the
// offline page's client bundle transitively required a server-only API and BOTH /practice/offline and the
// parameters route answered 500.
//
// ⚠ tsc WAS CLEAN. eslint WAS CLEAN. Every harness was green. The page was dead. That is the exact
// failure this repository's own comments say it has already lost a board to -- "clean tsc, clean eslint,
// clean harness, dead page" -- and it recurred because a CONSTANT looked too small to be dangerous.
//
// ⚠ THE RULE: a value shared between a client module and a server module lives in a file that imports
// NOTHING. Not "imports carefully" -- imports nothing, so there is no graph to reason about.
//
// It stays inside sync-appliers/ so the sync harness's producer scan still finds it: that assertion reads
// every `export const *_ENTITY_TYPE` in this directory and requires a capture path to reference each one.

/**
 * ⚠ APPEND-ONLY. practice_parameter_measurement is never updated (parameters.ts:41), which is why this
 * was the first entity capture crossed the line for -- an edit-vs-edit conflict is structurally
 * impossible, so the deliberately-unbuilt auto-merge never engages.
 */
export const MEASUREMENT_ENTITY_TYPE = "parameter_measurement";
