/* eslint-disable @typescript-eslint/no-explicit-any */
import { COMPETENCY_LAYERS } from "../competency/foundation";

// ── SCHOLAR PROGRAMMES, ADMINISTERED BY HQ ── COMPETEN-SCHOLAR-JOIN-01 (owner ruling CONFIGURATION) ───────────
//
// Create, edit and deactivate the study programmes Scholar offers (individual_scholar_programme, migration 387)
// and the shared catalogues each one learns against (individual_scholar_programme_framework, 387/389) -- no code.
// Called only from /api/hq/individual/programmes behind hq.individual.config.manage, the right that already
// governs the Individual policy. It is the one writer of these two tables, and every change is audited by the
// route with what it was before.
//
// ⚠ NOT A CONFIGURATION ENGINE. A programme is a ROW, not a setting: the competency mapping and every learner
// keep a typed foreign key to its code. Which programmes are OFFERED at join, their levels and the institutions
// stay in the Individual policy (WCE, src/lib/individual/policy.ts). This file only makes the rows that policy
// chooses from.
//
// ⚠ NOTHING IS DELETED. A programme learners have chosen is referenced by them and by their history (402), so a
// programme is RETIRED by deactivating it, and its code never changes. A deactivated programme is offered to
// nobody new, and keeps its name in every past record.
//
// ⚠ A CATALOGUE LINK NAMES ONLY A SHARED, ACTIVE, PUBLISHED FRAMEWORK -- checked here on write, and again on
// every read by Scholar (src/lib/individual/scholar/catalogue.ts), so a framework unpublished later offers nothing.
//
// Every rule below mirrors a CHECK in 387 or 389, so HQ is told why before the database refuses.

export const PROGRAMME_LAYERS = COMPETENCY_LAYERS;
export type ProgrammeLayer = (typeof PROGRAMME_LAYERS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINKS = 20;

export type ProgrammeInput = {
  code: string; label: string; profession: string; country: string | null; level: string | null; active: boolean;
  frameworks: { frameworkId: string; layer: ProgrammeLayer; sortOrder: number }[];
};
type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (message: string, code = "VALIDATION_ERROR", status = 400): Refusal => ({ ok: false, status, code, message });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Pure: an HQ programme body, or why it is refused. */
export function validateProgramme(body: any): ProgrammeInput | Refusal {
  const code = text(body?.code);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(code)) return refuse("The programme code is 2 to 63 lower-case letters, digits or dashes, starting with a letter or digit.");
  const label = text(body?.label);
  if (label.length < 1 || label.length > 120) return refuse("The programme name is 1 to 120 characters.");
  const profession = text(body?.profession);
  if (profession.length < 1 || profession.length > 80) return refuse("The profession is 1 to 80 characters.");
  const country = text(body?.country).toUpperCase() || null;
  if (country !== null && !/^[A-Z]{2}$/.test(country)) return refuse("The country is a two-letter code, such as UG, or blank.");
  const level = text(body?.level) || null;
  if (level !== null && level.length > 80) return refuse("The qualification level is at most 80 characters.");
  const raw: unknown[] = Array.isArray(body?.frameworks) ? body.frameworks : [];
  if (raw.length > MAX_LINKS) return refuse(`At most ${MAX_LINKS} catalogues per programme.`);
  const frameworks: ProgrammeInput["frameworks"] = []; const seen = new Set<string>();
  for (const [i, f] of raw.entries()) {
    const id = text((f as any)?.frameworkId).toLowerCase();
    const layer = (f as any)?.layer;
    if (!UUID.test(id)) return refuse("Each catalogue must be one chosen from the list.");
    if (!(PROGRAMME_LAYERS as readonly string[]).includes(layer)) return refuse(`Each catalogue needs a layer: ${PROGRAMME_LAYERS.join(", ")}.`);
    if (seen.has(id)) return refuse("A catalogue is listed twice.");
    seen.add(id); frameworks.push({ frameworkId: id, layer, sortOrder: i });
  }
  return { code, label, profession, country, level, active: body?.active !== false, frameworks };
}
export const isProgrammeRefusal = (x: ProgrammeInput | Refusal): x is Refusal => (x as any).ok === false;

export type HqProgramme = {
  code: string; label: string; profession: string; country: string | null; level: string | null; is_active: boolean;
  frameworks: { framework_id: string; layer: string; sort_order: number }[];
};

