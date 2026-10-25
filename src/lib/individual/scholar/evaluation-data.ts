/* eslint-disable @typescript-eslint/no-explicit-any */
// ── EVALUATION-01 (Stage 6): A SCOPE'S EVIDENCE, READ IN PLACE, AND ITS EVALUATION ─────────────────────────────
//
// The I/O around the pure engine (evaluation.ts). A scope -- all of the student's evidence, a topic, a document,
// chosen documents, a CFCA competency or one of its learning outcomes, or a clinical context -- is resolved to the
// student's own sections with the resolver Learn and Revision already use (learn.ts resolveScope). The evidence is
// read where it lies (store.ts evaluationEvidence) and handed to the engine with the rules the Individual policy
// gives (the existing WCE engine, versioned and audited). Nothing is copied: an evaluation record names the
// evidence it read by id.

import { isUuid, listMaterials, sectionLinks, sectionsOf, evaluationEvidence, type SectionRef } from "./store";
import { resolveScope, type LearningScope } from "./learn";
import { loadLearnerCatalogue } from "./competency-view";
import { CASE_CONTEXT_LABEL, CASE_CONTEXTS, type CaseContext } from "./config";
import { evaluate, type ECompetency, type EvaluationRules, type EvidenceSet, type Evaluation } from "./evaluation";
import type { IndividualPolicy } from "../policy";

export type EvaluationScope = LearningScope | { kind: "all" } | { kind: "outcome"; competencyId: string; outcome: string } | { kind: "context"; context: CaseContext };
export type ScopeView = { kind: EvaluationScope["kind"]; label: string; ids?: string[]; outcome?: string; context?: string };

/** A scope from a request body. A string is the reason it was refused. Learn and Revision's scopes, plus all, outcome and context. */
export function parseEvaluationScope(s: Record<string, unknown> | null | undefined, parse: (b: { scope?: Record<string, unknown> }) => LearningScope | string): EvaluationScope | string {
  const v = s ?? {};
  if (v.kind === "all") return { kind: "all" };
  if (v.kind === "outcome") {
    const outcome = typeof v.outcome === "string" ? v.outcome.trim() : "";
    return isUuid(v.competencyId) && outcome.length >= 2 && outcome.length <= 500 ? { kind: "outcome", competencyId: v.competencyId as string, outcome } : "Choose a learning outcome.";
  }
  if (v.kind === "context") return (CASE_CONTEXTS as readonly string[]).includes(v.context as string) ? { kind: "context", context: v.context as CaseContext } : "Choose a clinical context.";
  return parse({ scope: v });
}

const sectionLabel = (s: SectionRef) => (s.pageFrom !== null ? `${s.unit} ${s.pageFrom}` : `section ${s.ordinal}`);

/** The rules the Individual policy gives an evaluation. */
export function evaluationRules(p: IndividualPolicy): EvaluationRules {
  return {
    minEvidence: p.scholarEvaluationMinEvidence, recencyDays: p.scholarEvaluationRecencyDays, minSources: p.scholarEvaluationMinSources,
    bands: { strong: p.scholarEvaluationBandStrong, developing: p.scholarEvaluationBandDeveloping }, evidence: p.scholarEvaluationEvidence,
  };
}

/** Which version of the configuration applied: the Individual policy partition's latest published version. */
export async function configVersion(admin: any): Promise<string> {
  const { data } = await admin.from("workspace_config_versions").select("id, created_at").eq("scope_type", "platform").eq("scope_ref", "individual")
    .eq("status", "published").order("created_at", { ascending: false }).limit(1);
  const v = (data ?? [])[0];
  return v ? `individual-policy@${v.id}` : "individual-policy@defaults";
}

export type ScopedEvaluation = { ok: true; scope: ScopeView; evaluation: Evaluation; rules: EvaluationRules; context: { programme: string | null; level: string | null } }
  | { ok: false; status: number; error: string };

/**
 * Pure-at-heart: resolve the scope, read the evidence, evaluate. `method` fresh reads only the fresh knowledge
 * check's answers; combined reads everything and marks which answers the fresh check gave.
 */
