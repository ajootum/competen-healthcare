/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { isUuid, type Admin, type Read } from "./store";
import { linkColumns, type CreateInput, type PatchInput } from "./personal-notebook";

// ── COMPETEN-NOTEBOOK-001 P1: THE NOTEBOOK'S READS AND WRITES (migration 1000) ────────────────────────────────────────────
//
// The same table as the library's notes (820), read with the columns 1000 added. Every statement is keyed on the caller's id, and the
// composite foreign keys refuse another learner's material, session or study session. Learner text only: nothing here calls a model.
// The audit rows (in the route) hold codes only, never a note's words.

export type NotebookNote = {
  id: string; kind: "note" | "highlight" | "summary" | "bookmark"; targetKind: "free" | "material" | "section" | "lesson" | "artefact";
  title: string | null; body: string | null; quote: string | null; tags: string[]; pinnedAt: string | null; revision: number;
  /** Written through the Notebook. An older note keeps its 820 rules: it can move between targets, but it cannot be free-standing. */
  viaNotebook: boolean;
  artefactId: string | null; materialId: string | null; chunkId: string | null; sessionId: string | null; step: number | null;
  sectionLabel: string | null; sectionAnchor: string | null; capturedIn: string | null; competencyId: string | null; studyId: string | null; wasOn: string | null;
  createdAt: string; updatedAt: string;
};

