import type { CpdEntry, EvidenceItem, Goal, Need } from "./record";
import type { ActivityGoalLink, GoalEvidenceLink, GoalReview, Milestone, PlanActivity, PlanCompetencyLink } from "./plan-store";
import type { NeedCompetencyLink, Reflection } from "./needs-store";
import type { LearningReference } from "@/lib/learning/products";
import type { LearningReflection } from "./learning-reflections";
import type { SubjectMapping } from "./mapping-store";
import type { PassportCompetency } from "../passport";
import type { ProfessionalEvaluationPolicy } from "../policy";
import {
  DIMENSIONS, FORMATIVE_NOTICE, MISSING_NOTICE, OUTCOMES_NOTICE, SCOPE_LABEL,
  type ConfidenceLevel, type Dimension, type Provenance, type RecommendationRule, type ScopeKind, type SourceKind,
} from "./evaluation-vocabulary";

// ── MY PROFESSIONAL EVALUATION: THE INTERPRETATION ── COMPETEN-PROFESSIONAL-EVALUATION-01 E2, E4, E5 ───────────────────
//
// PURE. Given the person's own records, as their owning modules read them (evaluation-sources.ts), a scope and the
// policy, this says what the records support in SIX SEPARATE DIMENSIONS, with every source reference, its provenance,
// date, framework version and method, and what it cannot support. It writes nothing and calls nothing.
//
// ⚠ NO SCORE. Nothing here adds dimensions together, weights them or ranks the person. Evidence confidence is about
// the EVIDENCE (how much, what kind, how recent), says why in words, and is never combined with anything.
//
// ⚠ MISSING IS NOT INCOMPETENT. A dimension with nothing in it is "Nothing recorded yet", with that sentence, never a
// gap in the person. Areas of development come only from what the person said (their needs, interest flags, open
// goals), never from absent records. A recommendation offered because evidence is thin says exactly that.
//
// ⚠ VERIFICATION IS READ, NEVER MADE. Only a C5 decision or an organisation assessment on the Passport is
// "independently verified". Self-assessment, CPD, courses, certificates, feedback and AI never are.

// ── INPUT: what the owning modules returned. null = could not be read, [] = none. ──────────────────────────────────

export type Stage5Entry = {
  id: string; kind: "catalogue" | "personal"; framework_competency_id: string | null; framework_version: string | null; title: string;
  removed_at: string | null; interest: boolean;
};
export type Stage5Assessment = {
  id: string; my_competency_id: string; learning_outcome: string | null; framework_version: string | null; scale_label: string | null;
  level_label: string; confidence_label: string | null; development_interest: boolean; assessed_at: string;
};
/** A 520 link, resolved to its source kind and id (Stage 5's linkKind / linkSourceId). */
export type Stage5Link = {
  id: string; my_competency_id: string; kind: string; sourceId: string; learning_outcome: string | null; framework_version: string | null;
  relation_code: string; relation_label: string; source: "person" | "ai"; linked_at: string; unlinked_at: string | null;
};
export type Stage5Input = { available: boolean; entries: Stage5Entry[] | null; assessments: Stage5Assessment[] | null; links: Stage5Link[] | null };

/**
 * A C5 decision as Stage 6 shows it. Stage 6 never writes one. `current`: not revoked, superseded or expired.
 * `verified`: current AND its outcome class is verified -- the only thing Stage 6 calls independently verified.
 */
export type VerificationDecision = {
  id: string; myCompetencyId: string | null; frameworkCompetencyId: string | null; title: string; outcomeLabel: string;
  current: boolean; verified: boolean; state: string; decidedOn: string | null; assessor: string | null; method: string | null; frameworkVersion: string | null;
  learningOutcomes: string[]; href: string | null;
};
export type VerificationInput = { available: boolean; decisions: VerificationDecision[] | null };

export type EvaluationInput = {
  today: string;
  needs: Need[] | null; goals: Goal[] | null; cpd: CpdEntry[] | null; evidence: EvidenceItem[] | null;
  activities: PlanActivity[] | null; activityGoals: ActivityGoalLink[] | null; milestones: Milestone[] | null;
  planCompetencies: PlanCompetencyLink[] | null; goalEvidence: GoalEvidenceLink[] | null; reviews: GoalReview[] | null;
  needCompetencies: NeedCompetencyLink[] | null; goalNeeds: { goal_id: string; need_id: string }[] | null; reflections: Reflection[] | null;
  learning: { enabled: boolean; refs: LearningReference[] | null };
  learningReflections: { available: boolean; bySubject: Map<string, LearningReflection[]> } | null;
  mappings: SubjectMapping[] | null;
  passport: PassportCompetency[] | null;
  stage5: Stage5Input;
  verification: VerificationInput;
  /** Competency names, by framework competency id (the catalogue and earlier links). */
  names: ReadonlyMap<string, string>;
  /** Framework versions as offered now, by framework competency id. */
  versions: ReadonlyMap<string, string | null>;
  hrefs: EvaluationHrefs;
};

export type EvaluationHrefs = {
  cpd: string; development: string; goal: (id: string) => string; need: (id: string) => string; competencies: string; competency: (entryId: string) => string;
  learning: (competencyId: string | null) => string; learningRecord: (id: string) => string; verification: string | null;
};

export type Scope = { kind: ScopeKind; ref: string | null; outcome?: string | null; from?: string | null; to?: string | null };

// ── OUTPUT ───────────────────────────────────────────────────────────────────────────────────────────────────

export type SourceRef = {
  key: string; kind: SourceKind; id: string; title: string; date: string | null; provenance: Provenance; classText: string;
  dimensions: Dimension[]; method: string | null; frameworkVersion: string | null; competency: string | null; outcome: string | null;
  via: string | null; href: string | null;
};

export type FindingState = "supported" | "limited" | "not_recorded" | "not_available";
export const FINDING_STATE_LABEL: Record<FindingState, string> = {
  supported: "Evidence recorded", limited: "Limited evidence", not_recorded: "Nothing recorded yet", not_available: "Not available",
};

export type Finding = {
  dimension: Dimension; state: FindingState; summary: string; sourceKeys: string[];
  provenance: Partial<Record<Provenance, number>>; first: string | null; last: string | null;
  frameworkVersions: string[]; methods: string[]; verification: string | null; limitations: string[];
  confidence?: ConfidenceLevel; reasons?: string[];
};

export type Point = { text: string; sourceKeys: string[] };
export type Recommendation = {
  key: string; rule: RecommendationRule; title: string; basis: string; dimension: Dimension; sourceKeys: string[];
  href: string | null; hrefLabel: string | null;
  /** Accepting creates this through its owning service (needs-store / plan-store). null = follow the link only. */
  creates: { kind: "need" | "goal" | "activity"; title: string; goalId?: string | null; needId?: string | null; competencyId?: string | null } | null;
};