export async function evaluateScope(admin: any, userId: string, policy: IndividualPolicy, scope: EvaluationScope, opts: { method: "existing" | "fresh" | "combined"; freshSessionId?: string | null; now: string }): Promise<ScopedEvaluation> {
  const learner = await loadLearnerCatalogue(admin, userId);
  const catalogue: ECompetency[] | null = learner.competencies?.length ? learner.competencies.map(c => ({
    id: c.id, title: c.title, code: c.code, domain: c.domain, practice: c.practice?.name ?? null, cpu: c.cpu ? [c.cpu.code, c.cpu.name].filter(Boolean).join(" ") : null,
    outcomes: c.outcomes, expectedLevel: c.expectedLevel,
  })) : null;
  const ev = await evaluationEvidence(admin, userId);
  if (!ev.ok) return { ok: false, status: 503, error: "Your learning evidence could not be read just now." };

  let sections: SectionRef[] = [], view: ScopeView;
  let decisions = ev.data.decisions;
  if (scope.kind === "all" || scope.kind === "context") {
    const mats = await listMaterials(admin, userId);
    if (!mats.ok) return { ok: false, status: 503, error: "Your materials could not be read just now." };
    const all = await sectionsOf(admin, userId, mats.data.map(m => m.id));
    if (!all.ok) return { ok: false, status: 503, error: "Your materials could not be read just now." };
    if (scope.kind === "all") { sections = all.data; view = { kind: "all", label: "All your learning" }; }
    else {
      // A clinical context tags cases, not notes: the scope is the sections this context's cases were written from.
      decisions = decisions.filter(d => d.context === scope.context);
      const used = new Set(decisions.flatMap(d => d.chunkIds));
      sections = all.data.filter(s => used.has(s.chunkId));
      view = { kind: "context", label: `${CASE_CONTEXT_LABEL[scope.context]} cases`, context: scope.context };
    }
  } else if (scope.kind === "outcome") {
    const r = await resolveScope(admin, userId, { kind: "competency", competencyId: scope.competencyId });
    if (!r.ok) return r;
    const links = await sectionLinks(admin, userId, r.sections.map(s => s.chunkId));
    const named = new Set(links.filter(l => l.competencyId === scope.competencyId && l.outcome === scope.outcome).map(l => l.chunkId));
    sections = r.sections.filter(s => named.has(s.chunkId));
    if (!sections.length) return { ok: false, status: 404, error: "None of your notes is linked to that learning outcome yet." };
    view = { kind: "outcome", label: scope.outcome, ids: [scope.competencyId], outcome: scope.outcome };
  } else {
    const title = scope.kind === "competency" ? learner.competencies?.find(c => c.id === scope.competencyId)?.title ?? null : null;
    const r = await resolveScope(admin, userId, scope, { competencyTitle: title });
    if (!r.ok) return r;
    sections = r.sections;
    view = { kind: scope.kind, label: r.title, ids: scope.kind === "document" ? [scope.materialId] : scope.kind === "documents" ? scope.materialIds : scope.kind === "competency" ? [scope.competencyId] : scope.kind === "section" ? [scope.chunkId] : undefined };
  }

  const links = (await sectionLinks(admin, userId, sections.map(s => s.chunkId)))
    .filter(l => scope.kind !== "outcome" || (l.competencyId === scope.competencyId && l.outcome === scope.outcome));
  const fresh = opts.method === "existing" ? null : opts.freshSessionId ?? null;
  const set: EvidenceSet = {
    sections: sections.map(s => ({ chunkId: s.chunkId, materialId: s.materialId, materialTitle: s.materialTitle, label: sectionLabel(s) })),
    questions: ev.data.questions,
    attempts: opts.method === "fresh" ? ev.data.attempts.filter(a => a.sessionId === fresh) : ev.data.attempts,
    reviews: opts.method === "fresh" ? [] : ev.data.reviews,
    checks: opts.method === "fresh" ? [] : ev.data.checks,
    decisions: opts.method === "fresh" ? [] : decisions,
    links: links.map(l => ({ chunkId: l.chunkId, competencyId: l.competencyId, outcome: l.outcome })),
    catalogue, freshSessionId: fresh,
  };
  const rules = evaluationRules(policy);
  return { ok: true, scope: view, rules, evaluation: evaluate(set, rules, opts.now), context: { programme: learner.programme?.label ?? null, level: learner.programme?.level ?? null } };
}