/** Every programme, active or not, with its catalogue links -- the HQ view. */
export async function listProgrammesForHq(admin: any): Promise<{ ok: true; programmes: HqProgramme[] } | { ok: false; notProvisioned: boolean }> {
  const [p, l] = await Promise.all([
    admin.from("individual_scholar_programme").select("code, label, profession, country, level, is_active").order("label").limit(500),
    admin.from("individual_scholar_programme_framework").select("programme_code, framework_id, layer, sort_order").order("sort_order").limit(5000),
  ]);
  const err = p.error ?? l.error;
  if (err) return { ok: false, notProvisioned: ["PGRST205", "42P01"].includes(String(err.code ?? "")) };
  const links = new Map<string, HqProgramme["frameworks"]>();
  for (const r of (l.data ?? []) as any[]) links.set(r.programme_code, [...(links.get(r.programme_code) ?? []), { framework_id: r.framework_id, layer: r.layer, sort_order: r.sort_order }]);
  return { ok: true, programmes: ((p.data ?? []) as any[]).map(r => ({ ...r, frameworks: links.get(r.code) ?? [] })) };
}

/**
 * Create or change one programme and replace its catalogue links. Returns the programme as it was before (null
 * when new) and after, for the audit trail.
 */
export async function saveProgramme(admin: any, p: ProgrammeInput): Promise<{ ok: true; before: HqProgramme | null; after: HqProgramme } | Refusal> {
  if (p.frameworks.length) {
    const { data, error } = await admin.from("frameworks").select("id")
      .in("id", p.frameworks.map(f => f.frameworkId)).is("hospital_id", null).eq("is_active", true).eq("pub_status", "published");
    if (error) return refuse("The catalogues could not be checked just now. Nothing has changed.", "UNAVAILABLE", 503);
    const okIds = new Set(((data ?? []) as any[]).map(r => String(r.id).toLowerCase()));
    if (p.frameworks.some(f => !okIds.has(f.frameworkId))) return refuse("Only shared, active, published catalogues can be linked.", "VALIDATION_ERROR", 422);
  }

  const all = await listProgrammesForHq(admin);
  if (!all.ok) return refuse("The programmes could not be read just now. Nothing has changed.", "UNAVAILABLE", 503);
  const before = all.programmes.find(x => x.code === p.code) ?? null;

  const row = { code: p.code, label: p.label, profession: p.profession, country: p.country, level: p.level, is_active: p.active };
  const w = before
    ? await admin.from("individual_scholar_programme").update(row).eq("code", p.code)
    : await admin.from("individual_scholar_programme").insert(row);
  if (w.error) {
    if (String(w.error.code) === "23505") return refuse("A programme with that code was created meanwhile. Look again.", "CHANGED", 409);
    if (String(w.error.code) === "23514") return refuse("The database refused the programme as inconsistent.", "VALIDATION_ERROR", 422);
    return refuse("The programme could not be saved. Nothing has changed.", "WRITE_FAILED", 503);
  }

  // Replace the links: remove the ones no longer listed, then write the listed ones in order.
  const keep = new Set(p.frameworks.map(f => f.frameworkId));
  const gone = (before?.frameworks ?? []).map(f => String(f.framework_id).toLowerCase()).filter(id => !keep.has(id));
  if (gone.length) {
    const d = await admin.from("individual_scholar_programme_framework").delete().eq("programme_code", p.code).in("framework_id", gone);
    if (d.error) return refuse("The programme was saved but its catalogues could not be updated. Try again.", "WRITE_FAILED", 503);
  }
  if (p.frameworks.length) {
    const u = await admin.from("individual_scholar_programme_framework").upsert(
      p.frameworks.map(f => ({ programme_code: p.code, framework_id: f.frameworkId, layer: f.layer, sort_order: f.sortOrder })),
      { onConflict: "programme_code,framework_id" });
    if (u.error) return refuse("The programme was saved but its catalogues could not be updated. Try again.", "WRITE_FAILED", 503);
  }

  const after = await listProgrammesForHq(admin);
  const saved = after.ok ? after.programmes.find(x => x.code === p.code) ?? null : null;
  return { ok: true, before, after: saved ?? { ...row, frameworks: p.frameworks.map(f => ({ framework_id: f.frameworkId, layer: f.layer, sort_order: f.sortOrder })) } };
}

// CFCA-STUDIO-P1 (migration 660): a programme's qualification level, set from Programme frameworks. This file stays
// the one writer of programme rows.
/** A programme's qualification level (a qualification_level term, or none). The 660 trigger checks the kind. */
export async function setProgrammeQualification(admin: any, programmeCode: string, termId: unknown): Promise<({ ok: true } | { ok: false; error: string }) & { before?: string | null }> {
  const term = termId ? String(termId).toLowerCase() : null;
  if (term && !UUID.test(term)) return { ok: false, error: "Choose the qualification level from the list." };
  const prev = await admin.from("individual_scholar_programme").select("qualification_term_id").eq("code", programmeCode).maybeSingle();
  if (prev.error || !prev.data) return { ok: false, error: "That programme does not exist." };
  const { error } = await admin.from("individual_scholar_programme").update({ qualification_term_id: term }).eq("code", programmeCode);
  if (error) return { ok: false, error: /qualification_level/i.test(error.message ?? "") ? "That is not a qualification level." : "The qualification could not be saved just now." };
  return { ok: true, before: prev.data.qualification_term_id ?? null };
}
