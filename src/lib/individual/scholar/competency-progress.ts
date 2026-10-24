import { LAYERS, structureLabel, type CatalogueCompetency, type Layer } from "./catalogue";
import type { MappingState as MapState } from "@/lib/competency/mapping";

// ── PROGRESS BY COMPETENCY ── COMPETEN-SCHOLAR-01 S4, migrations 387 and 388 ─────────────────────────────
//
// Pure aggregation over rows the store already read by the person's own id. For each competency of their
// programme: how many sections of their notes are linked to it (accepted, still proposed), how many practice
// questions practise it, and how they did on the latest try of each.
//
// ⚠ NOT COMPETENCE (owner review P0.3, unchanged). Practice accuracy on AI-written questions from their own
// notes is not a judgement of competence, and the page never calls it one. A competency with no linked notes
// is "no notes linked yet". A competency with notes but no answered questions has accuracy null, shown as
// "not practised yet" -- never 0%, which would read as a measurement when nothing was measured.
//
// ⚠ PRACTICE COUNTS ONLY THROUGH AN ACCEPTED LINK. A question counts towards a competency only while the
// link from its section to that competency is ACCEPTED by the person -- a proposal is the AI's suggestion,
// not the person's, and a rejected link counts for nothing. This is the rule S5's competency coverage uses
// (accepted maps only), so the two agree number for number. Sections are still listed as accepted or
// suggested, so the person can see what is waiting for their decision.

export type ProgressMapping = { competencyId: string; chunkId: string; state: MapState };
export type ProgressQuestionLink = { id: string; chunkId: string; competencyId: string | null };
export type ProgressAnswer = { questionId: string; correct: boolean; answeredAt: string };

export type CompetencyStatus = "no_notes" | "notes_linked" | "practising";

export type CompetencyProgressRow = {
  id: string; layer: Layer; catalogue: string; domain: string; code: string | null; title: string;
  /** Where it sits in the clinical structure (practice, CPU), or null where the library has not placed it. */
  structure: string | null;
  sectionsAccepted: number; sectionsProposed: number;
  questions: number; answered: number;
  latestCorrect: number | null;
  /** Share right on the latest try, as a whole percentage. Null when nothing answered. */
  latestAccuracy: number | null;
  status: CompetencyStatus;
};

export type CompetencyProgress = {
  layers: { layer: Layer; rows: CompetencyProgressRow[] }[];
  totals: { competencies: number; withNotes: number; practising: number };
  /** Questions tied to a competency no longer in the programme (the programme changed). Counted, not hidden. */
  outsideProgramme: number;
};

export function buildCompetencyProgress(input: {
  competencies: CatalogueCompetency[];
  mappings: ProgressMapping[];
  questions: ProgressQuestionLink[];
  attempts: ProgressAnswer[];
}): CompetencyProgress {
  const latest = new Map<string, ProgressAnswer>();
  for (const a of input.attempts) {
    const prev = latest.get(a.questionId);
    if (!prev || a.answeredAt > prev.answeredAt) latest.set(a.questionId, a);
  }
  const inProgramme = new Set(input.competencies.map(c => c.id));
  const accepted = new Map<string, Set<string>>(), proposed = new Map<string, Set<string>>();
  for (const m of input.mappings) {
    if (m.state === "rejected") continue;
    const target = m.state === "accepted" ? accepted : proposed;
    if (!target.has(m.competencyId)) target.set(m.competencyId, new Set());
    target.get(m.competencyId)!.add(m.chunkId);
  }
  const qs = new Map<string, string[]>();
  let outsideProgramme = 0;
  const acceptedPair = new Set(input.mappings.filter(m => m.state === "accepted").map(m => `${m.chunkId}|${m.competencyId}`));
  for (const q of input.questions) {
    if (!q.competencyId || !acceptedPair.has(`${q.chunkId}|${q.competencyId}`)) continue;
    if (!inProgramme.has(q.competencyId)) { outsideProgramme++; continue; }
    if (!qs.has(q.competencyId)) qs.set(q.competencyId, []);
    qs.get(q.competencyId)!.push(q.id);
  }

  const rows: CompetencyProgressRow[] = input.competencies.map(c => {
    const acc = accepted.get(c.id) ?? new Set<string>();
    // A section both accepted and proposed (two links to one competency cannot exist -- 388's unique index)
    // is counted once, as accepted.
    const prop = [...(proposed.get(c.id) ?? [])].filter(x => !acc.has(x));
    const ids = qs.get(c.id) ?? [];
    const answered = ids.filter(id => latest.has(id));
    const right = answered.filter(id => latest.get(id)!.correct).length;
    const status: CompetencyStatus = answered.length ? "practising" : acc.size + prop.length + ids.length ? "notes_linked" : "no_notes";
    return {
      id: c.id, layer: c.layer, catalogue: c.catalogue, domain: c.domain, code: c.code, title: c.title, structure: structureLabel(c),
      sectionsAccepted: acc.size, sectionsProposed: prop.length, questions: ids.length, answered: answered.length,
      latestCorrect: answered.length ? right : null,
      latestAccuracy: answered.length ? Math.round((right / answered.length) * 100) : null,
      status,
    };
  });

  const order: readonly Layer[] = LAYERS;
  return {
    layers: order.map(layer => ({ layer, rows: rows.filter(r => r.layer === layer) })).filter(l => l.rows.length),
    totals: {
      competencies: rows.length,
      withNotes: rows.filter(r => r.status !== "no_notes").length,
      practising: rows.filter(r => r.status === "practising").length,
    },
    outsideProgramme,
  };
}
