/* eslint-disable @typescript-eslint/no-explicit-any */
import { proposeMappings, mappingStates, type MappingState, type MappingSubject } from "@/lib/competency/mapping";
import { buildCompetencyCoverage, type CompetencyCoverage } from "@/lib/competency/progress-model";
import type { CatalogueCompetency } from "@/lib/competency/foundation";
import { loadCatalogueFor } from "@/lib/individual/catalogue";
import { isNotProvisioned } from "../access";
import { referenceNames } from "./frameworks";

// ── PROFESSIONAL COMPETENCY MAPPING -- THE PERSON'S OWN STORE ── migration 393, shared engine ───────────────
//
// A goal, a CPD entry or a piece of evidence is linked to competencies of the catalogues Professional offers
// (S1 loadCatalogueFor(admin, "professional"), EMPTY until HQ allowlists one). The mapping ENGINE is the
// Holdings one (src/lib/competency/mapping.ts) -- this file only stores and reads.
//
// ⚠ SELF-DECLARED, NEVER VERIFIED. A link the person makes is source 'person' with an immediate 'accepted'
// decision. An AI suggestion is source 'ai' with no decision -- 'proposed' -- until the person accepts or
// rejects it. Every decision is a new row (append-only, 393). Nothing here says anyone checked anything.
//
// ⚠ ONLY OFFERED COMPETENCIES. Every write names a competency id that must be in the catalogue the caller
// passes (the Professional allowlist applied). A subject belongs to the person by composite key in 393.

export type SubjectKind = "goal" | "cpd" | "evidence";
export const SUBJECT_KINDS: readonly SubjectKind[] = ["goal", "cpd", "evidence"];
const COLUMN: Record<SubjectKind, "goal_id" | "cpd_id" | "evidence_id"> = { goal: "goal_id", cpd: "cpd_id", evidence: "evidence_id" };
const SUBJECT_TABLE: Record<SubjectKind, string> = { goal: "individual_professional_goal", cpd: "individual_professional_cpd", evidence: "individual_professional_evidence" };

export const isSubjectKind = (v: unknown): v is SubjectKind => typeof v === "string" && (SUBJECT_KINDS as readonly string[]).includes(v);
export const MAP_FRAMING = { person: "a healthcare professional", subjects: "entries in their own professional development record (goals, CPD activities and evidence)" };

export type SubjectMapping = {
  mapId: string; kind: SubjectKind; subjectId: string; competencyId: string;
  source: "person" | "ai"; confidence: number | null; rationale: string | null; state: MappingState;
};

/** Pure: map rows and their decisions as the person's mappings, newest decision winning. */
export function assembleMappings(rows: any[], decisions: any[]): SubjectMapping[] {
  const states = mappingStates(decisions.map(d => ({ mappingId: d.map_id, decision: d.decision, decidedBy: d.decided_by, createdAt: d.created_at })));
  return rows.map(r => {
    const kind: SubjectKind = r.goal_id ? "goal" : r.cpd_id ? "cpd" : "evidence";
    return {
      mapId: r.id, kind, subjectId: r.goal_id ?? r.cpd_id ?? r.evidence_id, competencyId: r.competency_id,
      source: r.source, confidence: r.confidence == null ? null : Number(r.confidence), rationale: r.rationale ?? null,
      state: states.get(r.id)?.state ?? "proposed",
    };
  });
}

/** The person's mappings. null = could not be read. Before 393 is applied: none (the access.ts rule). */
export async function listMappings(admin: any, userId: string, onNotProvisioned?: () => void): Promise<SubjectMapping[] | null> {
  try {
    const { data: rows, error } = await admin.from("individual_professional_competency_map")
      .select("id, goal_id, cpd_id, evidence_id, competency_id, source, confidence, rationale").eq("user_id", userId).limit(2000);
    if (error && isNotProvisioned(error)) { onNotProvisioned?.(); return []; }
    if (error) return null;
    if (!rows?.length) return [];
    const { data: decisions, error: dErr } = await admin.from("individual_professional_competency_decision")
      .select("map_id, decision, decided_by, created_at").eq("user_id", userId).in("map_id", rows.map((r: any) => r.id));
    return dErr ? null : assembleMappings(rows, decisions ?? []);
  } catch { return null; }
}

