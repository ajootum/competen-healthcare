/* eslint-disable @typescript-eslint/no-explicit-any */
import { createResource, newVersion, publishVersion, retireVersion, reviewDraft, setCompetencies, submitDraft } from "./educator";
import { listProgrammesForHq } from "@/lib/individual/programme-admin";

// ── HQ QUESTION LIBRARY: PICKER OPTIONS AND BULK ACTIONS ── SQIE-CLOSE-2026-11 WS-E (owner directive s4) ──────────────────
//
// THE COMPETENCY PICKER. A library question names the competencies it teaches (ckri_knowledge_version_competency, 442).
// Educators used to type CFCA ids. They now pick from the PUBLISHED controlled catalogues (394: a shared framework,
// hospital_id null, pub_status published, its competency_catalogue_entry rows) -- the same catalogues Scholar learners are
// matched against -- and, as DRAFT mappings (owner decision 3), from shared frameworks still pending publication. The educator
// route refuses any other id, so a typed or stale id cannot slip in.
// THE PROGRAMMES. individual_scholar_programme (387) codes and labels, the configuration learners choose from, read through
// the existing HQ programme reader.
// BULK ACTIONS. Submit, start a replacement version, retire: each item goes through the SAME single-item function
// (educator.ts) with every check it has, and is reported on its own. Nothing is skipped because it is one of many, and
// one refusal never stops the others. Separation of duties is the database's (442, 640): bulk changes nobody's role.

/** `pending`: the competency's shared framework is not published yet (owner decision 3: a DRAFT mapping is allowed, never shown as evidence). */
export type CompetencyOption = { id: string; title: string; code: string | null; catalogue: string; pending?: boolean };
export type ProgrammeOption = { code: string; label: string; level: string | null };

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

/**
 * The competencies an educator may map a question to: every published controlled catalogue's (394 entries), then -- owner
 * decision 3, "permit draft mappings where publication is pending" -- the competencies of shared frameworks that are still
 * draft, in review or approved, marked `pending`. A pending mapping is shown as a draft everywhere and never as evidence;
 * Scholar learners link only to published catalogues, so it reaches no learner until the framework is published.
 * null: unreadable.
 */
export async function loadCompetencyOptions(admin: any): Promise<CompetencyOption[] | null> {
  const fws = await rows(admin.from("frameworks").select("id, name, code, pub_status").is("hospital_id", null).in("pub_status", ["published", "draft", "in_review", "approved"]).limit(500));
  if (fws === null) return null;
  const published = fws.filter((f: any) => f.pub_status === "published"), pending = fws.filter((f: any) => f.pub_status !== "published");
  const fwName = new Map<string, string>(fws.map((f: any): [string, string] => [String(f.id), String(f.code ? `${f.name} (${f.code})` : f.name ?? "Framework")]));
  const out: CompetencyOption[] = [];
  const seen = new Set<string>();
  if (published.length) {
    const entries = await rows(admin.from("competency_catalogue_entry").select("catalogue_id, competency_id, sort_order").in("catalogue_id", published.map((f: any) => f.id)).limit(10000));
    if (entries === null) return null;
    const comps = await competencies(admin, [...new Set<string>(entries.map((e: any) => String(e.competency_id)))]);
    if (comps === null) return null;
    for (const e of [...entries].sort((a: any, b: any) => fwName.get(a.catalogue_id)!.localeCompare(fwName.get(b.catalogue_id)!) || (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
      const c = comps.get(e.competency_id);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, title: String(c.name ?? c.id), code: c.code ?? null, catalogue: fwName.get(e.catalogue_id)! });
    }
  }
  if (pending.length) {
    const domains = await rows(admin.from("framework_domains").select("id, framework_id").in("framework_id", pending.map((f: any) => f.id)).limit(5000));
    if (domains === null) return null;
    const fwOf = new Map<string, string>(domains.map((d: any): [string, string] => [String(d.id), String(d.framework_id)]));
    const list = domains.length ? await rows(admin.from("framework_competencies").select("id, name, code, domain_id").in("domain_id", [...fwOf.keys()]).limit(5000)) : [];
    if (list === null) return null;
    for (const c of [...list].sort((a: any, b: any) => fwName.get(fwOf.get(a.domain_id)!)!.localeCompare(fwName.get(fwOf.get(b.domain_id)!)!) || String(a.code ?? a.name).localeCompare(String(b.code ?? b.name)))) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, title: String(c.name ?? c.id), code: c.code ?? null, catalogue: `${fwName.get(fwOf.get(c.domain_id)!)} -- not published (draft mapping)`, pending: true });
    }
  }
  return out;
}

