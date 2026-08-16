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

/**
 * ⚠ A CAPTURED OFFLINE VISIT IS A PAST, COMPLETED ENCOUNTER -- the second entity (owner's order,
 * 2026-08-16: "Encounters then follow-up"). It files through fileOfflineEncounter, which inserts
 * COMPLETED directly and therefore CANNOT resume, create or disturb a live encounter -- the
 * one-active-encounter invariant only spans live statuses, and the resume-before-create path is
 * deliberately not taken: filing three-day-old notes into somebody's open consultation is the
 * hazard this entity was designed around. Create-only, so the edit-conflict surface stays closed.
 */
export const ENCOUNTER_ENTITY_TYPE = "encounter_visit";

/**
 * ⚠ ENTITY THREE (owner's order: "Encounters then follow-up"). A follow-up captured offline is a NEW
 * obligation -- create-only like the other two, so the conflict surface stays structurally closed.
 * ⚠ THE DEVICE-MINTED entityId BECOMES THE ROW ID, which is what makes the crash-between-apply-and-
 * ledger retry exact: the replay check is a primary-key lookup, not a natural-key guess.
 */
export const FOLLOWUP_ENTITY_TYPE = "follow_up";

/**
 * ⚠ ENTITY FOUR (owner: "build entity four", per docs/CPR-PAY-PBI-SURVEY-001 D1). Cash collected in
 * the field: filed at sync as CHARGE + PAYMENT against that charge, through the same billing engines
 * the online product uses -- no invoice needed, because charges establish what is due and invoices
 * only communicate it (PAY-002). Create-only, like every entity before it. The device-minted
 * entityId becomes the PAYMENT row id (the follow-up pattern); the charge half rides
 * ux_practice_charge_source with source_ref = the transaction id, so BOTH writes replay exactly.
 * ⚠ The receipt is numbered AT SYNC, never in the field -- nothing receipt-shaped may exist before
 * its number does.
 */
export const COLLECTION_ENTITY_TYPE = "field_collection";