export type OfferedCompetency = { competencyId: string; code: string | null; title: string; catalogue: string };

/** What a page needs: the mappings, what is offered, and names for linked competencies no longer offered. */
export type MappingView = {
  provisioned: boolean;
  mappings: SubjectMapping[] | null;
  /** null = unreadable. [] = nothing offered (the default: the Professional allowlist is EMPTY). */
  offered: OfferedCompetency[] | null;
  /** The same, as the S1 rows, for coverage and gaps. */
  catalogue: CatalogueCompetency[] | null;
  names: Map<string, string>;
};

export async function loadMappingView(admin: any, userId: string): Promise<MappingView> {
  let provisioned = true;
  const [mappings, catalogue] = await Promise.all([listMappings(admin, userId, () => { provisioned = false; }), loadCatalogueFor(admin, "professional")]);
  const offered = catalogue?.map(c => ({ competencyId: c.competencyId, code: c.code, title: c.title, catalogue: c.catalogue.name })) ?? null;
  const names = new Map((offered ?? []).map(o => [o.competencyId, o.title]));
  const missing = [...new Set((mappings ?? []).map(m => m.competencyId).filter(id => !names.has(id)))];
  if (missing.length) for (const [id, n] of await referenceNames(admin, [], missing)) names.set(id, n);
  return { provisioned, mappings, offered, catalogue, names };
}

/** Pure: one entry's links for the page, named. A competency with no readable name says so. */
export function linksFor(view: Pick<MappingView, "mappings" | "names">, kind: SubjectKind, subjectId: string) {
  return (view.mappings ?? []).filter(m => m.kind === kind && m.subjectId === subjectId).map(m => ({
    mapId: m.mapId, competencyId: m.competencyId, title: view.names.get(m.competencyId) ?? "A competency no longer offered",
    source: m.source, state: m.state, rationale: m.rationale,
  }));
}

const offered = (catalogue: readonly CatalogueCompetency[], competencyId: string) => catalogue.some(c => c.competencyId === competencyId);

/** The person links a subject to an offered competency: source person, accepted at once. */
export async function addPersonMapping(admin: any, userId: string, kind: SubjectKind, subjectId: string, competencyId: string, catalogue: readonly CatalogueCompetency[])
  : Promise<"ok" | "exists" | "not_offered" | "not_found" | "failed"> {
  if (!offered(catalogue, competencyId)) return "not_offered";
  const { data: own } = await admin.from(SUBJECT_TABLE[kind]).select("id").eq("id", subjectId).eq("user_id", userId).maybeSingle();
  if (!own) return "not_found";
  const { data, error } = await admin.from("individual_professional_competency_map")
    .insert({ user_id: userId, [COLUMN[kind]]: subjectId, competency_id: competencyId, source: "person" }).select("id").single();
  if (error && !/duplicate key|unique/i.test(error.message)) return "failed";
  if (error) {
    // Already there. Linking again after a rejection, or accepting what the AI suggested, is a new decision.
    const { data: prior } = await admin.from("individual_professional_competency_map").select("id")
      .eq("user_id", userId).eq(COLUMN[kind], subjectId).eq("competency_id", competencyId).maybeSingle();
    if (!prior) return "failed";
    const { data: ds } = await admin.from("individual_professional_competency_decision").select("map_id, decision, decided_by, created_at")
      .eq("user_id", userId).eq("map_id", prior.id);
    if (assembleMappings([{ id: prior.id, goal_id: subjectId, competency_id: competencyId }], ds ?? [])[0].state === "accepted") return "exists";
    return (await decideMapping(admin, userId, prior.id, "accepted")) === "ok" ? "ok" : "failed";
  }
  const d = await admin.from("individual_professional_competency_decision").insert({ user_id: userId, map_id: data.id, decision: "accepted", decided_by: "person" });
  return d.error ? "failed" : "ok";
}

