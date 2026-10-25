import type { EvaluationInput } from "./evaluation";
import type { ProfileItem } from "./profile-records";
import type { ContextPeriod } from "./profile-store";
import type { EvaluationRow } from "./evaluation-store";
import type { CatalogueCompetency } from "@/lib/competency/foundation";
import type { ContextOption, ProfessionalProgressPolicy } from "../policy";
import type { PeriodKind, ProgressRule } from "./progress-policy";
import { CONFIDENCE_LABEL } from "./evaluation-vocabulary";
import { notMeasured, insufficient, type Measure } from "@/lib/competency/progress-model";

// ── MY PROFESSIONAL PROGRESS: THE INTERPRETATION ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR1-PR6 ────────────────────────────
//
// PURE, AND NOT ANOTHER ENGINE. It arranges what the owning modules returned (the same input Stage 6 reads, plus the
// profile, Stage 6's own snapshots and the CPD requirement summary) into the Overview, Development over time, Competency
// progress, Learning & CPD, the Career journey and explainable next steps. It writes nothing and stores nothing.
//
// ⚠ NO SCORE, NO AVERAGE. Expected, self-assessed, evidence, formative evaluation and independent decisions stay in their
// own columns. Volume (hours, entries) is never presented as demonstrated learning or competence, and no CPD requirement
// is ever called met or compliant: the requirement summary says "recorded".
//
// ⚠ HISTORY AS IT HAPPENED. Every event keeps when it OCCURRED and when it was RECORDED, its source and its framework
// version. A period view only groups events: it never moves a date, merges versions or smooths a gap. Where self-
// assessments or links for one competency span framework versions, the difference is stated, never compared across.
//
// ⚠ MISSING IS NOT INCOMPETENT. A competency with nothing recorded says "Nothing recorded yet", and next steps say what
// finding they come from. A newly registered professional gets useful first steps, not warnings.

export type Extra = {
  items: ProfileItem[] | null; context: ContextPeriod[] | null; evaluations: EvaluationRow[] | null;
  catalogue: CatalogueCompetency[] | null; requirement: { label: string; text: string } | null;
  decisions: { recommendation_key: string; decision: string; deferred_until: string | null; decided_at: string }[] | null;
};

const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── THE TIMELINE (PR2, PR6) ──────────────────────────────────────────────────────────────────────────────────────

export type EventKind = "need" | "goal" | "goal_done" | "goal_revised" | "cpd" | "learning" | "assessment" | "reflection" | "self_assessment"
  | "verification" | "milestone" | "profile" | "evaluation" | "context";
export type TimelineEvent = {
  key: string; kind: EventKind; title: string; occurredOn: string; recordedOn: string | null; category: string | null;
  source: string; version: string | null; repeat: boolean; href: string | null; note: string | null;
};

const MILESTONE_HINTS: [RegExp, string][] = [
  [/regist/, "registration"], [/qualif|degree|diploma|certif/, "qualification"], [/employ|role|job/, "new-role"], [/special/, "specialty"],
  [/lead|manag/, "leadership"], [/teach|mentor|educat/, "teaching"], [/research|publi/, "research"], [/quality/, "quality-improvement"],
  [/course|learning/, "course-completed"], [/verif|independent|decision/, "independent-decision"],
];
const categoryOf = (hint: string, cats: readonly ContextOption[]) => {
  const code = MILESTONE_HINTS.find(([re]) => re.test(hint))?.[1];
  return cats.find(c => c.code === code)?.label ?? null;
};