async function competencies(admin: any, ids: readonly string[]): Promise<Map<string, any> | null> {
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    const c = await rows(admin.from("framework_competencies").select("id, name, code").in("id", ids.slice(i, i + 300)));
    if (c === null) return null;
    for (const x of c) out.set(x.id, x);
  }
  return out;
}

/**
 * Active Scholar programmes (387), by label, from the existing HQ programme reader (programme-admin.ts listProgrammesForHq):
 * this library names no Scholar table itself (CKRI harness K1-7). null: unreadable.
 */
export async function loadProgrammeOptions(admin: any): Promise<ProgrammeOption[] | null> {
  const r = await listProgrammesForHq(admin);
  return r.ok ? r.programmes.filter(p => p.is_active).map(p => ({ code: p.code, label: p.label ?? p.code, level: p.level ?? null })) : null;
}

/** Pure. The ids a picker may save: in the published options, distinct, at most 20. The rest are named back. */
export function pickableCompetencies(ids: readonly string[], options: readonly CompetencyOption[]): { ok: string[]; refused: string[] } {
  const allowed = new Set(options.map(o => o.id));
  const want = [...new Set(ids.map(x => x.trim()).filter(Boolean))];
  return { ok: want.filter(i => allowed.has(i)).slice(0, 20), refused: want.filter(i => !allowed.has(i)) };
}

export const BULK_ACTIONS = ["bulk_submit", "bulk_replace", "bulk_retire", "bulk_publish"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const BULK_MAX = 50;
export type BulkResult = { id: string; ok: boolean; error?: string; versionId?: string };

/**
 * Pure. The ids of a bulk request: distinct uuids, at most BULK_MAX, or the reason none can be acted on. A request over
 * the cap is refused whole (never silently cut), so what is acted on is exactly what was chosen.
 */
export function bulkIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = [...new Set((Array.isArray(raw) ? raw : []).filter((x): x is string => typeof x === "string" && UUID.test(x)))];
  if (!ids.length) return { ok: false, error: "Choose at least one question." };
  if (ids.length > BULK_MAX) return { ok: false, error: `Choose at most ${BULK_MAX} questions at a time.` };
  return { ok: true, ids };
}

/**
 * One bulk action, item by item through the single-item functions:
 *   bulk_submit   version ids of drafts: submitDraft (shape, rights, likely duplicates, educator review, 442 submission)
 *   bulk_replace  resource ids: newVersion (a draft copied from the latest; the published one stays in use until the new
 *                 one is approved and published, which supersedes it)
 *   bulk_retire   version ids of published versions: retireVersion with the one reason (801, publisher only)
 *   bulk_publish  version ids of approved versions: publishVersion (shape, rights, then 442 publication -- approval of the
 *                 exact content, hq.quality.knowledge.publish and the 640 independence of the publisher, in the database)
 */
export async function runBulk(admin: any, me: string, action: BulkAction, ids: readonly string[], reason = ""): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const id of ids) {
    const r: any = action === "bulk_submit" ? await submitDraft(admin, me, id)
      : action === "bulk_replace" ? await newVersion(admin, me, id)
      : action === "bulk_publish" ? await publishVersion(admin, me, id)
      : await retireVersion(admin, me, id, reason);
    out.push(r?.ok ? { id, ok: true, ...(r.versionId ? { versionId: r.versionId } : {}) } : { id, ok: false, error: r?.error ?? "That could not be done." });
  }
  return out;
}

