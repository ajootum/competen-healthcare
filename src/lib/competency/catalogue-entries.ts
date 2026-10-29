/* eslint-disable @typescript-eslint/no-explicit-any */
import { CONTENT_STATUSES, isRequirement, type ContentStatus } from "./foundation";
import { loadClinicalReviews, type ClinicalReview } from "./clinical-review";

// ── CONTROLLED CATALOGUES: CURATION ── migration 394, P0 competency catalogue ─────────────────────────────
//
// A controlled catalogue is a SHARED framework whose competency_catalogue_entry rows name existing
// competencies (CKCM spine: domain -> practice -> clinical practice unit -> competency, migration 011). It
// copies nothing. It is published through the governed framework lifecycle (submit, independent approval),
// and only then can the Individual allowlists name it (S1). This module reads the reference structure and
// writes entries. The HQ route that calls it holds hq.individual.config.manage.
//
// ⚠ ENTRIES ARE EDITABLE ONLY IN DRAFT. The 394 trigger refuses any change once the catalogue is in review,
// approved or published -- what the independent approver saw is what is offered. This module says so in
// words instead of surfacing the database error.
//
// ⚠ "APPROVED" IS NOT SET HERE (owner decision D2). Clinical approval is migration 395: an appointed, in-scope,
// independent reviewer approving the exact content version. A curator may mark an entry as a draft or not
// reviewed, and may put its content forward for clinical review -- never mark it approved.

export type CatalogueSummary = { id: string; name: string; code: string | null; status: string; layer: string | null; entries: number };
export type EntryView = {
  id: string; competencyId: string; title: string; code: string | null; home: string; domain: string;
  practice: { code: string | null; name: string } | null; cpu: { code: string | null; name: string } | null;
  contentStatus: ContentStatus; statusNote: string | null; sortOrder: number;
  /** The 395 clinical review of the competency's current content, when it could be read. */
  clinical: ClinicalReview | null;
};
export type ReferenceCompetency = { id: string; title: string; code: string | null; home: string; domain: string; practiceId: string | null; cpuId: string | null };
export type ReferencePractice = { id: string; code: string | null; name: string; home: string; cpus: { id: string; code: string | null; name: string }[] };

export const isContentStatus = (v: unknown): v is ContentStatus => typeof v === "string" && (CONTENT_STATUSES as readonly string[]).includes(v);
export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  approved: "Approved content",
  draft: "Draft content",
  unreviewed: "Not clinically reviewed",
};
export const NOTE_MAX = 500;

/** Pure: whether a status change is acceptable before it reaches the database. Never "approved" (D2). */
export function checkStatusChange(status: unknown, note: unknown): { ok: true; status: ContentStatus; note: string | null } | { ok: false; error: string } {
  if (status === "approved") return { ok: false, error: "Approval is clinical review, not a catalogue setting. Put the content forward for clinical review instead." };
  if (!isContentStatus(status)) return { ok: false, error: "Choose draft or not reviewed." };
  const n = typeof note === "string" && note.trim() ? note.trim() : null;
  if (n && n.length > NOTE_MAX) return { ok: false, error: `Keep the note under ${NOTE_MAX} characters.` };
  return { ok: true, status, note: n };
}

/** Pure: the database refusal, in words. */
export function entryRefusal(message: string | undefined): string {
  if (!message) return "The catalogue could not be changed just now.";
  if (/frozen/i.test(message)) return "This catalogue is in review or published, so its entries are frozen. Revert it to a draft through the framework lifecycle to change them.";
  if (/shared framework/i.test(message)) return "Only shared frameworks and their competencies can be used in a controlled catalogue.";
  if (/duplicate key|unique/i.test(message)) return "That competency is already in this catalogue.";
  return "The catalogue could not be changed just now.";
}

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

/** Shared frameworks that are, or can become, controlled catalogues: classified ones and any that hold entries. */
export async function listCatalogues(admin: any): Promise<CatalogueSummary[] | null> {
  const [fws, entries] = await Promise.all([
    rows(admin.from("frameworks").select("id, name, code, pub_status, competency_layer").is("hospital_id", null).order("name")),
    rows(admin.from("competency_catalogue_entry").select("catalogue_id")),
  ]);
  if (fws === null || entries === null) return null;
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.catalogue_id, (count.get(e.catalogue_id) ?? 0) + 1);
  return fws.filter((f: any) => f.competency_layer || count.has(f.id)).map((f: any) => ({
    id: f.id, name: f.name, code: f.code ?? null, status: f.pub_status ?? "draft", layer: f.competency_layer ?? null, entries: count.get(f.id) ?? 0,
  }));
}