const COLS = "id, kind, target_kind, title, body, quote, tags, pinned_at, revision, client_key, artefact_id, material_id, chunk_id, session_id, step, section_label, section_anchor, captured_in, competency_id, study_id, was_on, created_at, updated_at";
const toNote = (r: any): NotebookNote => ({
  id: r.id, kind: r.kind, targetKind: r.target_kind, title: r.title ?? null, body: r.body ?? null, quote: r.quote ?? null, tags: Array.isArray(r.tags) ? r.tags : [],
  pinnedAt: r.pinned_at ?? null, revision: Number(r.revision), viaNotebook: !!r.client_key,
  artefactId: r.artefact_id ?? null, materialId: r.material_id ?? null, chunkId: r.chunk_id ?? null, sessionId: r.session_id ?? null, step: Number.isInteger(r.step) ? r.step : null,
  sectionLabel: r.section_label ?? null, sectionAnchor: r.section_anchor ?? null, capturedIn: r.captured_in ?? null, competencyId: r.competency_id ?? null, studyId: r.study_id ?? null, wasOn: r.was_on ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
const fail = (error: unknown): { ok: false; notProvisioned: boolean } => ({ ok: false, notProvisioned: isNotProvisioned(error) });
const missingRpc = (error: any) => isNotProvisioned(error) || String(error?.code ?? "") === "42883";

/** At most this many notes, bookmarks and highlights per learner (the 820 limit, shared with the library's own writes). */
const NOTE_MAX = 5000;

let notebook1000: boolean | null = null;
/** Whether migration 1000 is applied on this environment. A transient error is "no" for now, and asked again. */
export async function notebookSchema(admin: Admin): Promise<boolean> {
  if (notebook1000 !== null) return notebook1000;
  const { data, error } = await admin.rpc("individual_scholar_notebook_1000");
  if (!error) return (notebook1000 = data === true);
  if (missingRpc(error)) return (notebook1000 = false);
  return false;
}
/** Tests only: forget what was detected. */
export const resetNotebookSchema = (v: boolean | null = null) => { notebook1000 = v; };

/** Policy and schema together: the one question every page, route and shell asks. Any failure is off. */
export function notebookOffered(policy: { scholarPersonalNotebook: "on" | "off"; scholarLearningLibrary: "on" | "off" }, schema: boolean): boolean {
  return policy.scholarPersonalNotebook === "on" && policy.scholarLearningLibrary === "on" && schema;
}

const ownChunk = async (admin: Admin, userId: string, materialId: string, chunkId: string): Promise<"ok" | "not_found" | "failed"> => {
  const { data, error } = await admin.from("individual_scholar_chunk").select("id").eq("user_id", userId).eq("id", chunkId).eq("material_id", materialId).maybeSingle();
  if (error) return "failed";
  return data ? "ok" : "not_found";
};

export type CreateResult =
  | { ok: true; id: string; revision: number; existing: boolean; stored?: { body: string | null; title: string | null; tags: string[] } }
  | { ok: false; error: "not_found" | "limit" | "failed" };

/**
 * The first save of a note. A retry with the same client key finds the note it already made and says what it holds, so the page can send
 * only what is newer. Never a second note.
 */
export async function createNotebookNote(admin: Admin, userId: string, n: CreateInput): Promise<CreateResult> {
  const link = n.context.link;
  if ((link.targetKind === "section" || link.targetKind === "lesson") && link.chunkId) {
    const own = await ownChunk(admin, userId, link.materialId!, link.chunkId);
    if (own !== "ok") return { ok: false, error: own };
  }
  const { count, error: cErr } = await admin.from("individual_scholar_note").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (cErr) return { ok: false, error: "failed" };
  if ((count ?? 0) >= NOTE_MAX) return { ok: false, error: "limit" };
  const row = {
    user_id: userId, kind: "note", body: n.body, quote: null, client_key: n.clientKey, title: n.title, tags: n.tags,
    ...linkColumns(link),
    section_label: n.context.sectionLabel, section_anchor: n.context.sectionAnchor, captured_in: n.context.capturedIn, study_id: n.context.studyId,
  };
  const { data, error } = await admin.from("individual_scholar_note").insert(row).select("id, revision").single();
  if (!error) return { ok: true, id: data.id, revision: Number(data.revision), existing: false };
  const code = String(error.code ?? "");
  if (code === "23505") {
    const { data: had, error: hErr } = await admin.from("individual_scholar_note").select("id, revision, body, title, tags").eq("user_id", userId).eq("client_key", n.clientKey).maybeSingle();
    if (hErr || !had) return { ok: false, error: "failed" };
    return { ok: true, id: had.id, revision: Number(had.revision), existing: true, stored: { body: had.body ?? null, title: had.title ?? null, tags: had.tags ?? [] } };
  }
  return { ok: false, error: code === "23503" ? "not_found" : "failed" };
}

export type UpdateResult =
  | { ok: true; id: string; revision: number }
  | { ok: false; error: "not_found" | "invalid" | "failed" }
  | { ok: false; error: "conflict"; current: { body: string | null; title: string | null; tags: string[]; revision: number } };

/** A change to one of the caller's notes, made from the revision they hold. A different revision changes nothing and returns the stored copy. */
export async function updateNotebookNote(admin: Admin, userId: string, id: string, p: PatchInput, now: Date = new Date()): Promise<UpdateResult> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const set: Record<string, unknown> = {};
  if (p.body !== undefined) set.body = p.body;
  if (p.title !== undefined) set.title = p.title;
  if (p.tags !== undefined) set.tags = p.tags;
  if (p.pinned !== undefined) set.pinned_at = p.pinned ? now.toISOString() : null;
  if (p.competencyId !== undefined) set.competency_id = p.competencyId;
  if (p.studyId !== undefined) set.study_id = p.studyId;
  if (p.link) {
    if ((p.link.targetKind === "section" || p.link.targetKind === "lesson") && p.link.chunkId) {
      const own = await ownChunk(admin, userId, p.link.materialId!, p.link.chunkId);
      if (own !== "ok") return { ok: false, error: own };
    }
    Object.assign(set, linkColumns(p.link), { section_label: p.sectionLabel ?? null, section_anchor: p.sectionAnchor ?? null, was_on: null });
  }
  if (!Object.keys(set).length) return { ok: false, error: "invalid" };
  const { data, error } = await admin.from("individual_scholar_note").update(set).eq("user_id", userId).eq("id", id).eq("revision", p.expectedRevision).neq("kind", "bookmark").select("id, revision");
  if (error) {
    const code = String(error.code ?? "");
    return { ok: false, error: code === "23514" ? "invalid" : code === "23503" ? "not_found" : "failed" };
  }
  if ((data ?? []).length) return { ok: true, id: data[0].id, revision: Number(data[0].revision) };
  const { data: had, error: hErr } = await admin.from("individual_scholar_note").select("kind, revision, body, title, tags").eq("user_id", userId).eq("id", id).maybeSingle();
  if (hErr) return { ok: false, error: "failed" };
  if (!had || had.kind === "bookmark") return { ok: false, error: "not_found" };
  return { ok: false, error: "conflict", current: { body: had.body ?? null, title: had.title ?? null, tags: had.tags ?? [], revision: Number(had.revision) } };
}

/** One of the caller's notes (never a bookmark, which has no words). */
export async function getNotebookNote(admin: Admin, userId: string, id: string): Promise<Read<NotebookNote | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await admin.from("individual_scholar_note").select(COLS).eq("user_id", userId).eq("id", id).neq("kind", "bookmark").maybeSingle();
  if (error) return fail(error);
  return { ok: true, data: data ? toNote(data) : null };
}

