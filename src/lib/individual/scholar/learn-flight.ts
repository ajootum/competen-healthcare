// SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct): THE LEARN ROUTE'S STAGE TIMINGS, IN-FLIGHT DEDUPE AND SERVED RECORD.
// No new table and no migration: everything here is an audit_log row (the existing trail), never the lesson's text.
//
// IN-FLIGHT DEDUPE. Before a reusable Learn answer (one with an artefact key) is generated, the request writes a start
// row (action LEARN_FLIGHT_ACTION, new_value { phase: "start", dedupe_key }) and then reads the start and end rows for
// that key in the last FLIGHT_WINDOW_MS. The EARLIEST unfinished start generates; any later one is a duplicate and
// makes no AI call: it waits for the first to save its artefact (or to end) and serves that. Insert-then-read means two
// simultaneous requests both see both rows and agree on the earliest, so at most one calls the AI (a sub-millisecond
// window remains where the database's timestamps disagree with commit order -- accepted, stated). The window is read
// against the start row's own database timestamp, never the app clock. A start row is closed by an end row when the
// request ends (beside its trail, or before a refusal); a request that throws leaves its row to age out of the window.
// The action is not one the hourly AI quota counts (quota.ts AI_ACTIONS), so dedupe never spends the student's limit.
// Unreadable or unwritable trail: the request proceeds as before (dedupe is a saving, never a gate).
//
// SERVED. A lesson served from its saved artefact (no AI) writes one LEARN_SERVED_ACTION row after the response:
// cached, the dedupe key, whether a duplicate was suppressed, and the stage timings. With the generation rows
// (ai_assistant_query, which carry the same dedupe_key and `prepared`) that gives reuse, prepared-and-viewed and
// time-to-first-content without a new subsystem (docs/evidence/SCHOLAR-GUIDED-LEARNING/metrics.sql).

import { after } from "next/server";
import { currentTraceId } from "@/lib/trace";
import type { IndividualContext } from "../guard";

export const LEARN_FLIGHT_ACTION = "scholar_learn_inflight";
export const LEARN_SERVED_ACTION = "scholar_learn_served";
export const LEARN_ENTITY = "individual_scholar_learn";
/** A generation runs well inside the route's 60 s ceiling; a start row older than this is not in flight. */
export const FLIGHT_WINDOW_MS = 60_000;
/** How long a duplicate waits for the first request's lesson, and how often it looks. */
export const FLIGHT_WAIT_MS = 40_000;
export const FLIGHT_POLL_MS = 1_200;

/** Pure. Per-stage wall-clock timings for one request, in whole milliseconds, plus the total. */
export function stageTimer(now: () => number = () => performance.now()) {
  const t0 = now(), ms: Record<string, number> = {};
  let last = t0;
  const add = (stage: string, v: number) => { ms[stage] = Math.round((ms[stage] ?? 0) + v); };
  return {
    /** The time since the previous mark (or the start), charged to `stage`. */
    mark(stage: string) { const t = now(); add(stage, t - last); last = t; },
    /** A function whose own time is ALSO charged to `stage` (inside a marked stage: e.g. the AI call within generation). */
    wrap<A extends unknown[], R>(stage: string, fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
      return async (...a: A) => { const s = now(); try { return await fn(...a); } finally { add(stage, now() - s); } };
    },
    snapshot(): Record<string, number> { return { ...ms, total: Math.round(now() - t0) }; },
  };
}

/** Run after the response is sent (Next `after`); outside a request (tests, scripts) on the next tick. Never throws. */
export function later(fn: () => Promise<unknown> | unknown): void {
  const run = async () => { try { await fn(); } catch { /* the trail is best effort */ } };
  try { after(run); } catch { void Promise.resolve().then(run); }
}

type Row = { id: string; created_at: string; new_value: { phase?: string; flight?: string; outcome?: string } | null };
export type Flight = { claimed: true; id: string | null } | { claimed: false; id: string; other: string; since: string };

async function trail(ctx: IndividualContext, entityId: string | null, value: Record<string, unknown>): Promise<{ id: string; created_at: string } | null> {
  try {
    const { data, error } = await ctx.admin.from("audit_log").insert({
      trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.profile.fullName,
      action: LEARN_FLIGHT_ACTION, entity_type: LEARN_ENTITY, entity_id: entityId, new_value: value,
    }).select("id, created_at").single();
    return error || !data ? null : data;
  } catch { return null; }
}

async function rowsFor(ctx: IndividualContext, key: string, since: string): Promise<Row[] | null> {
  try {
    const { data, error } = await ctx.admin.from("audit_log").select("id, created_at, new_value")
      .eq("actor_id", ctx.userId).eq("action", LEARN_FLIGHT_ACTION).eq("new_value->>dedupe_key", key).gte("created_at", since)
      .order("created_at", { ascending: true }).limit(50);
    return error ? null : (data ?? []) as Row[];
  } catch { return null; }
}