/** The person accepts or rejects one of their own mappings. A new decision row; nothing is overwritten. */
export async function decideMapping(admin: any, userId: string, mapId: string, decision: "accepted" | "rejected"): Promise<"ok" | "not_found" | "failed"> {
  const { data: m } = await admin.from("individual_professional_competency_map").select("id").eq("id", mapId).eq("user_id", userId).maybeSingle();
  if (!m) return "not_found";
  const { error } = await admin.from("individual_professional_competency_decision").insert({ user_id: userId, map_id: mapId, decision, decided_by: "person" });
  return error ? "failed" : "ok";
}

/** Pure: the text the engine reads for a subject -- the person's own words, nothing else. */
export function subjectText(kind: SubjectKind, row: any): string {
  const parts = kind === "goal" ? [row.title, row.detail] : kind === "cpd" ? [row.title, row.provider, row.reflection] : [row.title, row.detail, row.issuing_body];
  return parts.filter((p: unknown) => typeof p === "string" && p.trim()).join(". ").slice(0, 2000);
}

/**
 * Ask the shared engine for suggestions for up to 6 of the person's own subjects, and store each proposal as
 * source 'ai' with no decision (proposed). A pair already mapped is not proposed again. The caller has
 * already applied the guard, the AI configuration and quota checks.
 */
export async function proposeForSubjects(admin: any, userId: string, subjects: { kind: SubjectKind; row: any }[], catalogue: CatalogueCompetency[])
  : Promise<{ ok: true; proposed: number; model: string } | { ok: false; error: string }> {
  if (!catalogue.length) return { ok: false, error: "no_catalogue" };
  const refs = new Map(subjects.map(s => [`${s.kind}:${s.row.id}`, s]));
  const mappingSubjects: MappingSubject[] = subjects.map(s => ({ ref: `${s.kind}:${s.row.id}`, text: subjectText(s.kind, s.row) })).filter(s => s.text.length >= 3);
  if (!mappingSubjects.length) return { ok: false, error: "no_text" };
  const r = await proposeMappings({ subjects: mappingSubjects, candidates: catalogue, framing: MAP_FRAMING,
    context: { userId, attribution: { scope: "person" }, operation: "individual_professional_map" } });
  if (!r.ok) return { ok: false, error: String(r.error) };
  const current = await listMappings(admin, userId);
  if (current === null) return { ok: false, error: "failed" };
  const existing = new Set(current.map(m => `${m.kind}:${m.subjectId}:${m.competencyId}`));
  const rows: any[] = [];
  for (const sa of r.check.subjects) {
    const s = refs.get(sa.ref); if (!s) continue;
    for (const p of sa.proposals) {
      if (!offered(catalogue, p.competencyId) || existing.has(`${sa.ref}:${p.competencyId}`)) continue;
      existing.add(`${sa.ref}:${p.competencyId}`);
      rows.push({ user_id: userId, [COLUMN[s.kind]]: s.row.id, competency_id: p.competencyId, source: "ai",
        confidence: Math.round(p.confidence * 100) / 100, rationale: p.rationale, model: r.model, prompt_version: r.promptVersion });
    }
  }
  if (rows.length) {
    const { error } = await admin.from("individual_professional_competency_map").insert(rows);
    if (error) return { ok: false, error: "failed" };
  }
  return { ok: true, proposed: rows.length, model: r.model };
}

/**
 * Pure: the competencies a person's accepted mappings (and the 373 single links on needs and evidence) touch,
 * counted as evidence for the shared progress model. Evidence = CPD and evidence rows; positive = those
 * backed by a document (source_linked). Goals are intent, not evidence, and are not counted here.
 */
