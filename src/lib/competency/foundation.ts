/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE SHARED COMPETENCY FOUNDATION: THE STABLE READ API ── COMPETEN-SCHOLAR-01 S1 ─────────────────────
//
// What Competen Individual (Scholar S2-S4, Professional) may map against, from the EXISTING competency
// library -- frameworks, framework_domains, framework_competencies, clinical_practice_units, scoring_levels
// -- classified by migration 384 into five layers:
//
//   foundational  Competen Foundational, cross-professional (clinical reasoning, patient safety, ...)
//   profession    one profession's catalogue (nursing, medicine, midwifery, pharmacy ...)
//   advanced      advanced practice within a profession
//   specialty     a specialty (intensive care, emergency ...)
//   context       role, institution or practice-environment requirements
//
// Layers compose through what already exists: frameworks.parent_framework_id (extension), and the
// Holdings-scope (hospital_id null) rows of competency_dependencies (prerequisite / inherited) and
// competency_equivalencies (a competency in one layer that IS one in another -- shared, not duplicated).
//
// ⚠ ONLY WHAT HQ HAS ALLOWED, AND NOTHING BY DEFAULT. A catalogue is offered to an experience only when it
// is in that experience's allowlist (Individual policy, src/lib/individual/policy.ts, set under
// hq.individual.config.manage) AND is shared (hospital_id null), active and published. The allowlist
// starts EMPTY: until HQ chooses, Individual offers no catalogue at all -- no framework reaches a person by
// existing. Unreadable is null, never an empty list that reads as "nothing exists".
//
// ⚠ CONTROLLED CATALOGUES REFERENCE, THEY DO NOT COPY (migration 394). An allowlisted catalogue offers its own
// competencies AND the existing competencies its competency_catalogue_entry rows name -- with their own
// domain, practice and clinical practice unit (the CKCM spine, migration 011, untouched). The home framework
// of a referenced competency is NOT offered by this: only the catalogue is, and only what it names.
//
// ⚠ CONTENT STATUS IS NEVER INFERRED AS APPROVED. "approved" means ONE thing: migration 395 records that
// independent, appointed, in-scope clinical review approved the competency's CURRENT content version (owner
// decision D2). A catalogue entry (394) can say a competency is a draft. It can no longer make one approved,
// and publishing a framework or a catalogue is not a clinical review of its content.
//
// ⚠ READ ONLY, AND NOTHING ORGANISATIONAL. Only shared rows are read, so no hospital's own framework,
// mapping or dependency can appear here.

import { CLINICAL_STATE_LABEL, clinicalNote, loadClinicalReviews, type ClinicalReview, type ClinicalState } from "./clinical-review";
import { byRowOrder } from "./layout-order";