/** Pure. The unfinished start rows earlier than `mine` (by database time, then id). */
export function earlierInFlight(rows: readonly Row[], mine: { id: string; created_at: string }): Row[] {
  const ended = new Set(rows.filter(r => r.new_value?.phase === "end" && r.new_value.flight).map(r => r.new_value!.flight!));
  const before = (r: Row) => r.created_at < mine.created_at || (r.created_at === mine.created_at && r.id < mine.id);
  return rows.filter(r => r.new_value?.phase === "start" && r.id !== mine.id && !ended.has(r.id) && before(r));
}

const sinceOf = (iso: string) => new Date(new Date(iso).getTime() - FLIGHT_WINDOW_MS).toISOString();

/** Claim the generation of this key, or learn that an earlier identical request holds it. */
export async function claimFlight(ctx: IndividualContext, key: string, meta: { sessionId: string | null; step: number; action: string; prepared: boolean }): Promise<Flight> {
  const mine = await trail(ctx, meta.sessionId, { phase: "start", dedupe_key: key, step: meta.step, action: meta.action, prepared: meta.prepared });
  if (!mine) return { claimed: true, id: null };
  const rows = await rowsFor(ctx, key, sinceOf(mine.created_at));
  const other = rows ? earlierInFlight(rows, mine)[0] : undefined;
  if (!other) return { claimed: true, id: mine.id };
  // A duplicate holds nothing: its own row is closed at once, so it never blocks a later request.
  await trail(ctx, meta.sessionId, { phase: "end", dedupe_key: key, flight: mine.id, outcome: "duplicate" });
  return { claimed: false, id: mine.id, other: other.id, since: sinceOf(mine.created_at) };
}

/** Close a claimed flight with what came of it (after the response). */
export async function endFlight(ctx: IndividualContext, flight: Flight | null, key: string, sessionId: string | null, outcome: string): Promise<void> {
  if (!flight?.claimed || !flight.id) return;
  await trail(ctx, sessionId, { phase: "end", dedupe_key: key, flight: flight.id, outcome });
}

/** Whether any request is generating this key now (read only, app clock: an approximation used only to inform). */
export async function flightActive(ctx: IndividualContext, key: string): Promise<boolean> {
  const rows = await rowsFor(ctx, key, new Date(Date.now() - FLIGHT_WINDOW_MS).toISOString());
  if (!rows) return false;
  const ended = new Set(rows.filter(r => r.new_value?.phase === "end" && r.new_value.flight).map(r => r.new_value!.flight!));
  return rows.some(r => r.new_value?.phase === "start" && !ended.has(r.id));
}

/**
 * A duplicate waits for the first request: its saved artefact (served), its end (what came of it, when nothing was
 * saved), or the wait running out. No AI call either way. `sleep` is injectable for tests.
 */
export async function waitForFlight<T>(ctx: IndividualContext, key: string, flight: Extract<Flight, { claimed: false }>, findSaved: () => Promise<T | null>,
  opts: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ saved: T } | { ended: string } | { timedOut: true }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const deadline = Date.now() + (opts.waitMs ?? FLIGHT_WAIT_MS);
  for (;;) {
    const [saved, rows] = await Promise.all([findSaved(), rowsFor(ctx, key, flight.since)]);
    if (saved) return { saved };
    const end = rows?.find(r => r.new_value?.phase === "end" && r.new_value.flight === flight.other);
    if (end) return { ended: end.new_value?.outcome ?? "ended" };
    if (Date.now() >= deadline) return { timedOut: true };
    await sleep(opts.pollMs ?? FLIGHT_POLL_MS);
  }
}

/** The learner-facing words for a salvaged lesson (SCHOLAR-GUIDED-LEARNING-01). */
export const SALVAGE_NOTE = "Some statements were left out because your notes don't support them.";
/** A saved salvaged lesson keeps how many parts were left out in its provenance, so reopening it says so too. */
export const salvagedPromptVersion = (promptVersion: string, removed: number) => `${promptVersion}+partial:${removed}`;
export const salvagedCount = (promptVersion: string): number | null => { const m = /\+partial:(\d+)$/.exec(promptVersion); return m ? Number(m[1]) : null; };
export const DUPLICATE_WITHHELD = "Scholar has just tried this lesson and could not show it from your notes. Try again, or choose wider sources where they are offered.";
export const DUPLICATE_IN_FLIGHT = "This lesson is still being written. Open it again in a moment.";
export const DUPLICATE_RETRY = "Scholar could not write this lesson just now. Try again.";