/** One catalogue's entries, each with its competency, home framework, domain, practice and CPU. */
export async function loadEntries(admin: any, catalogueId: string): Promise<EntryView[] | null> {
  const entries = await rows(admin.from("competency_catalogue_entry").select("id, competency_id, content_status, status_note, sort_order")
    .eq("catalogue_id", catalogueId).order("sort_order"));
  if (entries === null) return null;
  if (!entries.length) return [];
  const comps = await rows(admin.from("framework_competencies").select("id, name, code, domain_id, practice_id, cpu_id").in("id", entries.map((e: any) => e.competency_id)));
  if (comps === null) return null;
  const tree = await spineFor(admin, comps);
  if (!tree) return null;
  const byId = new Map(comps.map((c: any) => [c.id, c]));
  const reviews = await loadClinicalReviews(admin, comps.map((c: any) => c.id));
  return entries.flatMap((e: any) => {
    const c: any = byId.get(e.competency_id);
    if (!c) return [];
    const d = tree.domains.get(c.domain_id); const u = tree.cpus.get(c.cpu_id ?? ""); const p = tree.practices.get(c.practice_id ?? "") ?? tree.practices.get(u?.practice_id ?? "");
    return [{
      id: e.id, competencyId: c.id, title: c.name, code: c.code ?? null, home: tree.frameworks.get(d?.framework_id ?? "")?.name ?? "Unknown framework",
      domain: d?.name ?? "Unknown domain", practice: p ? { code: p.code ?? null, name: p.name } : null, cpu: u ? { code: u.code ?? null, name: u.name } : null,
      contentStatus: reviews?.get(c.id)?.state === "approved" ? "approved" : e.content_status === "draft" ? "draft" : "unreviewed",
      statusNote: e.status_note ?? null, sortOrder: e.sort_order ?? 0, clinical: reviews?.get(c.id) ?? null,
    }];
  });
}

async function spineFor(admin: any, comps: any[]) {
  const domainIds = [...new Set(comps.map(c => c.domain_id))];
  const cpuIds = [...new Set(comps.map(c => c.cpu_id).filter(Boolean))];
  const [domains, cpus] = await Promise.all([
    domainIds.length ? rows(admin.from("framework_domains").select("id, name, framework_id").in("id", domainIds)) : [],
    cpuIds.length ? rows(admin.from("clinical_practice_units").select("id, code, name, practice_id").in("id", cpuIds)) : [],
  ]);
  if (domains === null || cpus === null) return null;
  const practiceIds = [...new Set([...comps.map(c => c.practice_id), ...cpus.map((u: any) => u.practice_id)].filter(Boolean))];
  const fwIds = [...new Set(domains.map((d: any) => d.framework_id))];
  const [practices, frameworks] = await Promise.all([
    practiceIds.length ? rows(admin.from("practices").select("id, code, name").in("id", practiceIds)) : [],
    fwIds.length ? rows(admin.from("frameworks").select("id, name").in("id", fwIds).is("hospital_id", null)) : [],
  ]);
  if (practices === null || frameworks === null) return null;
  const m = (xs: any[]) => new Map<string, any>(xs.map(x => [x.id, x]));
  return { domains: m(domains), cpus: m(cpus), practices: m(practices), frameworks: m(frameworks) };
}

/**
 * The reference structure a catalogue may name: practices of SHARED frameworks with their CPUs, and the
 * competencies of one shared framework (by domain), each with its practice and CPU link. Read only.
 */
