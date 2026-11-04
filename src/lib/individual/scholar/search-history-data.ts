// ── SCHOLAR-SEARCH-HISTORY-01: MY SEARCH HISTORY, THE READS AND WRITES ── migration 992 ──
//
// Server only. Every statement is keyed on the caller's own id from the Individual guard (never a request's), through
// the service role, and 992's composite foreign keys refuse a reference to another learner's material, saved teaching
// or lesson. The model is search-history.ts. NO AI anywhere, and nothing here is read by Personal AI, Professional, an
// employer, an educator or the HQ plane (search-history.test.ts holds the list of files that may name the table, and the
// plane-boundary scan refuses it on the HQ plane). Writes are idempotent: one row per (learner, request key).
//
// FAILS CLOSED WITHOUT 992. historySchema() is false while the list function is missing: the page says the history is
// not available yet and the route answers 409 (or, for a capture, keeps nothing).

import { isNotProvisioned } from "../access";
import type { Read } from "./store";
import {
  HISTORY_ACTIVITIES, HISTORY_PAGE_SIZE, markKey, repeatsLatest,
  type CaptureInput, type EntryRef, type HistoryActivity, type HistoryEntry, type HistoryQuery,
} from "./search-history";
import { rangeBounds } from "./saved-library";

type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const TABLE = "individual_scholar_search_history";
const LIST = "individual_scholar_search_history_list";
const CLEAR = "individual_scholar_search_history_clear";
const NIL = "00000000-0000-0000-0000-000000000000";
const isMissingRpc = (error: any) => isNotProvisioned(error) || String(error?.code ?? "") === "42883"; // eslint-disable-line @typescript-eslint/no-explicit-any

