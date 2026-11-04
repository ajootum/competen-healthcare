/* eslint-disable @typescript-eslint/no-explicit-any */
import { newVersion, retireVersion, submitDraft } from "./educator";

// ── HQ QUESTION LIBRARY: PICKER OPTIONS AND BULK ACTIONS ── SQIE-CLOSE-2026-11 WS-E (owner directive s4) ──────────────────
//
// THE COMPETENCY PICKER. A library question names the competencies it teaches (ckri_knowledge_version_competency, 442).
// Educators used to type CFCA ids. They now pick from the PUBLISHED controlled catalogues (394: a shared framework,
// hospital_id null, pub_status published, its competency_catalogue_entry rows) -- the same catalogues Scholar learners are
// matched against. setCompetencies (educator.ts) refuses an id that is not in one, so a typed or stale id cannot slip in.
// THE PROGRAMMES. individual_scholar_programme (387) codes and labels, the configuration learners choose from.
// BULK ACTIONS. Submit, start a replacement version, retire: each item goes through the SAME single-item function
// (educator.ts) with every check it has, and is reported on its own. Nothing is skipped because it is one of many, and
// one refusal never stops the others. Separation of duties is the database's (442, 640): bulk changes nobody's role.

export type CompetencyOption = { id: string; title: string; code: string | null; catalogue: string };
export type ProgrammeOption = { code: string; label: string; level: string | null };

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

/** The competencies of every published controlled catalogue, by catalogue then title. null: unreadable. */
export async function loadCompetencyOptions(admin: any): Promise<CompetencyOption[] | null> {
  const fws = await rows(admin.from("frameworks").select("id, name, pub_status").is("hospital_id", null).eq("pub_status", "published").limit(200));
  if (fws === null) return null;
  if (!fws.length) return [];
  const entries = await rows(admin.from("competency_catalogue_entry").select("catalogue_id, competency_id, sort_order").in("catalogue_id", fws.map((f: any) => f.id)).limit(10000));
  if (entries === null) return null;
  if (!entries.length) return [];
  const ids = [...new Set(entries.map((e: any) => e.competency_id as string))];
  const comps: any[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const c = await rows(admin.from("framework_competencies").select("id, name, code").in("id", ids.slice(i, i + 300)));
    if (c === null) return null;
    comps.push(...c);
  }
  const byId = new Map(comps.map(c => [c.id as string, c]));
  const fwName = new Map<string, string>(fws.map((f: any): [string, string] => [String(f.id), String(f.name ?? "Catalogue")]));
  const seen = new Set<string>();
  const out: CompetencyOption[] = [];
  for (const e of [...entries].sort((a: any, b: any) => fwName.get(a.catalogue_id)!.localeCompare(fwName.get(b.catalogue_id)!) || (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const c = byId.get(e.competency_id);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ id: c.id, title: String(c.name ?? c.id), code: c.code ?? null, catalogue: fwName.get(e.catalogue_id)! });
  }
  return out;
}

/** Active Scholar programmes (387), by label. null: unreadable. */
export async function loadProgrammeOptions(admin: any): Promise<ProgrammeOption[] | null> {
  const r = await rows(admin.from("individual_scholar_programme").select("code, label, level, is_active").eq("is_active", true).order("label").limit(500));
  return r === null ? null : r.map((p: any) => ({ code: String(p.code), label: String(p.label ?? p.code), level: p.level ?? null }));
}

/** Pure. The ids a picker may save: in the published options, distinct, at most 20. The rest are named back. */
export function pickableCompetencies(ids: readonly string[], options: readonly CompetencyOption[]): { ok: string[]; refused: string[] } {
  const allowed = new Set(options.map(o => o.id));
  const want = [...new Set(ids.map(x => x.trim()).filter(Boolean))];
  return { ok: want.filter(i => allowed.has(i)).slice(0, 20), refused: want.filter(i => !allowed.has(i)) };
}

export const BULK_ACTIONS = ["bulk_submit", "bulk_replace", "bulk_retire"] as const;
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
 */
export async function runBulk(admin: any, me: string, action: BulkAction, ids: readonly string[], reason = ""): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const id of ids) {
    const r: any = action === "bulk_submit" ? await submitDraft(admin, me, id)
      : action === "bulk_replace" ? await newVersion(admin, me, id)
      : await retireVersion(admin, me, id, reason);
    out.push(r?.ok ? { id, ok: true, ...(r.versionId ? { versionId: r.versionId } : {}) } : { id, ok: false, error: r?.error ?? "That could not be done." });
  }
  return out;
}