export function timeline(input: EvaluationInput, x: Extra, policy: ProfessionalProgressPolicy): TimelineEvent[] {
  const cats = policy.milestoneCategories;
  const out: TimelineEvent[] = [];
  const add = (e: Omit<TimelineEvent, "repeat">) => { if (e.occurredOn) out.push({ ...e, repeat: false }); };
  for (const n of input.needs ?? []) add({ key: `need:${n.id}`, kind: "need", title: `Development need: ${n.title}`, occurredOn: day(n.created_at)!, recordedOn: day(n.created_at), category: null, source: "Needs & plan", version: null, href: input.hrefs.need(n.id), note: n.status === "open" ? null : `now ${n.status}` });
  for (const g of input.goals ?? []) {
    add({ key: `goal:${g.id}`, kind: "goal", title: `Goal set: ${g.title}`, occurredOn: day(g.created_at)!, recordedOn: day(g.created_at), category: null, source: "Needs & plan", version: null, href: input.hrefs.goal(g.id), note: null });
    if (g.completed_at) add({ key: `goal_done:${g.id}`, kind: "goal_done", title: `Goal addressed (your judgement): ${g.title}`, occurredOn: day(g.completed_at)!, recordedOn: day(g.completed_at), category: null, source: "Needs & plan", version: null, href: input.hrefs.goal(g.id), note: null });
  }
  for (const r of input.reviews ?? []) add({ key: `review:${r.id}`, kind: "goal_revised", title: "Goal reviewed", occurredOn: day(r.reviewed_at)!, recordedOn: day(r.reviewed_at), category: null, source: "Needs & plan", version: null, href: input.hrefs.goal(r.goal_id), note: r.decision });
  for (const c of input.cpd ?? []) add({ key: `cpd:${c.id}`, kind: "cpd", title: c.title, occurredOn: c.activity_date, recordedOn: day(c.created_at), category: categoryOf(c.activity_type, cats), source: "CPD log", version: null, href: input.hrefs.cpd, note: c.hours != null ? `${c.hours} h` : null });
  for (const r of input.learning.refs ?? []) add({ key: `learning:${r.recordId}`, kind: r.completionKind === "assessed_knowledge" ? "assessment" : "learning", title: r.title, occurredOn: r.completedOn, recordedOn: r.completedOn,
    category: categoryOf("course", cats), source: "Competen Learning", version: `version ${r.versionNo}`, href: input.hrefs.learningRecord(r.recordId), note: r.outcomeLabel });
  for (const [, list] of input.learningReflections?.bySubject ?? []) for (const lr of list) add({ key: `reflection:${lr.reflectionId}`, kind: "reflection", title: "Reflection on learning (private, title only)", occurredOn: day(lr.createdAt)!, recordedOn: day(lr.createdAt), category: null, source: "Learning & CPD", version: null, href: input.hrefs.cpd, note: lr.impact });
  for (const a of input.stage5.assessments ?? []) {
    const e = (input.stage5.entries ?? []).find(x => x.id === a.my_competency_id);
    add({ key: `sa:${a.id}`, kind: "self_assessment", title: `Self-assessment: ${e?.title ?? "a competency"} at ${a.level_label} (self-reported)`, occurredOn: day(a.assessed_at)!, recordedOn: day(a.assessed_at), category: null, source: "My Competencies", version: a.framework_version, href: input.hrefs.competency(a.my_competency_id), note: null });
  }
  for (const d of input.verification.decisions ?? []) if (d.decidedOn) add({ key: `verification:${d.id}`, kind: "verification", title: `${d.title}: ${d.outcomeLabel} (one assessment${d.assessor ? `, ${d.assessor}` : ""})`, occurredOn: d.decidedOn, recordedOn: d.decidedOn,
    category: d.verified ? categoryOf("independent decision", cats) : null, source: "Competen verification", version: d.frameworkVersion, href: d.href, note: d.verified ? null : d.state });
  for (const m of input.milestones ?? []) if (m.achieved_on) add({ key: `milestone:${m.id}`, kind: "milestone", title: `Milestone: ${m.title}`, occurredOn: m.achieved_on, recordedOn: m.achieved_on, category: categoryOf(m.milestone_type_label ?? m.title, cats), source: "Needs & plan", version: null, href: input.hrefs.goal(m.goal_id), note: null });
  for (const i of x.items ?? []) if (!i.withdrawn_at && i.section !== "interest") add({ key: `profile:${i.id}`, kind: "profile", title: `${i.section === "aspiration" ? "Aspiration" : i.type_label ?? i.section}: ${i.title}${i.organisation ? `, ${i.organisation}` : ""}`,
    occurredOn: day(i.started_on ?? i.target_on ?? i.created_at)!, recordedOn: day(i.created_at), category: categoryOf(i.section, cats), source: "Professional profile", version: null, href: null, note: i.superseded_at ? "an earlier version, kept" : null });
  for (const v of x.evaluations ?? []) add({ key: `evaluation:${v.id}`, kind: "evaluation", title: `Evaluation recorded: ${v.scope_label}`, occurredOn: day(v.evaluated_at)!, recordedOn: day(v.evaluated_at), category: null, source: "My Professional Evaluation", version: v.framework_versions?.join(", ") || null, href: null,
    note: v.findings?.evidence_confidence?.confidence ? `${CONFIDENCE_LABEL[v.findings.evidence_confidence.confidence]} evidence confidence` : null });
  const sorted = out.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.key.localeCompare(b.key));
  // New learning vs repeated practice: the same title again is marked repeated, never merged.
  const seen = new Set<string>();
  for (const e of sorted) {
    if (e.kind !== "cpd" && e.kind !== "learning" && e.kind !== "assessment") continue;
    const k = norm(e.title);
    if (seen.has(k)) e.repeat = true; else seen.add(k);
  }
  return sorted.reverse();
}

