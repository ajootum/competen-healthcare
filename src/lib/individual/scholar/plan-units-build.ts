import { LESSON_MAX_SECTIONS, lessonOutline, planSteps, stems, type SectionProfile } from "./learn";
import type { LearningStep, SectionRef } from "./store";
import { COMMON_STEM_MIN, COMMON_STEM_SHARE, UNIT_CUT_WEIGHT, UNIT_MAX_CHARS, UNIT_MAX_SECTIONS, unitCount, unitFrom, unitSections, type ProposedUnit, type UnitInput, type UnitSection } from "./plan-units";

// ── BUILDING THE LEARNING UNITS (server) ── SCHOLAR-PLAN-UNITS-01 ───────────────────────────────────────────────────────
// The Learn workspace's own lesson planner (learn.ts planSteps) over all of a material's sections, tuned for planning:
// a cut between alike neighbours costs more (UNIT_CUT_WEIGHT), a unit may be longer than one lesson, a heading word most
// of the material's headings carry ("care") is not compared, and a chapter's thin picture slides stay with it. Pure given
// the profiles (section text) already read: plan-data.ts reads them with sectionProfiles.

/** Pure. The heading stems most of the material's substantive headings share: ignored when neighbours are compared. */
export function commonStems(parts: readonly UnitSection[]): Set<string> {
  const headed = parts.filter(p => p.heading && !p.sparse);
  const count = new Map<string, number>();
  for (const p of headed) for (const w of new Set(stems(p.heading!))) count.set(w, (count.get(w) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= COMMON_STEM_MIN && n / headed.length >= COMMON_STEM_SHARE).map(([w]) => w));
}

/**
 * Pure. The proposed learning units of one material: the Learn planner's lessons over ALL of the material's sections (every
 * section is in exactly one unit, in document order), titled by the lesson outline. Sections the planner could not fit
 * (beyond its capacity) are grouped in runs of LESSON_MAX_SECTIONS after it, so nothing is left out.
 */
export function buildUnits(o: UnitInput & { profiles: ReadonlyMap<string, SectionProfile> }): ProposedUnit[] {
  const parts = unitSections(o);
  if (!parts.length) return [];
  const byId = new Map(parts.map(p => [p.chunkId, p]));
  const refs: SectionRef[] = parts.map(p => ({ chunkId: p.chunkId, materialId: o.materialId, ordinal: p.ordinal, pageFrom: p.page, pageTo: p.page, materialTitle: o.title, unit: o.unit }));
  const topics = new Map(parts.map(p => [p.chunkId, p.topics as readonly string[]]));
  const { steps } = planSteps(refs, topics, unitCount(parts), o.profiles, { cutWeight: UNIT_CUT_WEIGHT, maxSections: UNIT_MAX_SECTIONS, maxChars: UNIT_MAX_CHARS, ignoreStems: commonStems(parts), thinJoin: "any" });
  const covered = new Set(steps.flatMap(s => s.sections.map(x => x.chunkId)));
  const groups: LearningStep[] = [...steps];
  const rest = refs.filter(r => !covered.has(r.chunkId));
  for (let i = 0; i < rest.length; i += LESSON_MAX_SECTIONS) groups.push({ step: groups.length, sections: rest.slice(i, i + UNIT_MAX_SECTIONS) });
  const emptyUnits = o.quality?.emptyUnits ?? [];
  return groups.map((g, i) => unitFrom(`u${i + 1}`, g.sections.map(s => byId.get(s.chunkId)!), { unit: o.unit, emptyUnits, outline: lessonOutline(g, topics, o.profiles) }));
}