export async function loadReference(admin: any, frameworkId: string | null): Promise<{ practices: ReferencePractice[]; frameworks: { id: string; name: string }[]; competencies: ReferenceCompetency[] } | null> {
  const frameworks = await rows(admin.from("frameworks").select("id, name").is("hospital_id", null).order("name"));
  if (frameworks === null) return null;
  const shared = new Map<string, string>(frameworks.map((f: any) => [f.id, f.name]));
  const doms = await rows(admin.from("framework_domains").select("id, name, framework_id").in("framework_id", [...shared.keys()]));
  if (doms === null) return null;
  const domById = new Map<string, any>(doms.map((d: any) => [d.id, d]));
  const prs = doms.length ? await rows(admin.from("practices").select("id, code, name, domain_id").in("domain_id", [...domById.keys()]).order("code")) : [];
  if (prs === null) return null;
  const cps = prs.length ? await rows(admin.from("clinical_practice_units").select("id, code, name, practice_id").in("practice_id", prs.map((p: any) => p.id)).order("code")) : [];
  if (cps === null) return null;
  const practices: ReferencePractice[] = prs.map((p: any) => ({
    id: p.id, code: p.code ?? null, name: p.name, home: shared.get(domById.get(p.domain_id)?.framework_id) ?? "Unknown framework",
    cpus: cps.filter((u: any) => u.practice_id === p.id).map((u: any) => ({ id: u.id, code: u.code ?? null, name: u.name })),
  }));
  // Competencies linked to the spine, plus every competency of the framework being browsed.
  const inFramework = frameworkId && shared.has(frameworkId) ? doms.filter((d: any) => d.framework_id === frameworkId).map((d: any) => d.id) : [];
  const [linked, browsed] = await Promise.all([
    rows(admin.from("framework_competencies").select("id, name, code, domain_id, practice_id, cpu_id").in("domain_id", [...domById.keys()]).or("practice_id.not.is.null,cpu_id.not.is.null").limit(1000)),
    inFramework.length ? rows(admin.from("framework_competencies").select("id, name, code, domain_id, practice_id, cpu_id").in("domain_id", inFramework).order("sort_order").limit(1000)) : [],
  ]);
  if (linked === null || browsed === null) return null;
  const seen = new Set<string>();
  const competencies = [...linked, ...browsed].filter((c: any) => !seen.has(c.id) && seen.add(c.id)).map((c: any) => {
    const d = domById.get(c.domain_id);
    return { id: c.id, title: c.name, code: c.code ?? null, home: shared.get(d?.framework_id) ?? "Unknown framework", domain: d?.name ?? "Unknown domain", practiceId: c.practice_id ?? null, cpuId: c.cpu_id ?? null };
  });
  return { practices, frameworks: frameworks.map((f: any) => ({ id: f.id, name: f.name })), competencies };
}

/** Add existing competencies to a draft catalogue, unreviewed. Returns how many were added. */
export async function addEntries(admin: any, catalogueId: string, competencyIds: string[]): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const ids = [...new Set(competencyIds)].slice(0, 200);
  if (!ids.length) return { ok: false, error: "Choose at least one competency." };
  const { data: existing } = await admin.from("competency_catalogue_entry").select("competency_id, sort_order").eq("catalogue_id", catalogueId);
  const have = new Set((existing ?? []).map((e: any) => e.competency_id));
  let next = Math.max(0, ...(existing ?? []).map((e: any) => e.sort_order ?? 0)) + 1;
  const fresh = ids.filter(id => !have.has(id)).map(id => ({ catalogue_id: catalogueId, competency_id: id, content_status: "unreviewed", sort_order: next++ }));
  if (!fresh.length) return { ok: true, added: 0 };
  const { error } = await admin.from("competency_catalogue_entry").insert(fresh);
  return error ? { ok: false, error: entryRefusal(error.message) } : { ok: true, added: fresh.length };
}

export async function setEntryStatus(admin: any, catalogueId: string, entryId: string, status: ContentStatus, note: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin.from("competency_catalogue_entry").update({ content_status: status, status_note: note })
    .eq("id", entryId).eq("catalogue_id", catalogueId).select("id");
  if (error) return { ok: false, error: entryRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "That entry is not in this catalogue." };
}

export async function removeEntry(admin: any, catalogueId: string, entryId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin.from("competency_catalogue_entry").delete().eq("id", entryId).eq("catalogue_id", catalogueId).select("id");
  if (error) return { ok: false, error: entryRefusal(error.message) };
  return data?.length ? { ok: true } : { ok: false, error: "That entry is not in this catalogue." };
}

const LEVEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CFCA-STUDIO-P1 (migration 660): the PROGRAMME OVERLAY of an entry. Same draft-only rule as every entry column.
/** The overlay of one entry of a draft catalogue: its requirement and target level. Refused outside draft by 394. */
export async function setEntryOverlay(admin: any, catalogueId: string, entryId: string, requirement: unknown, expectedLevelId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isRequirement(requirement)) return { ok: false, error: "Choose required, recommended or optional." };
  const level = expectedLevelId ? String(expectedLevelId).toLowerCase() : null;
  if (level && !LEVEL_ID.test(level)) return { ok: false, error: "Choose the target level from a scale." };
  const { data, error } = await admin.from("competency_catalogue_entry").update({ requirement, expected_level_id: level })
    .eq("id", entryId).eq("catalogue_id", catalogueId).select("id");
  if (error) return { ok: false, error: /frozen/i.test(error.message ?? "") ? "This catalogue is in review or published, so its entries are frozen. Start a new draft version to change them." : "The requirement could not be saved just now. Nothing has changed." };
  return data?.length ? { ok: true } : { ok: false, error: "That entry is not in this catalogue." };
}