export function evidenceByCompetency(mappings: readonly SubjectMapping[], record: { cpd: any[] | null; evidence: any[] | null }): Map<string, { evidence: number; positive: number }> {
  const out = new Map<string, { evidence: number; positive: number }>();
  const cls = new Map<string, string>();
  for (const c of record.cpd ?? []) cls.set(`cpd:${c.id}`, c.evidence_class);
  for (const e of record.evidence ?? []) cls.set(`evidence:${e.id}`, e.evidence_class);
  const counted = new Set<string>();
  const add = (competencyId: string, key: string) => {
    if (counted.has(`${competencyId}|${key}`)) return;
    counted.add(`${competencyId}|${key}`);
    const v = out.get(competencyId) ?? { evidence: 0, positive: 0 };
    v.evidence++; if (cls.get(key) === "source_linked") v.positive++;
    out.set(competencyId, v);
  };
  for (const m of mappings) if (m.state === "accepted" && m.kind !== "goal") add(m.competencyId, `${m.kind}:${m.subjectId}`);
  for (const e of record.evidence ?? []) if (e.framework_competency_id) add(e.framework_competency_id, `evidence:${e.id}`);
  return out;
}

/** Pure: per goal, the competencies it aims at (accepted) that no evidence touches yet -- the gaps. */
export function goalGaps(mappings: readonly SubjectMapping[], evidence: Map<string, { evidence: number }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of mappings) {
    if (m.kind !== "goal" || m.state !== "accepted") continue;
    if ((evidence.get(m.competencyId)?.evidence ?? 0) > 0) continue;
    out.set(m.subjectId, [...(out.get(m.subjectId) ?? []), m.competencyId]);
  }
  return out;
}

/** Why Professional coverage is not measured, in Professional words (the shared model's reasons, overridden). */
export const PROFESSIONAL_COVERAGE_REASONS = {
  noCatalogue: "Competen Professional does not offer a competency catalogue yet, so there is nothing to measure against.",
  noEvidenceSource: "Competency links are not set up on this environment yet.",
  unreadable: "Your record or the competencies on offer could not be read just now.",
} as const;

export type GoalGap = { goalId: string; title: string; competencies: { id: string; name: string; expected: string | null }[] };

/**
 * Pure: Progress for the slice. Coverage of the offered catalogue through the SHARED progress model, from
 * accepted links on CPD and evidence. Goal gaps: what each open goal aims at that nothing evidences yet, by
 * the expected level S1 sets. Covered means touched, never achieved -- and nothing here is verified.
 */
export function professionalProgress(view: Pick<MappingView, "provisioned" | "mappings" | "catalogue" | "names">,
  record: { goals: { id: string; title: string; status: string }[] | null; cpd: any[] | null; evidence: any[] | null })
  : { coverage: CompetencyCoverage; goalGaps: GoalGap[] | null } {
  const unreadable = view.mappings === null || view.catalogue === null || record.cpd === null || record.evidence === null;
  const evidence = unreadable ? null : evidenceByCompetency(view.mappings!, record);
  const coverage = buildCompetencyCoverage({
    unreadable,
    catalogue: view.catalogue?.length ? view.catalogue.map(c => ({ id: c.competencyId, name: c.title, frameworkName: c.catalogue.name, expectedLevel: c.expectedLevel })) : null,
    evidence: view.provisioned ? evidence : null,
    reasons: PROFESSIONAL_COVERAGE_REASONS,
  });
  if (unreadable || record.goals === null || !evidence) return { coverage, goalGaps: unreadable || record.goals === null ? null : [] };
  const expected = new Map((view.catalogue ?? []).map(c => [c.competencyId, c.expectedLevel]));
  const gaps = goalGaps(view.mappings!, evidence);
  const goalGapsOut = record.goals.filter(g => (g.status === "planned" || g.status === "in_progress") && gaps.has(g.id)).map(g => ({
    goalId: g.id, title: g.title,
    competencies: gaps.get(g.id)!.map(id => ({ id, name: view.names.get(id) ?? "A competency no longer offered", expected: expected.get(id)?.label ?? null, score: expected.get(id)?.score ?? -1 }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(c => ({ id: c.id, name: c.name, expected: c.expected })),
  }));
  return { coverage, goalGaps: goalGapsOut };
}