export type Evaluation = {
  scope: Scope & { label: string };
  sources: SourceRef[];
  findings: Record<Dimension, Finding>;
  strengths: Point[]; development: Point[]; limitations: string[];
  competencies: { id: string | null; name: string; version: string | null; outcomes: string[]; personal: boolean }[];
  recommendations: Recommendation[];
  frameworkVersions: string[];
  notices: string[];
};

// ── HELPERS ──────────────────────────────────────────────────────────────────────────────────────────────────

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFKC").toLowerCase();
export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
const uniq = <T,>(xs: readonly T[]) => [...new Set(xs)];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Owner GO s5: four distinctions, by the source record's own class. */
export function classProvenance(cls: string | null | undefined): Provenance {
  return cls === "source_linked" ? "document_supported" : cls === "platform_recorded" ? "platform_recorded" : "self_reported";
}
export function learningProvenanceOf(r: Pick<LearningReference, "completionKind" | "evidenceClass">): Provenance {
  if (r.completionKind === "assessed_knowledge") return "formative";
  return r.evidenceClass === "platform_recorded" ? "platform_recorded" : r.evidenceClass === "source_linked" ? "document_supported" : "self_reported";
}

const KNOWLEDGE_RELATIONS = new Set(["knowledge", "understanding", "assesses", "develops", "introduces"]);
const APPLICATION_RELATIONS = new Set(["application", "practical", "experience", "practises", "practice", "observation", "feedback"]);

// ── SCOPE RESOLUTION ─────────────────────────────────────────────────────────────────────────────────────────

type InScope = {
  goals: Set<string>; needs: Set<string>; cpd: Set<string>; records: Set<string>; evidence: Set<string>; reflections: Set<string>;
  activities: Set<string>; competencies: Set<string>; entries: Set<string>; outcome: string | null; via: Map<string, string>;
};

function resolveScope(input: EvaluationInput, scope: Scope): InScope | null {
  const s: InScope = { goals: new Set(), needs: new Set(), cpd: new Set(), records: new Set(), evidence: new Set(), reflections: new Set(),
    activities: new Set(), competencies: new Set(), entries: new Set(), outcome: scope.outcome ?? null, via: new Map() };
  const liveEntries = (input.stage5.entries ?? []).filter(e => !e.removed_at);
  const liveLinks = (input.stage5.links ?? []).filter(l => !l.unlinked_at);
  const activityGoals = input.activityGoals ?? [];
  const activities = input.activities ?? [];

  const addGoal = (gid: string, via: string | null) => {
    if (s.goals.has(gid)) return;
    s.goals.add(gid);
    for (const c of input.cpd ?? []) if (c.goal_id === gid) { s.cpd.add(c.id); if (via) s.via.set(`cpd:${c.id}`, via); }
    for (const l of activityGoals.filter(l => l.goal_id === gid)) {
      s.activities.add(l.activity_id);
      const a = activities.find(x => x.id === l.activity_id);
      if (a?.cpd_id) s.cpd.add(a.cpd_id);
      if (a?.learning_record_id) s.records.add(a.learning_record_id);
    }
    for (const e of (input.goalEvidence ?? []).filter(e => e.goal_id === gid && !e.unlinked_at)) {
      if (e.evidence_id) s.evidence.add(e.evidence_id);
      if (e.reflection_id) s.reflections.add(e.reflection_id);
    }
    for (const l of (input.planCompetencies ?? []).filter(l => !l.unlinked_at && (l.goal_id === gid || (l.activity_id && s.activities.has(l.activity_id)))))
      s.competencies.add(l.framework_competency_id);
    for (const m of (input.mappings ?? []).filter(m => m.kind === "goal" && m.subjectId === gid && m.state === "accepted")) s.competencies.add(m.competencyId);
  };
  const addCompetency = (cid: string) => {
    s.competencies.add(cid);
    for (const e of liveEntries.filter(e => e.framework_competency_id === cid)) s.entries.add(e.id);
  };
  const recordsOfCompetencies = () => {
    // Records the person linked to a competency in scope (393 mappings, 520 links), and courses that cover it.
    for (const m of (input.mappings ?? []).filter(m => m.state === "accepted" && s.competencies.has(m.competencyId))) {
      if (m.kind === "cpd") s.cpd.add(m.subjectId);
      if (m.kind === "evidence") s.evidence.add(m.subjectId);
    }
    for (const r of input.learning.refs ?? []) if (r.competencies.some(c => s.competencies.has(c.id))) s.records.add(r.recordId);
    for (const l of liveLinks.filter(l => s.entries.has(l.my_competency_id) && (!s.outcome || norm(l.learning_outcome) === norm(s.outcome)))) {
      if (l.kind === "cpd") s.cpd.add(l.sourceId);
      if (l.kind === "learning_record") s.records.add(l.sourceId);
      if (l.kind === "evidence") s.evidence.add(l.sourceId);
      if (l.kind === "reflection") s.reflections.add(l.sourceId);
    }
  };

  switch (scope.kind) {
    case "development": {
      for (const g of input.goals ?? []) s.goals.add(g.id);
      for (const n of input.needs ?? []) s.needs.add(n.id);
      for (const c of input.cpd ?? []) s.cpd.add(c.id);
      for (const r of input.learning.refs ?? []) s.records.add(r.recordId);
      for (const e of input.evidence ?? []) s.evidence.add(e.id);
      for (const r of input.reflections ?? []) s.reflections.add(r.id);
      for (const a of activities) s.activities.add(a.id);
      for (const e of liveEntries) { s.entries.add(e.id); if (e.framework_competency_id) s.competencies.add(e.framework_competency_id); }
      for (const l of input.planCompetencies ?? []) if (!l.unlinked_at) s.competencies.add(l.framework_competency_id);
      for (const l of input.needCompetencies ?? []) if (!l.unlinked_at) s.competencies.add(l.framework_competency_id);
      for (const m of input.mappings ?? []) if (m.state === "accepted") s.competencies.add(m.competencyId);
      return s;
    }
    case "goal": {
      const g = (input.goals ?? []).find(x => x.id === scope.ref);
      if (!g) return null;
      addGoal(g.id, null);
      if (g.need_id) s.needs.add(g.need_id);
      for (const l of input.goalNeeds ?? []) if (l.goal_id === g.id) s.needs.add(l.need_id);
      for (const cid of [...s.competencies]) addCompetency(cid);
      recordsOfCompetencies();
      return s;
    }
    case "area": {
      const n = (input.needs ?? []).find(x => x.id === scope.ref);
      if (!n) return null;
      s.needs.add(n.id);
      for (const g of input.goals ?? []) if (g.need_id === n.id) addGoal(g.id, null);
      for (const l of input.goalNeeds ?? []) if (l.need_id === n.id) addGoal(l.goal_id, null);
      for (const e of input.evidence ?? []) if (e.need_id === n.id) s.evidence.add(e.id);
      if (n.framework_competency_id) s.competencies.add(n.framework_competency_id);
      for (const l of input.needCompetencies ?? []) if (l.need_id === n.id && !l.unlinked_at) s.competencies.add(l.framework_competency_id);
      for (const cid of [...s.competencies]) addCompetency(cid);
      recordsOfCompetencies();
      return s;
    }
    case "competency":
    case "outcome": {
      // The ref is a 520 entry id (catalogue or personal) or a framework competency id.
      const entry = liveEntries.find(e => e.id === scope.ref);
      const cid = entry ? entry.framework_competency_id : scope.ref;
      if (entry) s.entries.add(entry.id);
      if (cid) {
        if (!entry && !input.names.has(cid) && !liveEntries.some(e => e.framework_competency_id === cid)) return null;
        addCompetency(cid);
        for (const n of input.needs ?? []) if (n.framework_competency_id === cid) s.needs.add(n.id);
        for (const l of input.needCompetencies ?? []) if (l.framework_competency_id === cid && !l.unlinked_at && (!s.outcome || norm(l.learning_outcome) === norm(s.outcome))) s.needs.add(l.need_id);
        for (const l of input.planCompetencies ?? []) {
          if (l.framework_competency_id !== cid || l.unlinked_at || (s.outcome && norm(l.learning_outcome) !== norm(s.outcome))) continue;
          if (l.goal_id) s.goals.add(l.goal_id);
          if (l.activity_id) s.activities.add(l.activity_id);
        }
      } else if (!entry) return null;
      recordsOfCompetencies();
      return s;
    }
    case "topic": {
      const words = norm(scope.ref).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
      if (!words.length) return null;
      const hit = (...t: (string | null | undefined)[]) => { const h = norm(t.join(" ")); return words.every(w => h.includes(w)); };
      for (const g of input.goals ?? []) if (hit(g.title, g.detail)) addGoal(g.id, null);
      for (const n of input.needs ?? []) if (hit(n.title, n.detail)) s.needs.add(n.id);
      for (const c of input.cpd ?? []) if (hit(c.title, c.provider)) s.cpd.add(c.id);
      for (const r of input.learning.refs ?? []) if (hit(r.title, r.provider)) s.records.add(r.recordId);
      for (const e of input.evidence ?? []) if (hit(e.title, e.detail)) s.evidence.add(e.id);
      for (const r of input.reflections ?? []) if (hit(r.body)) s.reflections.add(r.id);
      for (const a of activities) if (hit(a.title, a.detail)) s.activities.add(a.id);
      for (const e of liveEntries) if (hit(e.title)) { s.entries.add(e.id); if (e.framework_competency_id) s.competencies.add(e.framework_competency_id); }
      for (const [id, name] of input.names) if (hit(name)) s.competencies.add(id);
      return s;
    }
    case "cpd": {
      const c = (input.cpd ?? []).find(x => x.id === scope.ref);
      if (!c) return null;
      s.cpd.add(c.id);
      if (c.goal_id) s.goals.add(c.goal_id);
      for (const a of activities.filter(a => a.cpd_id === c.id)) { s.activities.add(a.id); for (const l of activityGoals) if (l.activity_id === a.id) s.goals.add(l.goal_id); }
      for (const m of (input.mappings ?? []).filter(m => m.kind === "cpd" && m.subjectId === c.id && m.state === "accepted")) s.competencies.add(m.competencyId);
      for (const l of liveLinks.filter(l => l.kind === "cpd" && l.sourceId === c.id)) s.entries.add(l.my_competency_id);
      return s;
    }
    case "learning": {
      const r = (input.learning.refs ?? []).find(x => x.recordId === scope.ref);
      if (!r) return null;
      s.records.add(r.recordId);
      for (const a of activities.filter(a => a.learning_record_id === r.recordId)) { s.activities.add(a.id); for (const l of activityGoals) if (l.activity_id === a.id) s.goals.add(l.goal_id); }
      for (const c of r.competencies) s.competencies.add(c.id);
      for (const l of liveLinks.filter(l => l.kind === "learning_record" && l.sourceId === r.recordId)) s.entries.add(l.my_competency_id);
      return s;
    }
  }
}

