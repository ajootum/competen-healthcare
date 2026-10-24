/* eslint-disable @typescript-eslint/no-explicit-any */
import { referenceNames } from "../professional/frameworks";
import { scholarCatalogue, structureLabel, type CatalogueCompetency, type ProgrammeConfig } from "./catalogue";
import { learnerProgramme } from "./store";

// ── WHAT THE PAGES NEED TO SHOW COMPETENCIES ── COMPETEN-SCHOLAR-01 ──────────────────────────────────────
//
// The person's programme and its competencies, through the CompetencyCatalogue interface, in one call the
// material, Apply and Progress pages share. Three honest states, never collapsed into an empty list:
//   provisioned false  387/388 are not on this environment. The competency features are absent (fail closed).
//   competencies null  the catalogue could not be read. The page says so.
//   programme null     the person has not chosen one. Concepts only.

export type LearnerCatalogue = {
  provisioned: boolean;
  programme: ProgrammeConfig | null;
  competencies: CatalogueCompetency[] | null;
};

export async function loadLearnerCatalogue(admin: any, userId: string): Promise<LearnerCatalogue> {
  const p = await learnerProgramme(admin, userId);
  if (!p.ok) return { provisioned: !p.notProvisioned, programme: null, competencies: p.notProvisioned ? [] : null };
  if (!p.data) return { provisioned: true, programme: null, competencies: [] };
  const c = await scholarCatalogue(admin).forProgramme(p.data);
  return { provisioned: true, programme: p.data, competencies: c.ok ? c.data : null };
}

export type CompetencyLabel = { title: string; code: string | null; layer: string; catalogue: string | null; structure?: string | null };

/**
 * Names for competency ids on the person's own rows. From the catalogue when it offers them, otherwise from
 * the shared frameworks by id (a link made before the programme changed keeps its name). An id that is in
 * neither keeps its row and is named as such -- the link is the person's record, and is not hidden.
 */
export async function competencyLabels(admin: any, catalogue: CatalogueCompetency[] | null, ids: string[], layers: Map<string, string>): Promise<Map<string, CompetencyLabel>> {
  const out = new Map<string, CompetencyLabel>();
  for (const c of catalogue ?? []) out.set(c.id, { title: c.title, code: c.code, layer: c.layer, catalogue: c.catalogue, structure: structureLabel(c) });
  const missing = [...new Set(ids)].filter(id => !out.has(id));
  if (missing.length) {
    const names = await referenceNames(admin, [], missing);
    for (const id of missing) out.set(id, { title: names.get(id) ?? "A competency no longer in your programme", code: null, layer: layers.get(id) ?? "profession", catalogue: null });
  }
  return out;
}
