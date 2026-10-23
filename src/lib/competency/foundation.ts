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
// ⚠ READ ONLY, AND NOTHING ORGANISATIONAL. Only shared rows are read, so no hospital's own framework,
// mapping or dependency can appear here.

export const COMPETENCY_LAYERS = ["foundational", "profession", "advanced", "specialty", "context"] as const;
export type CompetencyLayer = (typeof COMPETENCY_LAYERS)[number];
export type CatalogueScope = "scholar" | "professional";

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
  /** Holdings-scope links to other competencies in the offered set (ids), by kind. */
  links: { prerequisites: string[]; extends: string[]; sharedWith: string[] };
};

/** Pure: an allowlist value from the Individual policy, as framework ids. */
export const allowedCatalogueIds = (policy: { scholarCatalogues: string[]; professionalCatalogues: string[] }, scope: CatalogueScope) =>
  scope === "scholar" ? policy.scholarCatalogues : policy.professionalCatalogues;

type Row = Record<string, any>;

/** Pure: the competencies of the allowed catalogues, assembled. Exported for the unit tests. */
export function assembleCatalogue(r: {
  frameworks: Row[]; domains: Row[]; competencies: Row[]; cpus: Row[]; levels: Row[]; terms: Row[];
  dependencies: Row[]; equivalencies: Row[];
}): CatalogueCompetency[] {
  const fw = new Map(r.frameworks.map(f => [f.id, f]));
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
  for (const c of r.competencies) {
    const d = dom.get(c.domain_id); const f = d ? fw.get(d.framework_id) : undefined;
    if (!d || !f) continue;
    const t = f.profession_term_id ? term.get(f.profession_term_id) : undefined;
    const l = c.expected_level_id ? lvl.get(c.expected_level_id) : undefined;
    const u = c.cpu_id ? cpu.get(c.cpu_id) : undefined;
    out.push({
      competencyId: c.id, code: c.code ?? null, title: c.name, description: c.description ?? null,
      layer: (COMPETENCY_LAYERS as readonly string[]).includes(f.competency_layer) ? f.competency_layer : null,
      profession: t ? { termId: t.id, label: t.value } : null,
      catalogue: { id: f.id, name: f.name, code: f.code ?? null, version: `${f.version_major ?? 1}.${f.version_minor ?? 0}.${f.version_revision ?? 0}` },
      domain: { id: d.id, name: d.name },
      outcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes.filter((o: unknown) => typeof o === "string" && o.trim()) : [],
      expectedLevel: l ? { id: l.id, score: l.score, label: l.label } : null,
      cpu: u ? { id: u.id, code: u.code ?? null, name: u.name } : null,
      links: links.get(c.id) ?? { prerequisites: [], extends: [], sharedWith: [] },
    });
  }
  return out;
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

async function readCatalogue(admin: any, allowedFrameworkIds: readonly string[]): Promise<CatalogueCompetency[] | null> {
  const frameworks = await rows(admin.from("frameworks")
    .select("id, name, code, version_major, version_minor, version_revision, competency_layer, profession_term_id")
    .in("id", [...allowedFrameworkIds]).is("hospital_id", null).eq("is_active", true).eq("pub_status", "published"));
  if (frameworks === null) return null;
  if (!frameworks.length) return [];
  const domains = await rows(admin.from("framework_domains").select("id, framework_id, name").in("framework_id", frameworks.map((f: Row) => f.id)));
  if (domains === null) return null;
  const competencies = domains.length ? await rows(admin.from("framework_competencies")
    .select("id, domain_id, name, description, code, cpu_id, learning_outcomes, expected_level_id")
    .in("domain_id", domains.map((d: Row) => d.id)).order("sort_order")) : [];
  if (competencies === null) return null;
  const ids = competencies.map((c: Row) => c.id);
  const cpuIds = [...new Set(competencies.map((c: Row) => c.cpu_id).filter(Boolean))];
  const levelIds = [...new Set(competencies.map((c: Row) => c.expected_level_id).filter(Boolean))];
  const termIds = [...new Set(frameworks.map((f: Row) => f.profession_term_id).filter(Boolean))];
  const [cpus, levels, terms, dependencies, equivalencies] = await Promise.all([
    cpuIds.length ? rows(admin.from("clinical_practice_units").select("id, code, name").in("id", cpuIds)) : Promise.resolve([]),
    levelIds.length ? rows(admin.from("scoring_levels").select("id, score, label").in("id", levelIds)) : Promise.resolve([]),
    termIds.length ? rows(admin.from("taxonomy_terms").select("id, value").in("id", termIds)) : Promise.resolve([]),
    ids.length ? rows(admin.from("competency_dependencies").select("source_competency_id, target_competency_id, dependency_type").is("hospital_id", null).in("source_competency_id", ids)) : Promise.resolve([]),
    ids.length ? rows(admin.from("competency_equivalencies").select("source_competency_id, target_competency_id").is("hospital_id", null).in("source_competency_id", ids)) : Promise.resolve([]),
  ]);
  if ([cpus, levels, terms, dependencies, equivalencies].some(x => x === null)) return null;
  return assembleCatalogue({ frameworks, domains, competencies, cpus: cpus!, levels: levels!, terms: terms!, dependencies: dependencies!, equivalencies: equivalencies! });
}