/**
 * Bulk educator review: each version id goes through reviewDraft, the function the single "I have reviewed this content"
 * click uses (the ckri_knowledge_review RPC, which enforces the educator, the draft and the content hash). Same cap as the
 * other bulk actions; a refusal is reported for that item and never undoes or stops the others.
 */
export async function runBulkReview(admin: any, me: string, ids: readonly string[]): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const id of ids) {
    const r: any = await reviewDraft(admin, me, id);
    out.push(r?.ok ? { id, ok: true } : { id, ok: false, error: r?.error ?? "That could not be done." });
  }
  return out;
}

// ── BULK DRAFT IMPORT (owner decision 4 Nov, item 2: the pilot batch) ──
//
// Many library DRAFTS at once, each exactly as the single "New resource" makes it: the same content builder and validator
// (checkedContent via createResource), then its competencies through the picker's list (published catalogues, or draft
// mappings from frameworks pending publication). Nothing is reviewed, submitted, approved or published by an import:
// every draft then goes through educator review, independent clinical approval and authorised publication like any other.
// An AI-assisted batch records origin ai_draft with its model and prompt version. One item's refusal never stops the rest.

export const IMPORT_MAX = 100;
export type ImportItem = { code: string; title: string; fields: Record<string, unknown>; competencyIds?: string[] };
export type ImportResult = { code: string; ok: boolean; error?: string; resourceId?: string; versionId?: string; competencies?: number };

/** Pure. The items of an import request, or the reason it cannot be read. Over the cap is refused whole. */
export function importItems(raw: unknown): { ok: true; items: ImportItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: "Give at least one question to import." };
  if (raw.length > IMPORT_MAX) return { ok: false, error: `Import at most ${IMPORT_MAX} questions at a time.` };
  const items: ImportItem[] = [];
  for (const [i, x] of raw.entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const code = typeof o.code === "string" ? o.code.trim() : "", title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
    if (!code || !title || !o.fields || typeof o.fields !== "object" || Array.isArray(o.fields)) return { ok: false, error: `Item ${i + 1}: give its code, title and fields.` };
    items.push({ code, title, fields: o.fields as Record<string, unknown>, competencyIds: Array.isArray(o.competencyIds) ? o.competencyIds.filter((c): c is string => typeof c === "string").slice(0, 20) : [] });
  }
  if (new Set(items.map(i => i.code)).size !== items.length) return { ok: false, error: "Each imported question needs its own code." };
  return { ok: true, items };
}

/** Pure. The AI provenance of an import, or null (educator-written). Model and prompt version both required when given. */
export function importProvenance(raw: unknown): { model: string; prompt_version: string } | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const model = typeof o.model === "string" ? o.model.trim().slice(0, 120) : "", pv = typeof o.prompt_version === "string" ? o.prompt_version.trim().slice(0, 120) : "";
  return model && pv ? { model, prompt_version: pv } : "invalid";
}

export async function importDrafts(admin: any, me: string, items: readonly ImportItem[], ai: { model: string; prompt_version: string } | null, options: readonly CompetencyOption[]): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const it of items) {
    const pick = pickableCompetencies(it.competencyIds ?? [], options);
    if (pick.refused.length) { out.push({ code: it.code, ok: false, error: `${pick.refused.length} of its competencies are in no catalogue or framework that can be mapped.` }); continue; }
    const r = await createResource(admin, me, { code: it.code, kind: "revision_question", title: it.title, needId: null, fields: it.fields, ai });
    if (!r.ok) { out.push({ code: it.code, ok: false, error: r.error }); continue; }
    const c = pick.ok.length ? await setCompetencies(admin, r.versionId, pick.ok) : { ok: true as const };
    out.push(c.ok ? { code: it.code, ok: true, resourceId: r.resourceId, versionId: r.versionId, competencies: pick.ok.length }
      : { code: it.code, ok: false, error: `Draft created, but its competencies were not saved: ${c.error}`, resourceId: r.resourceId, versionId: r.versionId });
  }
  return out;
}