// ── PERIODS (PR2) ─────────────────────────────────────────────────────────────────────────────────────────────

export type Bucket = { key: string; label: string; from: string; to: string | null; events: TimelineEvent[] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isoWeek = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`); const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow + 3);
  // ISO 8601: the week of the year that holds this date's Thursday, counted from the week holding 4 January.
  const y = t.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { y, w: Math.max(1, w) };
};

/** Groups events by period. Professional phases are the person's own profile context periods (their history kept). */
export function buckets(events: readonly TimelineEvent[], kind: PeriodKind, phases: readonly ContextPeriod[] | null): Bucket[] {
  const map = new Map<string, Bucket>();
  const put = (key: string, label: string, from: string, to: string | null, e: TimelineEvent) => {
    const b = map.get(key) ?? { key, label, from, to, events: [] }; b.events.push(e); map.set(key, b);
  };
  for (const e of events) {
    const d = e.occurredOn, y = d.slice(0, 4), m = Number(d.slice(5, 7));
    if (kind === "year") put(y, y, `${y}-01-01`, `${y}-12-31`, e);
    else if (kind === "quarter") { const q = Math.ceil(m / 3); put(`${y}-Q${q}`, `Q${q} ${y}`, `${y}-${String(q * 3 - 2).padStart(2, "0")}-01`, null, e); }
    else if (kind === "month") put(d.slice(0, 7), `${MONTHS[m - 1]} ${y}`, `${d.slice(0, 7)}-01`, null, e);
    else if (kind === "week") { const { y: wy, w } = isoWeek(d); put(`${wy}-W${String(w).padStart(2, "0")}`, `Week ${w}, ${wy}`, d, null, e); }
    else {
      const p = (phases ?? []).find(ph => ph.effective_from.slice(0, 10) <= d && (!ph.effective_to || d <= ph.effective_to.slice(0, 10)));
      const label = p ? [p.self_declared_professional_title ?? p.self_declared_profession, p.self_declared_current_role, p.self_declared_primary_specialty, p.self_declared_practice_jurisdiction].filter(Boolean).join(", ") || "A recorded phase" : "Before your recorded profile";
      put(p ? `phase:${p.effective_from}` : "phase:before", label, p ? p.effective_from.slice(0, 10) : "0000-01-01", p?.effective_to?.slice(0, 10) ?? null, e);
    }
  }
  return [...map.values()].sort((a, b) => b.from.localeCompare(a.from));
}

// ── COMPETENCY PROGRESS (PR3) ─────────────────────────────────────────────────────────────────────────────────

export type CompetencyRow = {
  id: string; name: string; entryId: string | null; personal: boolean;
  expected: string | null; selfAssessed: string | null; evidence: number; formative: string | null; independent: string | null;
  confidence: string; limitations: string[]; outcomes: string[]; versions: string[];
};
export type TreeNode = { domain: string; cpu: string; rows: CompetencyRow[] };

export function competencyProgress(input: EvaluationInput, x: Extra): { tree: TreeNode[]; personal: CompetencyRow[]; byGoal: { goal: string; competencies: string[] }[] } {
  const entries = (input.stage5.entries ?? []).filter(e => !e.removed_at);
  const ids = new Set<string>([...entries.map(e => e.framework_competency_id).filter((v): v is string => !!v),
    ...(input.planCompetencies ?? []).filter(l => !l.unlinked_at).map(l => l.framework_competency_id),
    ...(input.needCompetencies ?? []).filter(l => !l.unlinked_at).map(l => l.framework_competency_id),
    ...(input.mappings ?? []).filter(m => m.state === "accepted").map(m => m.competencyId)]);
  const latestEval = (cid: string | null, entryId: string | null) => (x.evaluations ?? []).find(v => (v.scope_kind === "competency" || v.scope_kind === "outcome") && (v.scope_ref === entryId || v.scope_ref === cid));
  const row = (cid: string | null, entry: (typeof entries)[number] | undefined): CompetencyRow => {
    const cat = cid ? (x.catalogue ?? []).find(c => c.competencyId === cid) : undefined;
    const sas = (input.stage5.assessments ?? []).filter(a => entry && a.my_competency_id === entry.id).sort((a, b) => b.assessed_at.localeCompare(a.assessed_at));
    const links = (input.stage5.links ?? []).filter(l => entry && l.my_competency_id === entry.id && !l.unlinked_at && l.kind !== "reflection");
    const mapped = (input.mappings ?? []).filter(m => m.state === "accepted" && m.competencyId === cid).length;
    const decisions = (input.verification.decisions ?? []).filter(d => (cid && d.frameworkCompetencyId === cid) || (entry && d.myCompetencyId === entry.id));
    const verified = decisions.find(d => d.verified);
    const ev = latestEval(cid, entry?.id ?? null);
    const versions = [...new Set([...sas.map(a => a.framework_version), ...links.map(l => l.framework_version)].filter((v): v is string => !!v))];
    const n = links.length + mapped;
    const limitations: string[] = [];
    if (versions.length > 1) limitations.push(`Recorded under framework versions ${versions.join(" and ")}: not directly comparable.`);
    if (!n && !sas.length && !verified) limitations.push("Nothing recorded yet. That is not evidence of a gap in competence.");
    if (sas.length && !verified) limitations.push("Self-assessed only: your own judgement, not verification.");
    return {
      id: cid ?? entry!.id, name: entry?.title ?? cat?.title ?? input.names.get(cid ?? "") ?? "A competency", entryId: entry?.id ?? null, personal: entry?.kind === "personal",
      expected: cat?.expectedLevel?.label ?? null, selfAssessed: sas[0] ? `${sas[0].level_label} (self-reported, ${sas[0].assessed_at.slice(0, 10)})` : null,
      evidence: n, formative: ev ? `${ev.findings?.evidence_confidence?.confidence ? CONFIDENCE_LABEL[ev.findings.evidence_confidence.confidence] : "Recorded"} (evaluation ${ev.evaluated_at.slice(0, 10)})` : null,
      independent: verified ? `${verified.outcomeLabel}, ${verified.assessor ?? "an appointed assessor"}, ${verified.decidedOn}` : decisions.length ? "A decision is recorded, not a current verification" : null,
      confidence: verified ? "Independent decision present" : n >= 2 ? "Evidence recorded" : n === 1 || sas.length ? "Limited evidence" : "Nothing recorded yet",
      limitations, outcomes: [...new Set([...sas.map(a => a.learning_outcome), ...links.map(l => l.learning_outcome)].filter((v): v is string => !!v))], versions,
    };
  };
  const tree = new Map<string, TreeNode>();
  for (const cid of ids) {
    const cat = (x.catalogue ?? []).find(c => c.competencyId === cid);
    const domain = cat?.domain.name ?? "Competencies not in an offered catalogue", cpu = cat?.cpu?.name ?? cat?.practice?.name ?? "Not placed in a clinical practice unit";
    const k = `${domain}|${cpu}`;
    const node = tree.get(k) ?? { domain, cpu, rows: [] };
    node.rows.push(row(cid, entries.find(e => e.framework_competency_id === cid)));
    tree.set(k, node);
  }
  const personal = entries.filter(e => e.kind === "personal").map(e => row(null, e));
  const byGoal = (input.goals ?? []).filter(g => g.status !== "dropped").map(g => ({ goal: g.title,
    competencies: (input.planCompetencies ?? []).filter(l => l.goal_id === g.id && !l.unlinked_at).map(l => input.names.get(l.framework_competency_id) ?? "A competency") })).filter(g => g.competencies.length);
  return { tree: [...tree.values()].sort((a, b) => a.domain.localeCompare(b.domain) || a.cpu.localeCompare(b.cpu)), personal, byGoal };
}

// ── LEARNING & CPD (PR4) ─────────────────────────────────────────────────────────────────────────────────────

export type LearningProgress = {
  participation: Measure<{ entries: number; courses: number; since: string }>;
  completions: number; assessments: number; hours: number | null; points: number | null; reflections: number; applied: number;
  linkedToGoals: number; interests: { title: string; since: string }[]; requirement: { label: string; text: string } | null;
};
export function learningProgress(input: EvaluationInput, x: Extra): LearningProgress {
  const cpd = input.cpd ?? [], refs = input.learning.refs ?? [];
  const dates = [...cpd.map(c => c.activity_date), ...refs.map(r => r.completedOn)].sort();
  const hours = cpd.some(c => c.hours != null) ? cpd.reduce((t, c) => t + (c.hours ?? 0), 0) + refs.reduce((t, r) => t + (r.hours ?? 0), 0) : refs.some(r => r.hours != null) ? refs.reduce((t, r) => t + (r.hours ?? 0), 0) : null;
  const points = cpd.some(c => c.cpd_points != null) ? cpd.reduce((t, c) => t + (c.cpd_points ?? 0), 0) : null;
  const allReflections = [...(input.learningReflections?.bySubject.values() ?? [])].flat();
  const activityRecords = new Set((input.activities ?? []).flatMap(a => [a.cpd_id, a.learning_record_id]).filter(Boolean));
  const total = cpd.length + refs.length;
  return {
    participation: total === 0 ? notMeasured("No learning or CPD is recorded yet.") : total < 2 ? insufficient(total, 2, "One record so far.") : { state: "measured", entries: cpd.length, courses: refs.length, since: dates[0] },
    completions: refs.length, assessments: refs.filter(r => r.completionKind === "assessed_knowledge").length, hours, points,
    reflections: allReflections.length, applied: allReflections.filter(r => r.impact === "applied").length,
    linkedToGoals: [...cpd.map(c => c.id), ...refs.map(r => r.recordId)].filter(id => activityRecords.has(id) || cpd.some(c => c.id === id && c.goal_id)).length,
    interests: (input.stage5.entries ?? []).filter(e => e.interest && !e.removed_at).map(e => ({ title: e.title, since: "" }))
      .concat((input.needs ?? []).filter(n => n.status === "open").map(n => ({ title: n.title, since: day(n.created_at) ?? "" }))).slice(0, 12),
    requirement: x.requirement,
  };
}

// ── CAREER & PROFESSIONAL JOURNEY (PR6) ─────────────────────────────────────────────────────────────────────────

export type JourneyGroup = { category: string; items: { title: string; detail: string | null; from: string | null; to: string | null; kept: boolean }[] };
export function careerJourney(input: EvaluationInput, x: Extra, policy: ProfessionalProgressPolicy): { groups: JourneyGroup[]; transitions: { on: string; change: string }[] } {
  const cats = policy.careerCategories;
  const label = (code: string) => cats.find(c => c.code === code)?.label ?? null;
  const SECTION: Record<string, string> = { qualification: "qualifications", registration: "registration", employment: "employment-and-practice", specialty: "specialty-development", aspiration: "future-aspirations" };
  const groups = new Map<string, JourneyGroup>();
  const put = (code: string, it: JourneyGroup["items"][number]) => {
    const category = label(code) ?? cats[0]?.label ?? "Journey";
    const g = groups.get(category) ?? { category, items: [] }; g.items.push(it); groups.set(category, g);
  };
  for (const i of x.items ?? []) if (!i.withdrawn_at && SECTION[i.section]) put(SECTION[i.section], { title: i.title, detail: [i.type_label, i.organisation, i.jurisdiction].filter(Boolean).join(", ") || null, from: i.started_on ?? i.target_on, to: i.ended_on, kept: !!i.superseded_at });
  for (const c of (input.cpd ?? []).filter(c => /teach|mentor|leader/.test(c.activity_type))) put("leadership-and-teaching", { title: c.title, detail: c.provider, from: c.activity_date, to: null, kept: false });
  for (const c of (input.cpd ?? []).filter(c => /research|quality/.test(c.activity_type))) put("research-and-quality-improvement", { title: c.title, detail: c.provider, from: c.activity_date, to: null, kept: false });
  // Transitions: changes between the person's own recorded context periods. Each period is kept, never rewritten.
  const periods = [...(x.context ?? [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const transitions: { on: string; change: string }[] = [];
  const FIELDS: [keyof ContextPeriod, string][] = [["self_declared_profession", "profession"], ["self_declared_current_role", "role"], ["self_declared_primary_specialty", "specialty"],
    ["self_declared_practice_setting", "practice setting"], ["self_declared_practice_jurisdiction", "jurisdiction"]];
  for (let n = 1; n < periods.length; n++) for (const [k, word] of FIELDS) {
    const a = periods[n - 1][k], b = periods[n][k];
    if (a !== b && (a || b)) transitions.push({ on: periods[n].effective_from.slice(0, 10), change: `${word}: ${a ?? "not recorded"} to ${b ?? "not recorded"}` });
  }
  for (const t of transitions) put("career-transitions", { title: t.change, detail: null, from: t.on, to: null, kept: false });
  for (const g of groups.values()) g.items.sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""));
  const order = cats.map(c => c.label);
  return { groups: [...groups.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)), transitions: transitions.reverse() };
}

// ── NEXT STEPS (PR5) ─────────────────────────────────────────────────────────────────────────────────────────

export type NextStep = { key: string; rule: ProgressRule; title: string; finding: string; href: string; hrefLabel: string };
export const stepKey = (rule: ProgressRule, ref: string) => `${rule}:${ref}`.toLowerCase().replace(/[^a-z0-9:_.-]+/g, "-").slice(0, 160);

export function nextSteps(input: EvaluationInput, x: Extra, policy: ProfessionalProgressPolicy, hrefs: { profile: string; competencies: string; learning: string }, reviewDays: number): NextStep[] {
  const on = new Set(policy.rules);
  const today = input.today;
  const out: NextStep[] = [];
  const add = (s: Omit<NextStep, "key"> & { ref: string }) => { if (on.has(s.rule)) out.push({ key: stepKey(s.rule, s.ref), rule: s.rule, title: s.title, finding: s.finding, href: s.href, hrefLabel: s.hrefLabel }); };
  const goals = (input.goals ?? []).filter(g => g.status === "planned" || g.status === "in_progress");
  const cpd = input.cpd ?? [], refs = input.learning.refs ?? [];
  if (!goals.length && !cpd.length && !refs.length) {
    add({ rule: "first_steps", ref: "profile", title: "Complete your professional profile", finding: "Your profile is the base for documents and history.", href: hrefs.profile, hrefLabel: "Open Professional profile" });
    add({ rule: "first_steps", ref: "cpd", title: "Record your first learning or CPD", finding: "Nothing is recorded yet. Any learning counts, from anywhere.", href: input.hrefs.cpd, hrefLabel: "Open Learning & CPD" });
    add({ rule: "first_steps", ref: "goal", title: "Set a first development goal", finding: "A goal can be just a sentence.", href: input.hrefs.development, hrefLabel: "Open Needs & plan" });
  }
  for (const g of goals) {
    const lastReview = (input.reviews ?? []).filter(r => r.goal_id === g.id).map(r => r.reviewed_at.slice(0, 10)).sort().reverse()[0] ?? g.created_at.slice(0, 10);
    const linked = (input.activities ?? []).filter(a => (input.activityGoals ?? []).some(l => l.goal_id === g.id && l.activity_id === a.id));
    const after = [...cpd.filter(c => c.goal_id === g.id || linked.some(a => a.cpd_id === c.id)).map(c => c.activity_date), ...refs.filter(r => linked.some(a => a.learning_record_id === r.recordId)).map(r => r.completedOn)].filter(d => d > lastReview);
    if (after.length) add({ rule: "review_goal_after_learning", ref: g.id, title: `Review "${g.title}"`, finding: `${plural(after.length, "learning record")} linked to it since you last reviewed it.`, href: input.hrefs.goal(g.id), hrefLabel: "Review the goal" });
    else if (daysBetween(lastReview, today) > reviewDays) add({ rule: "review_stale_goal", ref: g.id, title: `Review "${g.title}"`, finding: `Not reviewed since ${lastReview}.`, href: input.hrefs.goal(g.id), hrefLabel: "Review the goal" });
  }
  const reflected = new Set([...(input.learningReflections?.bySubject.keys() ?? [])]);
  const recent = (d: string) => daysBetween(d, today) <= policy.recentDays;
  for (const r of refs.filter(r => recent(r.completedOn) && !reflected.has(`rec:${r.recordId}`)).slice(0, 2)) add({ rule: "reflect_on_training", ref: r.recordId, title: `Reflect on "${r.title}"`, finding: `Completed ${r.completedOn}, with no reflection yet.`, href: input.hrefs.cpd, hrefLabel: "Reflect in Learning & CPD" });
  for (const c of cpd.filter(c => recent(c.activity_date) && !reflected.has(`cpd:${c.id}`) && !c.reflection).slice(0, 2)) add({ rule: "reflect_on_training", ref: c.id, title: `Reflect on "${c.title}"`, finding: `Recorded ${c.activity_date}, with no reflection yet.`, href: input.hrefs.cpd, hrefLabel: "Reflect in Learning & CPD" });
  for (const e of (input.stage5.entries ?? []).filter(e => !e.removed_at && !(input.stage5.links ?? []).some(l => l.my_competency_id === e.id && !l.unlinked_at)).slice(0, 2))
    add({ rule: "organise_evidence", ref: e.id, title: `Link evidence to ${e.title}`, finding: "No evidence is linked to this competency yet.", href: input.hrefs.competency(e.id), hrefLabel: "Open the competency" });
  for (const e of (input.stage5.entries ?? []).filter(e => e.kind === "catalogue" && !e.removed_at)) {
    const ls = (input.stage5.links ?? []).filter(l => l.my_competency_id === e.id && !l.unlinked_at);
    if (ls.some(l => /knowledge|develops|introduces/.test(l.relation_code)) && !ls.some(l => /application|practical|experience|practi/.test(l.relation_code)))
      add({ rule: "consider_practical_assessment", ref: e.id, title: `Consider practical evidence or assessment for ${e.title}`, finding: "Your evidence for it is about knowledge; none shows application yet. Optional: only an appointed assessor verifies.", href: input.hrefs.competency(e.id), hrefLabel: "Open the competency" });
  }
  for (const i of (x.items ?? []).filter(i => !i.withdrawn_at && !i.superseded_at && i.expires_on && daysBetween(today, i.expires_on) <= policy.recentDays))
    add({ rule: "credential_expiry", ref: i.id, title: `${i.title} ${i.expires_on! < today ? "has expired" : "expires soon"}`, finding: `Expiry date recorded: ${i.expires_on}.`, href: hrefs.profile, hrefLabel: "Open Professional profile" });
  for (const a of (x.items ?? []).filter(i => i.section === "aspiration" && !i.withdrawn_at && !i.superseded_at).slice(0, 2))
    add({ rule: "explore_aspiration_learning", ref: a.id, title: `Explore learning for "${a.title}"`, finding: "A career aspiration you recorded.", href: hrefs.learning, hrefLabel: "Browse Competen Learning" });
  // The person's decisions: dismissed is hidden, deferred is hidden until its date, accepted stays visible as accepted.
  const latest = new Map<string, NonNullable<Extra["decisions"]>[number]>();
  for (const d of [...(x.decisions ?? [])].sort((a, b) => b.decided_at.localeCompare(a.decided_at))) if (!latest.has(d.recommendation_key)) latest.set(d.recommendation_key, d);
  return out.filter(s => { const d = latest.get(s.key); return !d || (d.decision === "deferred" && !!d.deferred_until && d.deferred_until <= today) || d.decision === "accepted"; });
}

// ── OVERVIEW (PR1) ───────────────────────────────────────────────────────────────────────────────────────────

export function overview(input: EvaluationInput, events: readonly TimelineEvent[], policy: ProfessionalProgressPolicy) {
  const today = input.today;
  const goals = (input.goals ?? []).filter(g => g.status === "planned" || g.status === "in_progress");
  return {
    newProfessional: !goals.length && !(input.cpd ?? []).length && !(input.learning.refs ?? []).length,
    activeGoals: goals.slice(0, 6),
    achievements: events.filter(e => (e.kind === "cpd" || e.kind === "learning" || e.kind === "assessment" || e.kind === "verification") && daysBetween(e.occurredOn, today) <= policy.recentDays).slice(0, 8),
    milestones: events.filter(e => e.category && daysBetween(e.occurredOn, today) <= policy.recentDays * 2).slice(0, 6),
    competenciesWithEvidence: (input.stage5.entries ?? []).filter(e => !e.removed_at && (input.stage5.links ?? []).some(l => l.my_competency_id === e.id && !l.unlinked_at)).length,
  };
}