export type NotebookFilter = { pinned?: boolean; tag?: string | null; materialId?: string | null; free?: boolean };

/** The caller's notes, last changed first, or pinned first-pinned-newest. A page of `limit`, and whether there is more. */
export async function listNotebookNotes(admin: Admin, userId: string, o: NotebookFilter & { limit: number; offset?: number }): Promise<Read<{ rows: NotebookNote[]; more: boolean }>> {
  const offset = Math.max(o.offset ?? 0, 0);
  let q = admin.from("individual_scholar_note").select(COLS).eq("user_id", userId).neq("kind", "bookmark");
  if (o.pinned) q = q.not("pinned_at", "is", null);
  if (o.tag) q = q.contains("tags", [o.tag]);
  if (o.materialId && isUuid(o.materialId)) q = q.eq("material_id", o.materialId);
  if (o.free) q = q.eq("target_kind", "free");
  q = o.pinned ? q.order("pinned_at", { ascending: false }) : q.order("updated_at", { ascending: false });
  const { data, error } = await q.order("id", { ascending: false }).range(offset, offset + o.limit);
  if (error) return fail(error);
  const rows = (data ?? []) as any[];
  return { ok: true, data: { rows: rows.slice(0, o.limit).map(toNote), more: rows.length > o.limit } };
}

/** Notes written on one lesson of a session, or on any of its sections from elsewhere. Oldest first, so they read in the order they were written. */
export async function lessonNotes(admin: Admin, userId: string, o: { sessionId: string; step: number; chunkIds: readonly string[] }): Promise<Read<NotebookNote[]>> {
  if (!isUuid(o.sessionId)) return { ok: true, data: [] };
  const chunks = o.chunkIds.filter(isUuid).slice(0, 100);
  const filter = [`and(session_id.eq.${o.sessionId},step.eq.${o.step})`, ...(chunks.length ? [`chunk_id.in.(${chunks.join(",")})`] : [])].join(",");
  const { data, error } = await admin.from("individual_scholar_note").select(COLS).eq("user_id", userId).in("kind", ["note", "summary"]).or(filter).order("created_at", { ascending: true }).limit(200);
  if (error) return fail(error);
  return { ok: true, data: ((data ?? []) as any[]).map(toNote) };
}

export type NotebookHit = { note: NotebookNote; headline: string };
/** Deterministic full-text search over the caller's own notes (1000): each word as a prefix, best first. No AI. */
export async function searchNotebook(admin: Admin, userId: string, query: string, limit: number, offset: number): Promise<Read<{ hits: NotebookHit[]; total: number }>> {
  const { data, error } = await admin.rpc("individual_scholar_notebook_search", { p_user_id: userId, p_query: query.slice(0, 200), p_limit: limit, p_offset: offset });
  if (error) return fail(error);
  const found = (data ?? []) as { id: string; headline: string; total: number | string }[];
  if (!found.length) return { ok: true, data: { hits: [], total: 0 } };
  const { data: rows, error: rErr } = await admin.from("individual_scholar_note").select(COLS).eq("user_id", userId).in("id", found.map(f => f.id));
  if (rErr) return fail(rErr);
  const byId = new Map(((rows ?? []) as any[]).map(r => [r.id, toNote(r)]));
  return { ok: true, data: { total: Number(found[0].total ?? 0), hits: found.flatMap(f => { const note = byId.get(f.id); return note ? [{ note, headline: String(f.headline ?? "") }] : []; }) } };
}

/** The tags the caller has used, most used first (read from their newest notes). */
export async function notebookTags(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("individual_scholar_note").select("tags").eq("user_id", userId).neq("tags", "{}").order("updated_at", { ascending: false }).limit(1000);
  if (error) return [];
  const count = new Map<string, number>();
  for (const r of (data ?? []) as { tags: string[] }[]) for (const t of r.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 40);
}

/** Every note and highlight of the caller's, for their own export. In pages, so a large notebook is not cut off. */
export async function allNotebookNotes(admin: Admin, userId: string, max = 5000): Promise<Read<NotebookNote[]>> {
  const out: NotebookNote[] = [];
  for (let from = 0; from < max; from += 500) {
    const { data, error } = await admin.from("individual_scholar_note").select(COLS).eq("user_id", userId).neq("kind", "bookmark").order("updated_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 499);
    if (error) return fail(error);
    const rows = (data ?? []) as any[];
    out.push(...rows.map(toNote));
    if (rows.length < 500) break;
  }
  return { ok: true, data: out };
}