let schema992: boolean | null = null;
/** True once 992's list function answers. Missing is remembered; a transient error is "no" for now and asked again. */
export async function historySchema(admin: Admin): Promise<boolean> {
  if (schema992 !== null) return schema992;
  const { error } = await admin.rpc(LIST, { p_user_id: NIL, p_query: null, p_activity: null, p_material: null, p_topic: null, p_from: null, p_to: null, p_pinned: false, p_limit: 1, p_offset: 0 });
  if (!error) return (schema992 = true);
  if (isMissingRpc(error)) return (schema992 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetHistorySchema = (v: boolean | null = null) => { schema992 = v; };

/* eslint-disable @typescript-eslint/no-explicit-any */
const toEntry = (r: any): HistoryEntry => ({
  key: String(r.entry_key), origin: r.origin === "captured" ? "captured" : "recovered",
  activity: ((HISTORY_ACTIVITIES as readonly string[]).includes(r.activity) ? r.activity : "teaching") as HistoryActivity,
  query: r.query ?? null, topic: r.topic ?? null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null, artefactId: r.artefact_id ?? null,
  sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null, resultCount: Number.isInteger(r.result_count) ? r.result_count : null,
  label: String(r.label ?? ""), headline: r.headline ?? null, pinnedAt: r.pinned_at ?? null, createdAt: String(r.created_at),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** One page of the caller's history, newest first, with the total that matches. */
export async function listHistory(admin: Admin, userId: string, q: HistoryQuery, opts: { pinnedOnly?: boolean; limit?: number } = {}): Promise<Read<{ entries: HistoryEntry[]; total: number }>> {
  if (!(await historySchema(admin))) return { ok: false, notProvisioned: true };
  const { fromIso, toIso } = rangeBounds(q.from, q.to);
  const limit = Math.min(Math.max(opts.limit ?? HISTORY_PAGE_SIZE, 1), 50);
  const { data, error } = await admin.rpc(LIST, {
    p_user_id: userId, p_query: q.q || null, p_activity: q.activity, p_material: q.material, p_topic: q.topic,
    p_from: fromIso, p_to: toIso, p_pinned: opts.pinnedOnly ?? q.pinned, p_limit: limit, p_offset: opts.pinnedOnly ? 0 : (q.page - 1) * limit,
  });
  if (error) { if (isMissingRpc(error)) schema992 = false; return { ok: false, notProvisioned: isMissingRpc(error) }; }
  const rows = (data ?? []) as unknown[];
  return { ok: true, data: { entries: rows.map(toEntry), total: Number((rows[0] as { total?: unknown } | undefined)?.total ?? 0) } };
}

/** The topics the caller's history can be filtered by: the topics of their captured entries and of their lessons. */
export async function historyTopics(admin: Admin, userId: string): Promise<string[]> {
  const [h, s] = await Promise.all([
    admin.from(TABLE).select("topic").eq("user_id", userId).eq("origin", "captured").not("topic", "is", null).limit(1000),
    admin.from("individual_scholar_learning_session").select("topic").eq("user_id", userId).not("topic", "is", null).limit(1000),
  ]);
  const seen = new Map<string, string>();
  for (const r of [...((h.data ?? []) as { topic: string }[]), ...((s.data ?? []) as { topic: string }[])]) {
    const t = String(r.topic ?? "").trim();
    if (t.length >= 2 && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 200);
}

export type CaptureOutcome = "kept" | "existing" | "repeat" | "not_provisioned" | "error";

/**
 * Keep one submitted search or question. References that are not the caller's own are DROPPED (no disclosure, nothing
 * stored about them). The topic is the request's, else the lesson's. Idempotent: a retry with the same key is "existing";
 * the same words of the same activity within two minutes are "repeat" (one entry).
 */
export async function recordCapture(admin: Admin, userId: string, e: CaptureInput, nowIso: string): Promise<CaptureOutcome> {
  if (!(await historySchema(admin))) return "not_provisioned";
  const [session, material, chunk, artefact, latest] = await Promise.all([
    e.sessionId ? admin.from("individual_scholar_learning_session").select("id, topic").eq("user_id", userId).eq("id", e.sessionId).maybeSingle() : null,
    e.materialId ? admin.from("individual_scholar_material").select("id").eq("user_id", userId).eq("id", e.materialId).maybeSingle() : null,
    e.chunkId ? admin.from("individual_scholar_chunk").select("id, material_id").eq("user_id", userId).eq("id", e.chunkId).maybeSingle() : null,
    e.artefactId ? admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("id", e.artefactId).maybeSingle() : null,
    admin.from(TABLE).select("activity, query, created_at, request_key").eq("user_id", userId).eq("origin", "captured").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (latest?.error && isNotProvisioned(latest.error)) { schema992 = false; return "not_provisioned"; }
  const last = latest?.data as { activity: string; query: string | null; created_at: string; request_key: string } | null;
  if (last?.request_key === e.requestKey) return "existing";
  if (repeatsLatest(last ? { activity: last.activity, query: last.query, createdAt: last.created_at } : null, e, nowIso)) return "repeat";
  const s = session?.data as { id: string; topic: string | null } | null;
  const c = chunk?.data as { id: string; material_id: string } | null;
  const materialId = (material?.data as { id: string } | null)?.id ?? c?.material_id ?? null;
  const topic = e.topic ?? (s?.topic && s.topic.trim().length >= 2 ? s.topic.trim().slice(0, 120) : null);
  const row = {
    user_id: userId, origin: "captured", activity: e.activity, query: e.query, topic, material_id: materialId,
    chunk_id: c?.id ?? null, artefact_id: (artefact?.data as { id: string } | null)?.id ?? null, session_id: s?.id ?? null,
    step: s ? e.step : null, result_count: e.resultCount, request_key: e.requestKey,
  };
  const { data, error } = await admin.from(TABLE).upsert(row, { onConflict: "user_id,request_key", ignoreDuplicates: true }).select("id");
  if (error) { if (isNotProvisioned(error)) schema992 = false; return isNotProvisioned(error) ? "not_provisioned" : "error"; }
  return (data ?? []).length ? "kept" : "existing";
}

type Change = "ok" | "not_found" | "error";

/** Is the recovered record the caller's own (current saved teaching, or a lesson)? */
async function ownsRecord(admin: Admin, userId: string, ref: { kind: "artefact" | "lesson"; id: string }): Promise<boolean | null> {
  const { data, error } = ref.kind === "artefact"
    ? await admin.from("individual_scholar_artefact").select("id").eq("user_id", userId).eq("id", ref.id).maybeSingle()
    : await admin.from("individual_scholar_learning_session").select("id").eq("user_id", userId).eq("id", ref.id).maybeSingle();
  return error ? null : !!data;
}
const markRow = (userId: string, ref: { kind: "artefact" | "lesson"; id: string }) => ({
  user_id: userId, origin: "recovered", activity: ref.kind === "artefact" ? "teaching" : "lesson",
  artefact_id: ref.kind === "artefact" ? ref.id : null, session_id: ref.kind === "lesson" ? ref.id : null, request_key: markKey(ref),
});

/** Pin or unpin one entry. A recovered record is pinned by a mark (created on demand, removed again when nothing is left on it). */
export async function setPinned(admin: Admin, userId: string, ref: EntryRef, pinned: boolean, nowIso: string): Promise<Change> {
  if (ref.kind === "captured") {
    const { data, error } = await admin.from(TABLE).update({ pinned_at: pinned ? nowIso : null }).eq("user_id", userId).eq("origin", "captured").eq("id", ref.id).select("id");
    return error ? "error" : (data ?? []).length ? "ok" : "not_found";
  }
  const owns = await ownsRecord(admin, userId, ref);
  if (owns === null) return "error";
  if (!owns) return "not_found";
  const { data: mark, error: mErr } = await admin.from(TABLE).select("id, hidden_at").eq("user_id", userId).eq("request_key", markKey(ref)).maybeSingle();
  if (mErr) return "error";
  if (mark?.hidden_at) return "not_found";
  if (pinned) {
    const { error } = await admin.from(TABLE).upsert({ ...markRow(userId, ref), pinned_at: nowIso, hidden_at: null }, { onConflict: "user_id,request_key" });
    return error ? "error" : "ok";
  }
  if (!mark) return "ok";
  const { error } = await admin.from(TABLE).delete().eq("user_id", userId).eq("id", mark.id);
  return error ? "error" : "ok";
}

/** Remove one entry: a captured one is deleted, a recovered record is marked removed (the record itself is untouched). */
export async function removeEntry(admin: Admin, userId: string, ref: EntryRef, nowIso: string): Promise<Change> {
  if (ref.kind === "captured") {
    const { data, error } = await admin.from(TABLE).delete().eq("user_id", userId).eq("origin", "captured").eq("id", ref.id).select("id");
    return error ? "error" : (data ?? []).length ? "ok" : "not_found";
  }
  const owns = await ownsRecord(admin, userId, ref);
  if (owns === null) return "error";
  if (!owns) return "not_found";
  const { error } = await admin.from(TABLE).upsert({ ...markRow(userId, ref), pinned_at: null, hidden_at: nowIso }, { onConflict: "user_id,request_key" });
  return error ? "error" : "ok";
}

/** Clear the caller's whole history in one statement (992 clear). Returns how many entries went. */
export async function clearHistory(admin: Admin, userId: string): Promise<{ ok: true; cleared: number } | { ok: false }> {
  if (!(await historySchema(admin))) return { ok: false };
  const { data, error } = await admin.rpc(CLEAR, { p_user_id: userId });
  return error ? { ok: false } : { ok: true, cleared: Number(data ?? 0) };
}