/** The scope's name, from the record it names. null = that record is not the person's (or no longer exists). */
export function scopeLabel(input: EvaluationInput, scope: Scope): string | null {
  switch (scope.kind) {
    case "development": return "My development as a whole";
    case "goal": return (input.goals ?? []).find(g => g.id === scope.ref)?.title ?? null;
    case "area": return (input.needs ?? []).find(n => n.id === scope.ref)?.title ?? null;
    case "cpd": return (input.cpd ?? []).find(c => c.id === scope.ref)?.title ?? null;
    case "learning": return (input.learning.refs ?? []).find(r => r.recordId === scope.ref)?.title ?? null;
    case "topic": return scope.ref ? `Topic: ${scope.ref}` : null;
    case "competency":
    case "outcome": {
      const e = (input.stage5.entries ?? []).find(x => x.id === scope.ref);
      const name = e?.title ?? (scope.ref ? input.names.get(scope.ref) : undefined);
      if (!name) return null;
      return scope.kind === "outcome" && scope.outcome ? `${name}: ${scope.outcome}` : name;
    }
  }
}

// ── THE EVALUATION ───────────────────────────────────────────────────────────────────────────────────────────

export function evaluate(input: EvaluationInput, scope: Scope, policy: ProfessionalEvaluationPolicy): Evaluation | null {
  const label = scopeLabel(input, scope);
  const s = label ? resolveScope(input, scope) : null;
  if (!label || !s) return null;
  const today = input.today;
  const from = scope.from ?? (policy.periodDays > 0 ? new Date(Date.parse(`${today}T00:00:00Z`) - policy.periodDays * 86400000).toISOString().slice(0, 10) : null);
  const to = scope.to ?? null;
  const inPeriod = (d: string | null) => !d || ((!from || d >= from) && (!to || d <= to));
  const sources: SourceRef[] = [];
  const push = (r: Omit<SourceRef, "key" | "via"> & { via?: string | null }) => {
    if (!inPeriod(r.date)) return;
    const key = `${r.kind}:${r.id}`;
    if (sources.some(x => x.key === key)) return;
    sources.push({ ...r, key, via: r.via ?? s.via.get(key) ?? null });
  };
  const nameOf = (cid: string | null) => (cid ? input.names.get(cid) ?? (input.stage5.entries ?? []).find(e => e.framework_competency_id === cid)?.title ?? null : null);
  const entryName = (eid: string) => (input.stage5.entries ?? []).find(e => e.id === eid)?.title ?? null;
  const links520 = (input.stage5.links ?? []).filter(l => !l.unlinked_at && s.entries.has(l.my_competency_id) && (!s.outcome || norm(l.learning_outcome) === norm(s.outcome)));
  const relationsFor = (kind: string, id: string) => links520.filter(l => l.kind === kind && l.sourceId === id);
  const dimsFor = (kind: string, id: string, base: Dimension[]): Dimension[] => {
    const rel = relationsFor(kind, id);
    const out = new Set<Dimension>(base);
    if (rel.length) out.add("competency_evidence");
    for (const l of rel) {
      if (KNOWLEDGE_RELATIONS.has(l.relation_code)) out.add("knowledge");
      if (APPLICATION_RELATIONS.has(l.relation_code)) out.add("application");
    }
    return [...out];
  };
  const competencyOf = (kind: string, id: string) => {
    const l = relationsFor(kind, id)[0];
    return l ? { competency: entryName(l.my_competency_id), outcome: l.learning_outcome, frameworkVersion: l.framework_version } : { competency: null, outcome: null, frameworkVersion: null };
  };

  // 1. Development activity: CPD, completed courses, plan activities and milestones.
  for (const c of (input.cpd ?? []).filter(c => s.cpd.has(c.id))) {
    const lr = input.learningReflections?.bySubject.get(`cpd:${c.id}`) ?? [];
    push({ kind: "cpd", id: c.id, title: c.title, date: c.activity_date, provenance: classProvenance(c.evidence_class),
      classText: c.document_name ? "Self-declared with a document attached" : "Self-declared",
      dimensions: dimsFor("cpd", c.id, ["development_activity", ...(c.reflection ? ["application" as const] : [])]),
      method: c.activity_type, ...competencyOf("cpd", c.id), href: input.hrefs.cpd });
    for (const r of lr) pushLearningReflection(r, "cpd entry");
  }
  for (const r of (input.learning.refs ?? []).filter(r => s.records.has(r.recordId))) {
    const p = learningProvenanceOf(r);
    push({ kind: "learning_record", id: r.recordId, title: r.title, date: r.completedOn, provenance: p, classText: r.evidenceLabel,
      dimensions: dimsFor("learning_record", r.recordId, p === "formative" ? ["development_activity", "knowledge"] : ["development_activity"]),
      method: r.outcomeLabel, competency: r.competencies.filter(c => s.competencies.has(c.id)).map(c => c.name)[0] ?? null, outcome: null,
      frameworkVersion: competencyOf("learning_record", r.recordId).frameworkVersion, href: input.hrefs.learningRecord(r.recordId) });
    for (const lr of input.learningReflections?.bySubject.get(`rec:${r.recordId}`) ?? []) pushLearningReflection(lr, "course");
  }
  function pushLearningReflection(r: LearningReflection, of: string) {
    push({ kind: "learning_reflection", id: r.reflectionId, title: `Reflection on a ${of}: ${r.impact === "applied" ? "learning applied in practice" : r.impact === "understood" ? "learning understood" : "learning completed"}`,
      date: day(r.createdAt), provenance: "self_reported", classText: "Reported by you, not verified",
      dimensions: r.impact === "applied" ? ["application"] : r.impact === "understood" ? ["knowledge"] : ["development_activity"],
      method: r.templateLabel, competency: null, outcome: null, frameworkVersion: null, href: input.hrefs.cpd });
  }
  for (const a of (input.activities ?? []).filter(a => s.activities.has(a.id) && (a.status === "completed" || a.status === "active"))) {
    push({ kind: "activity", id: a.id, title: a.title, date: day(a.planned_end ?? a.updated_at), provenance: "self_reported", classText: `Planned activity, ${a.status}`,
      dimensions: ["development_activity"], method: a.activity_type_label, competency: null, outcome: null, frameworkVersion: null,
      href: input.hrefs.development });
  }
  for (const m of (input.milestones ?? []).filter(m => s.goals.has(m.goal_id) && m.achieved_on)) {
    push({ kind: "milestone", id: m.id, title: m.title, date: m.achieved_on, provenance: "self_reported", classText: "Milestone marked achieved by you",
      dimensions: ["development_activity"], method: m.milestone_type_label, competency: null, outcome: null, frameworkVersion: null, href: input.hrefs.goal(m.goal_id) });
  }
  // 3. Application: goal reviews that say what was undertaken or learned, evidence items, private reflections.
  for (const r of (input.reviews ?? []).filter(r => s.goals.has(r.goal_id) && (r.undertaken || r.learned || r.changed))) {
    push({ kind: "goal_review", id: r.id, title: `Goal review`, date: day(r.reviewed_at), provenance: "self_reported", classText: "Your own review, private",
      dimensions: ["application"], method: null, competency: null, outcome: null, frameworkVersion: null, href: input.hrefs.goal(r.goal_id) });
  }
  for (const e of (input.evidence ?? []).filter(e => s.evidence.has(e.id))) {
    push({ kind: "evidence", id: e.id, title: e.title, date: e.issued_on ?? day(e.created_at), provenance: classProvenance(e.evidence_class),
      classText: e.document_name ? "Self-declared with a document attached" : "Self-declared",
      dimensions: dimsFor("evidence", e.id, ["application"]), method: e.kind, ...competencyOf("evidence", e.id), href: input.hrefs.competencies });
  }
  for (const r of (input.reflections ?? []).filter(r => s.reflections.has(r.id))) {
    // A reflection on learning is already in scope as that (one record, counted once).
    if (sources.some(x => x.kind === "learning_reflection" && x.id === r.id)) continue;
    push({ kind: "reflection", id: r.id, title: `Private reflection${r.template_label ? `: ${r.template_label}` : ""}`, date: day(r.created_at), provenance: "self_reported",
      classText: "Private to you", dimensions: dimsFor("reflection", r.id, ["application"]), method: null, ...competencyOf("reflection", r.id), href: input.hrefs.development });
  }
  // 4. Competency evidence: self-assessments (self-reported, always), 393 links on records.
  for (const a of (input.stage5.assessments ?? []).filter(a => s.entries.has(a.my_competency_id) && (!s.outcome || norm(a.learning_outcome) === norm(s.outcome)))) {
    push({ kind: "self_assessment", id: a.id, title: `Self-assessment: ${entryName(a.my_competency_id) ?? "a competency"}`, date: day(a.assessed_at), provenance: "self_reported",
      classText: `Self-reported${a.scale_label ? ` on ${a.scale_label}` : ""}: ${a.level_label}${a.confidence_label ? `, confidence ${a.confidence_label}` : ""}`,
      dimensions: ["competency_evidence"], method: "Self-assessment", competency: entryName(a.my_competency_id), outcome: a.learning_outcome,
      frameworkVersion: a.framework_version, href: input.hrefs.competency(a.my_competency_id) });
  }
  for (const m of (input.mappings ?? []).filter(m => m.state === "accepted" && s.competencies.has(m.competencyId) && ((m.kind === "cpd" && s.cpd.has(m.subjectId)) || (m.kind === "evidence" && s.evidence.has(m.subjectId))))) {
    const key = `${m.kind}:${m.subjectId}`;
    const src = sources.find(x => x.key === key);
    if (src && !src.dimensions.includes("competency_evidence")) { src.dimensions.push("competency_evidence"); src.competency ??= nameOf(m.competencyId); src.frameworkVersion ??= input.versions.get(m.competencyId) ?? null; }
  }
  // 5. Independent verification: C5 decisions and organisation assessments, read only.
  for (const d of (input.verification.decisions ?? []).filter(d => (d.myCompetencyId && s.entries.has(d.myCompetencyId)) || (d.frameworkCompetencyId && s.competencies.has(d.frameworkCompetencyId)))) {
    if (s.outcome && d.learningOutcomes.length && !d.learningOutcomes.some(o => norm(o) === norm(s.outcome))) continue;
    // An independent decision that is not a current verification (partial, further evidence, not demonstrated, expired,
    // revoked) is shown as exactly that: a decision at a point in time, never a finding of incompetence.
    push({ kind: "verification", id: d.id, title: `${d.title}: ${d.outcomeLabel}`, date: d.decidedOn, provenance: d.verified ? "independent_decision" : "independent_other",
      classText: d.verified ? `Independently verified${d.assessor ? ` by ${d.assessor}` : ""}` : `Independent decision${d.assessor ? ` by ${d.assessor}` : ""}, ${d.current ? d.state : `${d.state}, not current`}: not a current verification`,
      dimensions: ["independent_verification"], method: d.method, competency: d.title, outcome: d.learningOutcomes.join("; ") || null,
      frameworkVersion: d.frameworkVersion, href: d.href });
  }
  for (const p of (input.passport ?? []).filter(p => s.competencies.has(p.competencyId))) {
    push({ kind: "passport_assessment", id: p.competencyId, title: `${p.name}: ${p.outcome.replace(/_/g, " ")}`, date: day(p.decidedAt),
      provenance: p.current ? "independent_decision" : "independent_other",
      classText: p.current ? `Assessed by an organisation${p.issuer ? ` (${p.issuer})` : ""}` : `Organisation assessment, not current${p.expiryDate ? ` (expiry ${p.expiryDate})` : ""}`,
      dimensions: ["independent_verification"], method: "Organisation assessment", competency: p.name, outcome: null, frameworkVersion: null, href: null });
  }

  // ── FINDINGS ──
  const of = (d: Dimension) => sources.filter(x => x.dimensions.includes(d));
  const base = (d: Dimension, xs: SourceRef[]): Finding => {
    const dates = xs.map(x => x.date).filter((v): v is string => !!v).sort();
    const prov: Partial<Record<Provenance, number>> = {};
    for (const x of xs) prov[x.provenance] = (prov[x.provenance] ?? 0) + 1;
    return { dimension: d, state: "not_recorded", summary: "", sourceKeys: xs.map(x => x.key), provenance: prov, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null,
      frameworkVersions: uniq(xs.map(x => x.frameworkVersion).filter((v): v is string => !!v)), methods: uniq(xs.map(x => x.method).filter((v): v is string => !!v)),
      verification: null, limitations: [] };
  };
  const unreadable: string[] = [];
  if (input.cpd === null) unreadable.push("Your CPD log could not be read just now, so it is not included.");
  if (input.learning.enabled && input.learning.refs === null) unreadable.push("Your Competen Learning record could not be read just now, so it is not included.");
  if (input.evidence === null) unreadable.push("Your evidence items could not be read just now, so they are not included.");
  if (input.stage5.available && (input.stage5.entries === null || input.stage5.assessments === null || input.stage5.links === null)) unreadable.push("Your competencies could not be read just now, so they are not included.");
  if (input.verification.available && input.verification.decisions === null) unreadable.push("Verification decisions could not be read just now, so none are shown.");
  if (input.passport === null) unreadable.push("Your Passport assessments could not be read just now, so none are shown.");

  const nothing = (what: string) => `Nothing recorded yet for ${what}. That is not evidence of a gap in competence.`;
  const thin = (xs: SourceRef[]) => xs.length < policy.sufficiency;
  const onlySelf = (xs: SourceRef[]) => xs.length > 0 && xs.every(x => x.provenance === "self_reported");

  const f1 = base("development_activity", of("development_activity"));
  {
    const xs = of("development_activity");
    const cpd = xs.filter(x => x.kind === "cpd"), courses = xs.filter(x => x.kind === "learning_record"), acts = xs.filter(x => x.kind === "activity" || x.kind === "milestone");
    const hours = (input.cpd ?? []).filter(c => cpd.some(x => x.id === c.id) && c.hours != null).reduce((t, c) => t + (c.hours ?? 0), 0);
    f1.state = xs.length === 0 ? "not_recorded" : thin(xs) ? "limited" : "supported";
    f1.summary = xs.length === 0 ? nothing("development activity") : [
      cpd.length ? `${plural(cpd.length, "CPD entry", "CPD entries")}${hours ? ` (${hours} hours recorded)` : ""}` : null,
      courses.length ? plural(courses.length, "Competen Learning course") : null,
      acts.length ? plural(acts.length, "plan activity or milestone", "plan activities or milestones") : null,
    ].filter(Boolean).join(", ") + (f1.first ? `, from ${f1.first} to ${f1.last}.` : ".");
    if (xs.length && onlySelf(xs)) f1.limitations.push("All of it is self-reported.");
  }
  const f2 = base("knowledge", of("knowledge"));
  {
    const xs = of("knowledge");
    const formative = xs.filter(x => x.provenance === "formative");
    f2.state = xs.length === 0 ? "not_recorded" : formative.length && !thin(xs) ? "supported" : "limited";
    f2.summary = xs.length === 0 ? `${nothing("knowledge and understanding")} Course completions alone record completion, not understanding.`
      : `${formative.length ? `${plural(formative.length, "formative assessment result")}` : "No formative assessment result"}${xs.length - formative.length ? `, and ${plural(xs.length - formative.length, "self-reported or linked record")}` : ""}.`;
    if (xs.length && !formative.length) f2.limitations.push("No formative assessment result is in scope: knowledge is self-reported or inferred from links you made.");
    if (formative.length) f2.limitations.push("Formative results show knowledge at the time of the assessment. They are not verification of clinical competence.");
  }
  const f3 = base("application", of("application"));
  {
    const xs = of("application");
    f3.state = xs.length === 0 ? "not_recorded" : onlySelf(xs) || thin(xs) ? "limited" : "supported";
    f3.summary = xs.length === 0 ? nothing("application of learning")
      : `${plural(xs.length, "record")} describe applying learning: ${uniq(xs.map(x => x.kind)).map(k => k.replace(/_/g, " ")).join(", ")}.`;
    if (onlySelf(xs)) f3.limitations.push("Application is described by you. It has not been observed or verified.");
    f3.limitations.push(OUTCOMES_NOTICE);
  }
  const f4 = base("competency_evidence", of("competency_evidence"));
  {
    const xs = of("competency_evidence");
    const selfA = xs.filter(x => x.kind === "self_assessment");
    if (!input.stage5.available && !(input.mappings ?? []).length) {
      f4.state = "not_available";
      f4.summary = "Competency records are not available here yet, so this evaluation uses your goals, learning and records instead.";
    } else {
      f4.state = xs.length === 0 ? "not_recorded" : thin(xs) || onlySelf(xs) ? "limited" : "supported";
      f4.summary = xs.length === 0 ? (s.competencies.size || s.entries.size ? nothing("these competencies") : "No competency is linked to this scope. That is fine: this evaluation uses your goals, learning and records instead.")
        : `${plural(xs.length - selfA.length, "linked record")}${selfA.length ? ` and ${plural(selfA.length, "self-assessment")} (self-reported)` : ""}.`;
    }
    if (selfA.length) f4.limitations.push("Self-assessments are your own judgement. They are kept as self-reported and never count as verification.");
  }
  const f5 = base("independent_verification", of("independent_verification"));
  {
    const xs = of("independent_verification");
    const current = xs.filter(x => x.provenance === "independent_decision");
    f5.state = current.length ? "supported" : !input.verification.available && !(input.passport ?? []).length ? "not_available" : xs.length ? "limited" : "not_recorded";
    f5.summary = current.length ? `${plural(current.length, "current independent decision")}: ${current.map(x => x.title).join("; ")}.`
      : xs.length ? "Independent decisions are recorded, but none is a current verification. A decision records what the evidence showed at that time, not a judgement of the person."
      : "No independent verification is recorded for this scope. Self-assessment, CPD and courses are not verification.";
    f5.verification = current.length ? "Independently verified" : xs.length ? "Not current" : "Not verified";
    if (!input.verification.available) f5.limitations.push("Competen verification (C5) is not available on this environment.");
    f5.limitations.push("Stage 6 only reads verification decisions. It never makes, changes or revokes one.");
  }
  const f6 = base("evidence_confidence", sources);
  {
    const factors = new Set(policy.confidenceFactors);
    const present: string[] = [], absent: string[] = [];
    const check = (k: (typeof policy.confidenceFactors)[number], ok: boolean, yes: string, no: string) => {
      if (!factors.has(k)) return false;
      (ok ? present : absent).push(ok ? yes : no);
      return ok;
    };
    const dated = sources.map(x => x.date).filter((v): v is string => !!v).sort();
    const latest = dated[dated.length - 1] ?? null;
    const recent = !!latest && daysBetween(latest, today) <= policy.recencyDays;
    const indep = check("independent", sources.some(x => x.provenance === "independent_decision"), "an independent decision", "no independent verification");
    const raisers = [
      check("document_supported", sources.some(x => x.provenance === "document_supported" || x.provenance === "platform_recorded"), "document-supported records", "no document-supported records"),
      check("formative", sources.some(x => x.provenance === "formative"), "a formative assessment result", "no formative assessment result"),
      check("recency", recent, `recent evidence (latest ${latest})`, latest ? `no evidence in the last ${policy.recencyDays} days (latest ${latest})` : "no dated evidence"),
      check("sufficiency", sources.length >= policy.sufficiency, `${plural(sources.length, "separate record")}`, `fewer than ${policy.sufficiency} separate records`),
    ].filter(Boolean).length;
    const level: ConfidenceLevel = sources.length === 0 || onlySelf(sources) ? "limited" : indep && raisers >= 2 ? "stronger" : raisers + (indep ? 1 : 0) >= 1 ? "moderate" : "limited";
    f6.confidence = level;
    f6.state = sources.length === 0 ? "not_recorded" : level === "limited" ? "limited" : "supported";
    f6.reasons = [...present.map(p => `Raised by ${p}.`), ...absent.map(a => `Not raised: ${a}.`)];
    if (onlySelf(sources)) f6.reasons.unshift("Every record in scope is self-reported, so confidence stays Limited whatever else is present.");
    if (!factors.size) f6.reasons.push("No confidence factors are switched on in the evaluation policy, so confidence stays Limited.");
    f6.summary = sources.length === 0 ? `Limited: nothing is recorded in this scope yet. ${MISSING_NOTICE}`
      : `${level === "stronger" ? "Stronger" : level === "moderate" ? "Moderate" : "Limited"} confidence in the evidence (not in you): ${plural(sources.length, "record")}${latest ? `, latest ${latest}` : ""}.`;
    if (!recent && latest) f6.limitations.push(`The most recent evidence is from ${latest}, older than the recency policy (${policy.recencyDays} days).`);
    f6.limitations.push(...unreadable);
  }
  const findings = { development_activity: f1, knowledge: f2, application: f3, competency_evidence: f4, independent_verification: f5, evidence_confidence: f6 } as Record<Dimension, Finding>;

  // ── STRENGTHS (demonstrated only: document-supported, formative or verified), AREAS (the person's own words) ──
  const strengths: Point[] = [];
  const docs = sources.filter(x => (x.provenance === "document_supported" || x.provenance === "platform_recorded") && x.dimensions.includes("development_activity"));
  if (docs.length) strengths.push({ text: `${plural(docs.length, "document-supported development record")}${docs[0]?.date ? `, most recent ${docs.map(x => x.date).filter(Boolean).sort().reverse()[0]}` : ""}.`, sourceKeys: docs.map(x => x.key) });
  for (const x of sources.filter(x => x.provenance === "formative")) strengths.push({ text: `Formative assessment completed: ${x.title}${x.method ? ` (${x.method})` : ""}.`, sourceKeys: [x.key] });
  for (const x of sources.filter(x => x.provenance === "independent_decision")) strengths.push({ text: `${x.classText}: ${x.title}${x.date ? `, ${x.date}` : ""}.`, sourceKeys: [x.key] });
  const development: Point[] = [];
  for (const n of (input.needs ?? []).filter(n => s.needs.has(n.id) && n.status === "open")) development.push({ text: `You named this as a development need: ${n.title}.`, sourceKeys: [] });
  for (const e of (input.stage5.entries ?? []).filter(e => s.entries.has(e.id) && e.interest && !e.removed_at)) development.push({ text: `You marked ${e.title} as a development interest.`, sourceKeys: [] });
  for (const a of (input.stage5.assessments ?? []).filter(a => s.entries.has(a.my_competency_id) && a.development_interest)) development.push({ text: `In your self-assessment of ${entryName(a.my_competency_id) ?? "a competency"} you asked to develop it further.`, sourceKeys: [`self_assessment:${a.id}`] });
  for (const g of (input.goals ?? []).filter(g => s.goals.has(g.id) && (g.status === "planned" || g.status === "in_progress"))) development.push({ text: `Your goal is still open: ${g.title}.`, sourceKeys: [] });

  const limitations = uniq([...Object.values(findings).flatMap(f => f.limitations), MISSING_NOTICE]);

  // ── COMPETENCIES AND OUTCOMES IN SCOPE (versions kept) ──
  const competencies: Evaluation["competencies"] = [];
  for (const e of (input.stage5.entries ?? []).filter(e => s.entries.has(e.id))) {
    competencies.push({ id: e.framework_competency_id, name: e.title, version: e.framework_version, personal: e.kind === "personal",
      outcomes: uniq([...links520.filter(l => l.my_competency_id === e.id).map(l => l.learning_outcome), ...(input.stage5.assessments ?? []).filter(a => a.my_competency_id === e.id).map(a => a.learning_outcome)].filter((v): v is string => !!v)) });
  }
  for (const cid of s.competencies) if (!competencies.some(c => c.id === cid)) {
    const name = nameOf(cid);
    if (name) competencies.push({ id: cid, name, version: input.versions.get(cid) ?? (input.planCompetencies ?? []).find(l => l.framework_competency_id === cid)?.framework_version ?? null, personal: false,
      outcomes: uniq([...(input.planCompetencies ?? []), ...(input.needCompetencies ?? [])].filter(l => l.framework_competency_id === cid && !l.unlinked_at).map(l => l.learning_outcome).filter((v): v is string => !!v)) });
  }
  const frameworkVersions = uniq([...competencies.map(c => c.version), ...sources.map(x => x.frameworkVersion)].filter((v): v is string => !!v));

  const recommendations = recommend(input, scope, label, s, findings, sources, policy);
  return {
    scope: { ...scope, label, from: from ?? null, to: to ?? null }, sources, findings, strengths, development, limitations, competencies, recommendations, frameworkVersions,
    notices: [FORMATIVE_NOTICE, MISSING_NOTICE],
  };
}

