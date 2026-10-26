/* eslint-disable @typescript-eslint/no-explicit-any */
import { noProgrammeText } from "./classify-view";
import { referenceNames } from "../professional/frameworks";
import { scholarCatalogue, structureLabel, type CatalogueCompetency, type ProgrammeConfig } from "./catalogue";
import { competencyProgressRows, learnerProgramme } from "./store";
import { buildCompetencyProgress } from "./competency-progress";
import { buildLearnerContext } from "./learner-context";
import { contextHistory } from "./context";

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
  /** How many competencies the content-status floor holds back (said on the page, never silently missing). */
  belowFloor: number;
  minStatus: "unreviewed" | "draft" | "approved";
};

export async function loadLearnerCatalogue(admin: any, userId: string): Promise<LearnerCatalogue> {
  const p = await learnerProgramme(admin, userId);
  if (!p.ok) return { provisioned: !p.notProvisioned, programme: null, competencies: p.notProvisioned ? [] : null, belowFloor: 0, minStatus: "unreviewed" };
  if (!p.data) return { provisioned: true, programme: null, competencies: [], belowFloor: 0, minStatus: "unreviewed" };
  const c = await scholarCatalogue(admin).forProgramme(p.data);
  return { provisioned: true, programme: p.data, competencies: c.ok ? c.data : null, belowFloor: c.ok ? c.belowFloor ?? 0 : 0, minStatus: c.ok ? c.minStatus ?? "unreviewed" : "unreviewed" };
}

/**
 * UPLOAD-01 U3 and R1 (Stage 1 close-out): why no competency is suggested for this person's notes, said where
 * the suggestions would be -- or null when suggestions can be made. Absent is a state with a reason, never a
 * silent blank, and never a block: the notes are studied the same either way.
 */
export function competencyAbsence(l: Pick<LearnerCatalogue, "provisioned" | "programme" | "competencies" | "belowFloor">, programmesOffered: number | null = null): string | null {
  if (!l.provisioned) return null;
  // P6: with no programme offered at all (production today) there is nothing to choose, and it is not asked.
  if (!l.programme) return noProgrammeText(programmesOffered);
  if (l.competencies === null) return null; // unreadable: the page says so on its own
  if (l.competencies.length === 0 && l.belowFloor === 0)
    return `${l.programme.label} has no competency catalogue Scholar can use yet, so no competencies are suggested for your notes. You can still study them: explanations, practice questions and revision work without it.`;
  return null;
}

export type CompetencyLabel = { title: string; code: string | null; layer: string; catalogue: string | null; structure?: string | null; contentStatus?: "approved" | "draft" | "unreviewed" | null };

/**
 * Names for competency ids on the person's own rows. From the catalogue when it offers them, otherwise from
 * the shared frameworks by id (a link made before the programme changed keeps its name). An id that is in
 * neither keeps its row and is named as such -- the link is the person's record, and is not hidden.
 */
export async function competencyLabels(admin: any, catalogue: CatalogueCompetency[] | null, ids: string[], layers: Map<string, string>): Promise<Map<string, CompetencyLabel>> {
  const out = new Map<string, CompetencyLabel>();
  for (const c of catalogue ?? []) out.set(c.id, { title: c.title, code: c.code, layer: c.layer, catalogue: c.catalogue, structure: structureLabel(c), contentStatus: c.contentStatus });
  const missing = [...new Set(ids)].filter(id => !out.has(id));
  if (missing.length) {
    const names = await referenceNames(admin, [], missing);
    for (const id of missing) out.set(id, { title: names.get(id) ?? "A competency no longer in your programme", code: null, layer: layers.get(id) ?? "profession", catalogue: null });
  }
  return out;
}

/**
 * COMPETEN-SCHOLAR-01 P1: the tutor's view of the student, assembled at request time from the person's own rows
 * (programme, accepted links on these passages, progress by competency) -- no memory store. Optional by design:
 * anything unreadable or absent (387/388 not applied, no programme) yields null and the tutor teaches without it.
 */
export async function loadTutorContext(admin: any, userId: string, chunkIds: readonly string[]): Promise<string | null> {
  try {
    const learner = await loadLearnerCatalogue(admin, userId);
    if (!learner.provisioned || !learner.programme) return null;
    // LEARN-01 L3: the level (402 history, the current period) pitches every explanation, catalogue or not.
    const history = await contextHistory(admin, userId);
    const level = history.ok ? history.periods.find(p => p.effectiveTo === null)?.levelLabel ?? null : null;
    // A programme with no usable catalogue (R1) still has a programme and a level: the rest is simply absent.
    if (!learner.competencies || !learner.competencies.length) return buildLearnerContext({ programme: learner.programme.label, level, passageCompetencies: [], progress: null });
    const rows = await competencyProgressRows(admin, userId);
    if (!rows.ok) return buildLearnerContext({ programme: learner.programme.label, level, passageCompetencies: [], progress: null });
    const byId = new Map(learner.competencies.map(c => [c.id, c]));
    const here = new Set(chunkIds);
    const passageCompetencies = rows.data.mappings
      .filter(m => here.has(m.chunkId) && m.state === "accepted" && byId.has(m.competencyId))
      .map(m => { const c = byId.get(m.competencyId)!; return { title: c.title, structure: structureLabel(c) }; });
    const progress = buildCompetencyProgress({
      competencies: learner.competencies,
      mappings: rows.data.mappings.map(m => ({ competencyId: m.competencyId, chunkId: m.chunkId, state: m.state })),
      questions: rows.data.questions, attempts: rows.data.attempts,
    }).layers.flatMap(l => l.rows);
    return buildLearnerContext({ programme: learner.programme.label, level, passageCompetencies, progress });
  } catch {
    return null;
  }
}