export const COMPETENCY_LAYERS = ["foundational", "profession", "advanced", "specialty", "context"] as const;
export type CompetencyLayer = (typeof COMPETENCY_LAYERS)[number];
export type CatalogueScope = "scholar" | "professional";
export const CONTENT_STATUSES = ["approved", "draft", "unreviewed"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** One competency as Individual may map to it. Stable: S2-S4 build against this shape. */
export type CatalogueCompetency = {
  competencyId: string;
  code: string | null;
  title: string;
  description: string | null;
  /** The catalogue's layer, or null when HQ has not classified it (still offered only if allowlisted). */
  layer: CompetencyLayer | null;
  /** The profession the catalogue belongs to (taxonomy kind 'profession'), or null (e.g. foundational). */
  profession: { termId: string; label: string } | null;
  catalogue: { id: string; name: string; code: string | null; version: string };
  domain: { id: string; name: string };
  /** What a person should be able to do. Empty means none recorded -- not "no outcomes exist". */
  outcomes: string[];
  /** The proficiency expected, on the platform scoring scale (scoring_levels), or null if not set. */
  expectedLevel: { id: string; score: number; label: string } | null;
  /** The clinical practice unit it is assessed under, when it has one. */
  cpu: { id: string; code: string | null; name: string } | null;
  /** The practice (CKCM spine) it belongs to: its own, or its CPU's. Null when it has neither. */
  practice: { id: string; code: string | null; name: string } | null;
  /** Where the competency itself lives: the catalogue when it is the catalogue's own, another shared
   *  framework when the catalogue REFERENCES it (migration 394). */
  home: { frameworkId: string; frameworkName: string };
  /** "approved" only when 395 clinical review approved this exact content; "draft" when the catalogue entry
   *  says so; otherwise "unreviewed". */
  contentStatus: ContentStatus;
  /** Why, in words: the clinical review state, or the catalogue note. Null when neither says anything. */
  statusNote: string | null;
  /** The 395 clinical review state, when it was read (approved, in review, changes requested, stale, unreviewed). */
  clinicalState?: ClinicalState;
  /** Holdings-scope links to other competencies in the offered set (ids), by kind. */
  links: { prerequisites: string[]; extends: string[]; sharedWith: string[] };
  /** CFCA-STUDIO-P1 (migration 660): what each offered catalogue that NAMES this competency requires of it --
   *  the programme overlay. Empty when no catalogue entry names it, or before 660. */
  overlays?: CatalogueOverlay[];
};

export const REQUIREMENTS = ["required", "recommended", "optional"] as const;
export type Requirement = (typeof REQUIREMENTS)[number];
/** One catalogue's requirement on a competency it names (competency_catalogue_entry, 394 + 660). */
export type CatalogueOverlay = {
  catalogueId: string; catalogueName: string; catalogueVersion: string; entryId: string | null; requirement: Requirement;
  /** The target level in this catalogue, or null: the competency's own expected level applies. */
  expectedLevel: { id: string; score: number; label: string } | null;
};
export const isRequirement = (v: unknown): v is Requirement => typeof v === "string" && (REQUIREMENTS as readonly string[]).includes(v);

/**
 * Pure: the overlay that governs a competency in a programme -- the one from the programme's catalogue that comes
 * first in the programme's own order. Null when none of the programme's catalogues names it (its own default applies).
 */
export function pickOverlay(overlays: readonly CatalogueOverlay[] | undefined, order: ReadonlyMap<string, number>): CatalogueOverlay | null {
  let best: CatalogueOverlay | null = null, at = Infinity;
  for (const o of overlays ?? []) {
    const i = order.get(o.catalogueId);
    if (i !== undefined && i < at) { best = o; at = i; }
  }
  return best;
}

/** Pure: an allowlist value from the Individual policy, as framework ids. */
export const allowedCatalogueIds = (policy: { scholarCatalogues: string[]; professionalCatalogues: string[] }, scope: CatalogueScope) =>
  scope === "scholar" ? policy.scholarCatalogues : policy.professionalCatalogues;

type Row = Record<string, any>;

/** Pure: the competencies of the allowed catalogues, assembled. Exported for the unit tests. */
export function assembleCatalogue(r: {
  frameworks: Row[]; domains: Row[]; competencies: Row[]; cpus: Row[]; levels: Row[]; terms: Row[];
  dependencies: Row[]; equivalencies: Row[];
  /** Controlled-catalogue references (394), the shared frameworks their competencies live in, and practices. */
  entries?: Row[]; homeFrameworks?: Row[]; practices?: Row[];
}): CatalogueCompetency[] {
  const offered = new Map(r.frameworks.map(f => [f.id, f]));
  const fw = new Map([...(r.homeFrameworks ?? []), ...r.frameworks].map(f => [f.id, f]));
  const pra = new Map((r.practices ?? []).map(p => [p.id, p]));
  const dom = new Map(r.domains.map(d => [d.id, d]));
  const cpu = new Map(r.cpus.map(c => [c.id, c]));
  const lvl = new Map(r.levels.map(l => [l.id, l]));
  const term = new Map(r.terms.map(t => [t.id, t]));
  const ids = new Set(r.competencies.map(c => c.id));
  const links = new Map<string, CatalogueCompetency["links"]>();
  const at = (id: string) => { let l = links.get(id); if (!l) { l = { prerequisites: [], extends: [], sharedWith: [] }; links.set(id, l); } return l; };
  for (const d of r.dependencies) {
    if (!ids.has(d.source_competency_id) || !ids.has(d.target_competency_id)) continue;
    // source depends on target: target is a prerequisite of source / source extends target.
    if (d.dependency_type === "prerequisite") at(d.source_competency_id).prerequisites.push(d.target_competency_id);
    else if (d.dependency_type === "inherited") at(d.source_competency_id).extends.push(d.target_competency_id);
  }
  for (const e of r.equivalencies) {
    if (!e.source_competency_id || !e.target_competency_id || !ids.has(e.source_competency_id) || !ids.has(e.target_competency_id)) continue;
    at(e.source_competency_id).sharedWith.push(e.target_competency_id);
    at(e.target_competency_id).sharedWith.push(e.source_competency_id);
  }
  const out: CatalogueCompetency[] = [];
  const comp = new Map(r.competencies.map(c => [c.id, c]));
  // The programme overlay (660): every offered catalogue's entry for a competency, kept beside the placement below.
  const overlays = new Map<string, CatalogueOverlay[]>();
  for (const e of r.entries ?? []) {
    if (!offered.has(e.catalogue_id) || !comp.has(e.competency_id)) continue;
    const l = e.expected_level_id ? lvl.get(e.expected_level_id) : undefined;
    const cf = offered.get(e.catalogue_id)!;
    overlays.set(e.competency_id, [...(overlays.get(e.competency_id) ?? []), {
      catalogueId: e.catalogue_id, catalogueName: cf.name, catalogueVersion: `${cf.version_major ?? 1}.${cf.version_minor ?? 0}.${cf.version_revision ?? 0}`,
      entryId: e.id ?? null, requirement: isRequirement(e.requirement) ? e.requirement : "required",
      expectedLevel: l ? { id: l.id, score: l.score, label: l.label } : null,
    }]);
  }
  // Each competency once: as a catalogue's own, else as the first catalogue entry that names it.
  const placements: { c: Row; f: Row; entry: Row | null }[] = [];
  // FRAMEWORK-DESIGN-STUDIO-01: a catalogue's own competencies in its order -- catalogue by catalogue, domain by
  // domain (sort_order, name, id), then competency by competency within its domain -- never one sort across domains.
  const fwAt = new Map(r.frameworks.map((f, i) => [f.id, i]));
  const ownOrder = (a: Row, b: Row) => {
    const da = dom.get(a.domain_id), db = dom.get(b.domain_id);
    return (fwAt.get(da?.framework_id) ?? 0) - (fwAt.get(db?.framework_id) ?? 0) || (da && db && da.id !== db.id ? byRowOrder(da, db) : 0) || byRowOrder(a, b);
  };
  for (const c of [...r.competencies].sort(ownOrder)) {
    const d = dom.get(c.domain_id); const f = d ? offered.get(d.framework_id) : undefined;
    if (d && f) placements.push({ c, f, entry: null });
  }
  for (const e of [...(r.entries ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const c = comp.get(e.competency_id); const f = offered.get(e.catalogue_id);
    if (c && f) placements.push({ c, f, entry: e });
  }
  const seen = new Set<string>();
  for (const { c, f, entry } of placements) {
    if (seen.has(c.id)) continue;
    const d = dom.get(c.domain_id); const home = d ? fw.get(d.framework_id) : undefined;
    if (!d || !home) continue;
    seen.add(c.id);
    const t = f.profession_term_id ? term.get(f.profession_term_id) : undefined;
    const l = c.expected_level_id ? lvl.get(c.expected_level_id) : undefined;
    const u = c.cpu_id ? cpu.get(c.cpu_id) : undefined;
    const p = pra.get(c.practice_id ?? "") ?? pra.get(u?.practice_id ?? "");
    // An entry may mark content as a draft. "approved" comes only from clinical review (withClinicalReview).
    const status: ContentStatus = entry?.content_status === "draft" ? "draft" : "unreviewed";
    out.push({
      competencyId: c.id, code: c.code ?? null, title: c.name, description: c.description ?? null,
      layer: (COMPETENCY_LAYERS as readonly string[]).includes(f.competency_layer) ? f.competency_layer : null,
      profession: t ? { termId: t.id, label: t.value } : null,
      catalogue: { id: f.id, name: f.name, code: f.code ?? null, version: `${f.version_major ?? 1}.${f.version_minor ?? 0}.${f.version_revision ?? 0}` },
      domain: { id: d.id, name: d.name },
      outcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes.filter((o: unknown) => typeof o === "string" && o.trim()) : [],
      expectedLevel: l ? { id: l.id, score: l.score, label: l.label } : null,
      cpu: u ? { id: u.id, code: u.code ?? null, name: u.name } : null,
      practice: p ? { id: p.id, code: p.code ?? null, name: p.name } : null,
      home: { frameworkId: home.id, frameworkName: home.name },
      contentStatus: status,
      statusNote: entry?.status_note ?? null,
      links: links.get(c.id) ?? { prerequisites: [], extends: [], sharedWith: [] },
      overlays: overlays.get(c.id) ?? [],
    });
  }
  return out;
}

/** Pure: the words every surface shows beside a competency for its clinical review (owner decision D1). */
export function reviewLabel(c: Pick<CatalogueCompetency, "contentStatus" | "clinicalState">): string {
  if (c.clinicalState) return CLINICAL_STATE_LABEL[c.clinicalState];
  return c.contentStatus === "approved" ? CLINICAL_STATE_LABEL.approved : c.contentStatus === "draft" ? "Draft content" : CLINICAL_STATE_LABEL.unreviewed;
}

/**
 * Pure: the clinical review state onto each competency. Approved only when 395 says the current content is
 * approved -- never from a catalogue entry. A competency with no review record reads "Not clinically reviewed".
 */
export function withClinicalReview(items: CatalogueCompetency[], reviews: ReadonlyMap<string, ClinicalReview>): CatalogueCompetency[] {
  return items.map(c => {
    const r = reviews.get(c.competencyId);
    if (!r) return c;
    const approved = r.state === "approved";
    return { ...c, contentStatus: approved ? "approved" : c.contentStatus, clinicalState: r.state,
      statusNote: approved || r.state !== "unreviewed" || !c.statusNote ? clinicalNote(r) : c.statusNote };
  });
}

const rows = async (p: Promise<any>) => { try { const { data, error } = await p; return error ? null : (data ?? []); } catch { return null; } };

/**
 * The competencies Individual may map to for one experience. null = could not be read (fail closed: offer
 * nothing). [] = readable and nothing allowed. Never reads a hospital's own row.
 */
export async function loadIndividualCatalogue(admin: any, allowedFrameworkIds: readonly string[]): Promise<CatalogueCompetency[] | null> {
  if (!allowedFrameworkIds.length) return [];
  // Any failure, however it arises (a rejected query or a client that throws), is "could not be read".
  try { return await readCatalogue(admin, allowedFrameworkIds); } catch { return null; }
}

/**
 * CFCA-STUDIO-P1 PREVIEW, FOR HQ ONLY: the same read for shared catalogues in ANY status, so a draft programme
 * framework can be previewed before it is published. It is never an offer: the Individual read above keeps the
 * shared, active, published rule, and only it reaches a person.
 */
export async function loadCatalogueForPreview(admin: any, frameworkIds: readonly string[]): Promise<CatalogueCompetency[] | null> {
  if (!frameworkIds.length) return [];
  try { return await readCatalogue(admin, frameworkIds, true); } catch { return null; }
}

const FW_COLS = "id, name, code, version_major, version_minor, version_revision, competency_layer, profession_term_id";

async function readCatalogue(admin: any, allowedFrameworkIds: readonly string[], anyStatus = false): Promise<CatalogueCompetency[] | null> {
  const frameworks = await rows(anyStatus
    ? admin.from("frameworks").select(FW_COLS).in("id", Array.from(allowedFrameworkIds)).is("hospital_id", null)
    : admin.from("frameworks").select(FW_COLS).in("id", [...allowedFrameworkIds]).is("hospital_id", null).eq("is_active", true).eq("pub_status", "published"));
  if (frameworks === null) return null;
  if (!frameworks.length) return [];
  const catalogueIds: string[] = frameworks.map((f: Row) => f.id);
  const ownDomains = await rows(admin.from("framework_domains").select("id, framework_id, name, sort_order").in("framework_id", catalogueIds));
  if (ownDomains === null) return null;
  const COMP = "id, domain_id, name, description, code, practice_id, cpu_id, learning_outcomes, expected_level_id, sort_order";
  const own = ownDomains.length ? await rows(admin.from("framework_competencies").select(COMP)
    .in("domain_id", ownDomains.map((d: Row) => d.id)).order("sort_order")) : [];
  if (own === null) return null;
  // Controlled-catalogue references (394). Before 394 is applied there are none, which is not unreadable.
  const entries = await entriesOf(admin, catalogueIds);
  if (entries === null) return null;
  const ownIds = new Set(own.map((c: Row) => c.id));
  const refIds = [...new Set(entries.map((e: Row) => e.competency_id as string).filter(id => !ownIds.has(id)))];
  const referenced = refIds.length ? await rows(admin.from("framework_competencies").select(COMP).in("id", refIds)) : [];
  if (referenced === null) return null;
  const ownDomainIds = new Set(ownDomains.map((d: Row) => d.id));
  const refDomainIds = [...new Set(referenced.map((c: Row) => c.domain_id as string))].filter(id => !ownDomainIds.has(id));
  const refDomains = refDomainIds.length ? await rows(admin.from("framework_domains").select("id, framework_id, name").in("id", refDomainIds)) : [];
  if (refDomains === null) return null;
  const homeIds = ([...new Set(refDomains.map((d: Row) => String(d.framework_id)))] as string[]).filter(id => !catalogueIds.includes(id));
  // A referenced competency's home must be SHARED. A hospital framework never answers here, so its
  // competencies drop out (assembleCatalogue skips a competency whose home it was not given).
  const homeFrameworks = homeIds.length ? await rows(admin.from("frameworks").select("id, name").in("id", homeIds).is("hospital_id", null)) : [];
  if (homeFrameworks === null) return null;
  const domains = [...ownDomains, ...refDomains];
  const competencies = [...own, ...referenced];
  const ids = competencies.map((c: Row) => c.id);
  const cpuIds = [...new Set(competencies.map((c: Row) => c.cpu_id).filter(Boolean))];
  const levelIds = [...new Set([...competencies.map((c: Row) => c.expected_level_id), ...entries.map((e: Row) => e.expected_level_id)].filter(Boolean))];
  const termIds = [...new Set(frameworks.map((f: Row) => f.profession_term_id).filter(Boolean))];
  const [cpus, levels, terms, dependencies, equivalencies] = await Promise.all([
    cpuIds.length ? rows(admin.from("clinical_practice_units").select("id, code, name, practice_id").in("id", cpuIds)) : Promise.resolve([]),
    levelIds.length ? rows(admin.from("scoring_levels").select("id, score, label").in("id", levelIds)) : Promise.resolve([]),
    termIds.length ? rows(admin.from("taxonomy_terms").select("id, value").in("id", termIds)) : Promise.resolve([]),
    ids.length ? rows(admin.from("competency_dependencies").select("source_competency_id, target_competency_id, dependency_type").is("hospital_id", null).in("source_competency_id", ids)) : Promise.resolve([]),
    ids.length ? rows(admin.from("competency_equivalencies").select("source_competency_id, target_competency_id").is("hospital_id", null).in("source_competency_id", ids)) : Promise.resolve([]),
  ]);
  if ([cpus, levels, terms, dependencies, equivalencies].some(x => x === null)) return null;
  const practiceIds = [...new Set([...competencies.map((c: Row) => c.practice_id), ...cpus!.map((u: Row) => u.practice_id)].filter(Boolean))];
  const practices = practiceIds.length ? await rows(admin.from("practices").select("id, code, name").in("id", practiceIds)) : [];
  if (practices === null) return null;
  const items = assembleCatalogue({ frameworks, domains, competencies, cpus: cpus!, levels: levels!, terms: terms!, dependencies: dependencies!,
    equivalencies: equivalencies!, entries, homeFrameworks: homeFrameworks!, practices });
  // The clinical state of each, from 395. Unreadable is unreadable: the whole catalogue fails closed.
  const reviews = await loadClinicalReviews(admin, items.map(c => c.competencyId));
  if (reviews === null) return null;
  return withClinicalReview(items, reviews);
}

/**
 * The entries of the offered catalogues, with the programme overlay (660) where it exists. [] when migration 394
 * is not applied here, null when unreadable. Before 660 the overlay columns are absent and the entries are read
 * without them: every entry then reads as required, at the competency's own expected level.
 */
async function entriesOf(admin: any, catalogueIds: string[]): Promise<Row[] | null> {
  const read = (cols: string) => admin.from("competency_catalogue_entry").select(cols).in("catalogue_id", catalogueIds);
  const r = await read("id, catalogue_id, competency_id, content_status, status_note, sort_order, requirement, expected_level_id");
  if (!r?.error) return r?.data ?? [];
  if (NOT_PROVISIONED.has(String(r.error.code ?? ""))) return [];
  if (!NO_COLUMN.has(String(r.error.code ?? ""))) return null;
  const legacy = await read("catalogue_id, competency_id, content_status, status_note, sort_order");
  return legacy?.error ? null : (legacy?.data ?? []);
}
// An undefined column (Postgres) and its PostgREST form: the entry overlay before migration 660.
const NO_COLUMN = new Set(["42703", "PGRST204"]);
// An undefined table (Postgres) and its PostgREST schema-cache forms: the access.ts rule, kept here so
// this Holdings module imports no Individual code.
const NOT_PROVISIONED = new Set(["42P01", "PGRST205"]);