// ── RECOMMENDATIONS (deterministic, each with its basis) ──────────────────────────────────────────────────────

export const recommendationKey = (rule: RecommendationRule, scope: Scope, extra = "") =>
  `${rule}:${scope.kind}:${slug(scope.ref ?? "all")}${scope.outcome ? `.${slug(scope.outcome)}` : ""}${extra ? `.${slug(extra)}` : ""}`.slice(0, 160);

function recommend(input: EvaluationInput, scope: Scope, label: string, s: InScope, f: Record<Dimension, Finding>, sources: SourceRef[], policy: ProfessionalEvaluationPolicy): Recommendation[] {
  const on = new Set(policy.rules);
  const out: Recommendation[] = [];
  const add = (r: Omit<Recommendation, "key"> & { extra?: string }) => {
    if (!on.has(r.rule)) return;
    const { extra, ...rest } = r;
    out.push({ ...rest, key: recommendationKey(r.rule, scope, extra) });
  };
  const firstCompetency = [...s.competencies][0] ?? null;
  const goalId = scope.kind === "goal" ? scope.ref : null;
  const liveEntries = (input.stage5.entries ?? []).filter(e => s.entries.has(e.id) && !e.removed_at);

  if (f.development_activity.state === "not_recorded")
    add({ rule: "record_cpd", title: "Record CPD, or link CPD you already logged", dimension: "development_activity", sourceKeys: [], href: input.hrefs.cpd, hrefLabel: "Open Learning & CPD", creates: null,
      basis: `Offered because no development activity is linked to "${label}" yet.` });
  if (goalId && !(input.activityGoals ?? []).some(l => l.goal_id === goalId && ["planned", "active"].includes((input.activities ?? []).find(a => a.id === l.activity_id)?.status ?? "")))
    add({ rule: "plan_activity", title: `Plan a learning activity for "${label}"`, dimension: "development_activity", sourceKeys: [], href: input.hrefs.goal(goalId), hrefLabel: "Open the goal",
      creates: { kind: "activity", title: `Learning activity for: ${label}`.slice(0, 200), goalId },
      basis: "Offered because this goal has no planned or active activity. Accepting adds a planned activity to your plan, which you can edit." });
  if (input.learning.enabled && (firstCompetency || scope.kind === "topic"))
    add({ rule: "find_learning", title: "Find relevant Competen Learning", dimension: "knowledge", sourceKeys: [], href: input.hrefs.learning(firstCompetency), hrefLabel: "Browse Competen Learning", creates: null,
      basis: firstCompetency ? `Offered because "${label}" is linked to a competency that courses may cover. Adding a course is optional and never a purchase.` : "Offered so you can look for courses on this topic. Optional." });
  if (f.knowledge.state !== "supported" && input.learning.enabled)
    add({ rule: "formative_assessment", title: "Consider a formative assessment", dimension: "knowledge", sourceKeys: f.knowledge.sourceKeys, href: input.hrefs.learning(firstCompetency), hrefLabel: "Find an assessed course",
      creates: null, basis: "Offered because no formative assessment result is in scope. It would show knowledge at a point in time. It is optional, never an examination, and not verification." });
  if (f.application.state !== "supported" && f.development_activity.state !== "not_recorded")
    add({ rule: "reflect_application", title: "Reflect on how you applied this learning", dimension: "application", sourceKeys: f.development_activity.sourceKeys.slice(0, 5), href: input.hrefs.cpd, hrefLabel: "Reflect on a CPD entry or course",
      creates: null, basis: "Offered because you recorded development activity but little about applying it in practice." });
  if (input.stage5.available) {
    for (const e of liveEntries.filter(e => !(input.stage5.assessments ?? []).some(a => a.my_competency_id === e.id)).slice(0, 3))
      add({ rule: "self_assess", extra: e.id, title: `Self-assess ${e.title}`, dimension: "competency_evidence", sourceKeys: [], href: input.hrefs.competency(e.id), hrefLabel: "Open this competency", creates: null,
        basis: "Offered because this competency has no self-assessment yet. A self-assessment is your own judgement and stays self-reported." });
    for (const e of liveEntries.filter(e => !(input.stage5.links ?? []).some(l => l.my_competency_id === e.id && !l.unlinked_at)).slice(0, 3))
      add({ rule: "link_evidence", extra: e.id, title: `Link evidence to ${e.title}`, dimension: "competency_evidence", sourceKeys: [], href: input.hrefs.competency(e.id), hrefLabel: "Open this competency", creates: null,
        basis: "Offered because no evidence is linked to this competency yet." });
  }
  if (input.verification.available && input.hrefs.verification) {
    for (const e of liveEntries.filter(e => e.kind === "catalogue").slice(0, 3)) {
      const linked = (input.stage5.links ?? []).filter(l => l.my_competency_id === e.id && !l.unlinked_at && l.kind !== "reflection").length;
      const decided = (input.verification.decisions ?? []).some(d => d.verified && (d.myCompetencyId === e.id || d.frameworkCompetencyId === e.framework_competency_id));
      if (linked >= policy.sufficiency && !decided)
        add({ rule: "request_verification", extra: e.id, title: `Consider independent verification of ${e.title}`, dimension: "independent_verification", sourceKeys: [], href: input.hrefs.competency(e.id), hrefLabel: "Open this competency to request verification",
          creates: null, basis: `Offered because ${plural(linked, "evidence record")} ${linked === 1 ? "is" : "are"} linked and no current independent decision exists. Optional. Only a verifier can verify, through Competen verification.` });
    }
  }
  const dated = sources.map(x => x.date).filter((v): v is string => !!v).sort();
  const latest = dated[dated.length - 1];
  if (latest && daysBetween(latest, input.today) > policy.recencyDays)
    add({ rule: "refresh_evidence", title: "Add more recent evidence", dimension: "evidence_confidence", sourceKeys: [], href: input.hrefs.cpd, hrefLabel: "Open Learning & CPD", creates: null,
      basis: `Offered because the most recent evidence is from ${latest}, older than the recency policy.` });
  if (scope.kind !== "goal" && scope.kind !== "development" && s.goals.size === 0)
    add({ rule: "create_goal", title: `Set a development goal for "${label}"`, dimension: "development_activity", sourceKeys: [], href: input.hrefs.development, hrefLabel: "Open Needs & plan",
      creates: { kind: "goal", title: `Develop: ${label}`.slice(0, 200), needId: scope.kind === "area" ? scope.ref : null,
        competencyId: (scope.kind === "competency" || scope.kind === "outcome") ? firstCompetency : null },
      basis: "Offered because no goal is linked to this yet. Accepting adds a goal to your plan, which you can edit." });
  if ((scope.kind === "topic" || scope.kind === "competency" || scope.kind === "outcome") && s.needs.size === 0 && f.evidence_confidence.confidence === "limited")
    add({ rule: "create_need", title: `Record a development need for "${label}"`, dimension: "evidence_confidence", sourceKeys: [], href: input.hrefs.development, hrefLabel: "Open Needs & plan",
      creates: { kind: "need", title: `Build evidence of ${label}`.slice(0, 200) },
      basis: "Offered because little evidence is recorded for this, not because of any judgement about your competence. Accepting records a need in your own words, which you can edit." });
  if (goalId) {
    const g = (input.goals ?? []).find(x => x.id === goalId);
    const lastReview = (input.reviews ?? []).filter(r => r.goal_id === goalId).map(r => r.reviewed_at).sort().reverse()[0];
    if (g && (g.status === "planned" || g.status === "in_progress") && (!lastReview || daysBetween(lastReview, input.today) > 90))
      add({ rule: "review_goal", title: "Review this goal", dimension: "application", sourceKeys: [], href: input.hrefs.goal(goalId), hrefLabel: "Review the goal", creates: null,
        basis: lastReview ? `Offered because the goal was last reviewed on ${lastReview.slice(0, 10)}.` : "Offered because the goal has not been reviewed yet." });
  }
  return out;
}

// ── HISTORY: COMPARING TWO EVALUATIONS (E5) ───────────────────────────────────────────────────────────────────

export type StoredEvaluation = {
  id: string; scope_kind: ScopeKind; scope_ref: string | null; scope_label: string; evaluated_at: string;
  sources: SourceRef[]; findings: Record<Dimension, Finding>; recommendations: Recommendation[];
};
export type Comparison = {
  earlier: { id: string; at: string }; later: { id: string; at: string }; sameScope: boolean;
  dimensions: { dimension: Dimension; before: FindingState; after: FindingState; beforeCount: number; afterCount: number; changed: boolean }[];
  confidence: { before: ConfidenceLevel | null; after: ConfidenceLevel | null };
  added: SourceRef[]; removed: SourceRef[];
};

/** Pure: what changed between two snapshots. Never a score, never "better" or "worse": the states and the sources. */
export function compareEvaluations(a: StoredEvaluation, b: StoredEvaluation): Comparison {
  const [earlier, later] = a.evaluated_at <= b.evaluated_at ? [a, b] : [b, a];
  const keys = (e: StoredEvaluation) => new Set(e.sources.map(x => x.key));
  const ek = keys(earlier), lk = keys(later);
  return {
    earlier: { id: earlier.id, at: earlier.evaluated_at }, later: { id: later.id, at: later.evaluated_at },
    sameScope: earlier.scope_kind === later.scope_kind && earlier.scope_ref === later.scope_ref,
    dimensions: DIMENSIONS.map(([d]) => {
      const x = earlier.findings[d], y = later.findings[d];
      return { dimension: d, before: x?.state ?? "not_recorded", after: y?.state ?? "not_recorded", beforeCount: x?.sourceKeys.length ?? 0, afterCount: y?.sourceKeys.length ?? 0,
        changed: (x?.state !== y?.state) || (x?.sourceKeys.length ?? 0) !== (y?.sourceKeys.length ?? 0) };
    }),
    confidence: { before: earlier.findings.evidence_confidence?.confidence ?? null, after: later.findings.evidence_confidence?.confidence ?? null },
    added: later.sources.filter(x => !ek.has(x.key)), removed: earlier.sources.filter(x => !lk.has(x.key)),
  };
}

/** Pure: the scopes an evaluation may be run on, as offered (policy) and as present in the record. */
export const scopeTitle = (k: ScopeKind) => SCOPE_LABEL[k];
