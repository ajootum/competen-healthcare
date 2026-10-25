import type { ContextOption, ProfessionalPlanPolicy } from "../policy";
import { isoDate, isUuid, type Parsed } from "./validate";
import {
  REVIEW_COLUMN, REVIEW_FIELDS, REVIEW_STATUS, isActivityStatus, isGoalSource, isGoalStatus, type ActivityStatus, type GoalSource, type GoalStatus, type ReviewDecision,
} from "./plan-vocabulary";

// ── THE DEVELOPMENT PLAN FORMS, PURE ── COMPETEN-PROFESSIONAL-PLAN-01 P1 to P6 ───────────────────────────────────
//
// The only required field of a goal is its description: "What do you want to achieve?". Every other field is optional,
// read only when the configuration asks for it, and may be left for later. A chosen option's label is COPIED (as in
// 450 and 470), so renaming an option never rewrites an existing goal. The schema (373 and 480) remains the rule.
//
// ⚠ COMPLETED IS NEVER TYPED IN. An activity becomes completed only when it references the record of what happened
// (a CPD entry or a learning record: the Stage 3/4 contract). No form here accepts hours, credits, evidence classes,
// a verified flag or a user id.

export type GoalColumns = {
  title: string; detail: string | null; goal_type_code: string | null; goal_type_label: string | null;
  motivation: string | null; intended_outcome: string | null; priority_code: string | null; priority_label: string | null;
  expected_evidence: string | null; start_date: string | null; target_date: string | null; review_date: string | null;
  template_code: string | null; template_label: string | null; template_answers: Record<string, string> | null;
};
export type GoalSourceRefs = {
  createdFrom: GoalSource; needId: string | null; competencyId: string | null; offeringId: string | null; aspirationItemId: string | null; reflectionId: string | null;
};

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return !t ? null : t.length > max ? undefined : t;
};
const pick = (opts: readonly ContextOption[], v: unknown): [string | null, string | null] | undefined => {
  if (v === undefined || v === null || v === "") return [null, null];
  const hit = typeof v === "string" ? opts.find(o => o.code === v) : undefined;
  return hit ? [hit.code, hit.label] : undefined;
};
const optId = (v: unknown): string | null | undefined => (v === undefined || v === null || v === "" ? null : isUuid(v) ? v : undefined);

/** Pure: a template's name and prompts, from its label "Name: first | second | ...". A label without prompts has none. */
export function templatePrompts(label: string): { name: string; prompts: string[] } {
  const at = label.indexOf(":");
  if (at < 1) return { name: label.trim(), prompts: [] };
  const prompts = label.slice(at + 1).split("|").map(p => p.trim()).filter(Boolean).slice(0, 8);
  return { name: label.slice(0, at).trim(), prompts };
}

/** Pure: a goal as submitted. On an edit, fields the form did not send are not touched (partial). */
export function parseGoalForm(b: Record<string, unknown>, policy: ProfessionalPlanPolicy, partial = false): Parsed<Partial<GoalColumns>> {
  const out: Partial<GoalColumns> = {};
  if (!partial || b.title !== undefined) {
    const t = text(b.title, 200);
    if (!t || t.length < 3) return { ok: false, error: "Say what you want to achieve, in 3 to 200 characters." };
    out.title = t;
  }
  const texts: [keyof GoalColumns, string, number, string][] = [
    ["detail", "detail", 2000, "Keep the notes under 2,000 characters."],
    ["motivation", "motivation", 1000, "Keep why it matters under 1,000 characters."],
    ["intended_outcome", "outcome", 2000, "Keep the intended outcome under 2,000 characters."],
    ["expected_evidence", "expectedEvidence", 2000, "Keep the expected evidence under 2,000 characters."],
  ];
  for (const [col, key, max, err] of texts) {
    if (partial && b[key] === undefined) continue;
    const v = text(b[key], max);
    if (v === undefined) return { ok: false, error: err };
    (out as Record<string, unknown>)[col] = v;
  }
  const choices: [string, readonly ContextOption[], "goal_type" | "priority", string][] = [
    ["type", policy.goalTypes, "goal_type", "Choose a type of goal from the list."],
    ["priority", policy.priorities, "priority", "Choose a priority from the list."],
  ];
  for (const [key, opts, col, err] of choices) {
    if (partial && b[key] === undefined) continue;
    const r = pick(opts, b[key]);
    if (!r) return { ok: false, error: err };
    (out as Record<string, unknown>)[`${col}_code`] = r[0];
    (out as Record<string, unknown>)[`${col}_label`] = r[1];
  }
  for (const [col, key, name] of [["start_date", "startDate", "start"], ["target_date", "targetDate", "target"], ["review_date", "reviewDate", "review"]] as const) {
    if (partial && b[key] === undefined) continue;
    const d = isoDate(b[key]);
    if (d === undefined) return { ok: false, error: `The ${name} date is not a real date.` };
    out[col] = d;
  }
  if (out.start_date && out.target_date && out.target_date < out.start_date) return { ok: false, error: "The target date cannot be before the start date." };
  if (!partial || b.template !== undefined) {
    const r = pick(policy.templates, b.template);
    if (!r) return { ok: false, error: "Choose a planning template from the list." };
    out.template_code = r[0]; out.template_label = r[0] ? templatePrompts(r[1]!).name : null;
    out.template_answers = null;
    if (r[0]) {
      const answers: Record<string, string> = {};
      templatePrompts(r[1]!).prompts.forEach((p, i) => {
        const a = text(b[`answer${i}`], 600);
        if (a) answers[p] = a;
      });
      if (JSON.stringify(answers).length > 6000) return { ok: false, error: "Keep the template answers shorter." };
      out.template_answers = Object.keys(answers).length ? answers : null;
    }
  }
  return { ok: true, value: out };
}

/** Pure: where a new goal came from, and the id it names. Anything not the person's own is refused later by 480's keys. */
export function parseGoalSource(b: Record<string, unknown>): Parsed<GoalSourceRefs> {
  const ids = { needId: optId(b.needId), competencyId: optId(b.competencyId), offeringId: optId(b.offeringId), aspirationItemId: optId(b.aspirationItemId), reflectionId: optId(b.reflectionId) };
  if (Object.values(ids).some(v => v === undefined)) return { ok: false, error: "That reference is not valid." };
  const given = b.createdFrom === undefined || b.createdFrom === "" ? null : b.createdFrom;
  if (given !== null && !isGoalSource(given)) return { ok: false, error: "Choose where the goal came from from the list." };
  const createdFrom: GoalSource = given ?? (ids.reflectionId ? "reflection" : ids.aspirationItemId ? "aspiration" : ids.needId ? "need"
    : ids.competencyId ? "competency" : ids.offeringId ? "learning" : "direct");
  if (createdFrom === "reflection" && !ids.reflectionId) return { ok: false, error: "Choose the reflection the goal came from." };
  if (createdFrom === "aspiration" && !ids.aspirationItemId) return { ok: false, error: "Choose the aspiration the goal came from." };
  return {
    ok: true,
    value: {
      createdFrom, needId: ids.needId ?? null, competencyId: ids.competencyId ?? null, offeringId: ids.offeringId ?? null,
      aspirationItemId: createdFrom === "aspiration" ? ids.aspirationItemId ?? null : null, reflectionId: createdFrom === "reflection" ? ids.reflectionId ?? null : null,
    },
  };
}

/** Pure: a goal status change. Any offered status may follow any other, except reopening when the policy forbids it. */
export function checkGoalStatusChange(from: string, to: unknown, policy: Pick<ProfessionalPlanPolicy, "goalStatuses" | "reopen">): Parsed<GoalStatus> {
  if (!isGoalStatus(to) || !policy.goalStatuses.includes(to)) return { ok: false, error: "Choose a status from the list." };
  const closed = (s: string) => s === "done" || s === "dropped";
  if (policy.reopen === "off" && closed(from) && !closed(to)) return { ok: false, error: "An addressed or retired goal cannot be reopened. Add a new goal instead." };
  return { ok: true, value: to };
}

export type ActivityColumns = {
  title: string; detail: string | null; activity_type_code: string | null; activity_type_label: string | null; status: ActivityStatus;
  planned_start: string | null; planned_end: string | null; provider: string | null; external_url: string | null;
  learning_offering_id: string | null; depends_on_activity_id: string | null;
};

/** Pure: an activity as submitted. Completed is not offered here: it follows the record of what happened. */
export function parseActivityForm(b: Record<string, unknown>, policy: ProfessionalPlanPolicy, partial = false): Parsed<Partial<ActivityColumns>> {
  const out: Partial<ActivityColumns> = {};
  if (!partial || b.title !== undefined) {
    const t = text(b.title, 200);
    if (!t || t.length < 3) return { ok: false, error: "Name the activity in 3 to 200 characters." };
    out.title = t;
  }
  for (const [col, key, max, err] of [["detail", "detail", 2000, "Keep the notes under 2,000 characters."], ["provider", "provider", 160, "Keep the provider under 160 characters."]] as const) {
    if (partial && b[key] === undefined) continue;
    const v = text(b[key], max);
    if (v === undefined) return { ok: false, error: err };
    out[col] = v;
  }
  if (!partial || b.type !== undefined) {
    const r = pick(policy.activityTypes, b.type);
    if (!r) return { ok: false, error: "Choose a kind of activity from the list." };
    out.activity_type_code = r[0]; out.activity_type_label = r[1];
  }
  if (!partial || b.status !== undefined) {
    const s = b.status === undefined || b.status === "" ? "planned" : b.status;
    if (!isActivityStatus(s) || s === "completed" || !policy.activityStatuses.includes(s))
      return { ok: false, error: s === "completed" ? "An activity is completed by recording it as CPD or linking the learning record." : "Choose a status from the list." };
    out.status = s;
  }
  for (const [col, key] of [["planned_start", "plannedStart"], ["planned_end", "plannedEnd"]] as const) {
    if (partial && b[key] === undefined) continue;
    const d = isoDate(b[key]);
    if (d === undefined) return { ok: false, error: "A planned date is not a real date." };
    out[col] = d;
  }
  if (out.planned_start && out.planned_end && out.planned_end < out.planned_start) return { ok: false, error: "The planned end cannot be before the planned start." };
  if (!partial || b.url !== undefined) {
    const u = text(b.url, 500);
    if (u === undefined || (u && !/^https?:\/\/[^\s]+$/i.test(u))) return { ok: false, error: "A link must start with http:// or https://, up to 500 characters." };
    out.external_url = u;
  }
  for (const [col, key] of [["learning_offering_id", "offeringId"], ["depends_on_activity_id", "dependsOn"]] as const) {
    if (partial && b[key] === undefined) continue;
    const v = optId(b[key]);
    if (v === undefined) return { ok: false, error: "That reference is not valid." };
    out[col] = v;
  }
  return { ok: true, value: out };
}

/** Pure: a milestone. Only its title is required. */
export function parseMilestone(b: Record<string, unknown>, policy: ProfessionalPlanPolicy): Parsed<{ title: string; milestone_type_code: string | null; milestone_type_label: string | null; due_on: string | null }> {
  const t = text(b.title, 200);
  if (!t || t.length < 2) return { ok: false, error: "Name the milestone in 2 to 200 characters." };
  const r = pick(policy.milestoneTypes, b.type);
  if (!r) return { ok: false, error: "Choose a kind of milestone from the list." };
  const due = isoDate(b.dueOn);
  if (due === undefined) return { ok: false, error: "The due date is not a real date." };
  return { ok: true, value: { title: t, milestone_type_code: r[0], milestone_type_label: r[1], due_on: due } };
}

export type ReviewInput = { columns: Record<string, string | null>; decision: ReviewDecision; status: GoalStatus | null; priority: [string | null, string | null] | null };

/**
 * Pure: a review and the status it leaves the goal in. Every question is optional. Addressed is the person's own
 * judgement (the goal becomes done); it never verifies anything. Reopening follows the reopen rule.
 */
export function parseReview(b: Record<string, unknown>, statusBefore: string, policy: ProfessionalPlanPolicy): Parsed<ReviewInput> {
  const decision = b.decision as ReviewDecision;
  if (!(decision in REVIEW_STATUS)) return { ok: false, error: "Choose what you decided." };
  const columns: Record<string, string | null> = {};
  for (const f of REVIEW_FIELDS) {
    if (!policy.reviewFields.includes(f)) continue;
    const v = text(b[f], 2000);
    if (v === undefined) return { ok: false, error: "Keep each answer under 2,000 characters." };
    columns[REVIEW_COLUMN[f]] = v;
  }
  const status = REVIEW_STATUS[decision];
  if (status) {
    const ch = checkGoalStatusChange(statusBefore, status, policy);
    if (!ch.ok) return ch;
  }
  if (decision === "reopened" && (statusBefore === "planned" || statusBefore === "in_progress")) return { ok: false, error: "This goal is already open." };
  let priority: ReviewInput["priority"] = null;
  if (decision === "reprioritise") {
    const r = pick(policy.priorities, b.priority);
    if (!r || !r[0]) return { ok: false, error: "Choose the new priority from the list." };
    priority = r;
  }
  return { ok: true, value: { columns, decision, status: status === statusBefore ? null : status, priority } };
}

// ── SUGGESTIONS: DETERMINISTIC FIRST, AI ONLY WHEN ASKED ───────────────────────────────────────────────────────

const WORD = /[a-z0-9]{4,}/g;
const STOP = new Set(["with", "from", "that", "this", "your", "their", "more", "into", "able", "confidently", "develop", "improve", "better", "learn", "about", "using"]);
const words = (s: string) => new Set([...s.toLowerCase().matchAll(WORD)].map(m => m[0]).filter(w => !STOP.has(w)));

/** Pure: offered competencies whose title or description shares words with the goal. Deterministic, best first. */
export function matchCompetencies<T extends { competencyId: string; title: string; description?: string | null }>(goalText: string, offered: readonly T[], max = 5): T[] {
  const g = words(goalText);
  if (!g.size) return [];
  return offered
    .map(c => ({ c, score: [...words(`${c.title} ${c.description ?? ""}`)].filter(w => g.has(w)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title))
    .slice(0, max).map(x => x.c);
}

/** Pure: milestone ideas from the goal's own dates. Nothing is suggested without a start and a target. */
export function milestoneIdeas(g: { start_date: string | null; target_date: string | null }): { title: string; due_on: string; type: string }[] {
  if (!g.start_date || !g.target_date || g.target_date <= g.start_date) return [];
  const a = Date.parse(`${g.start_date}T00:00:00Z`), z = Date.parse(`${g.target_date}T00:00:00Z`);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const out = [{ title: "Halfway check on progress", due_on: day(a + (z - a) / 2), type: "checkpoint" }];
  if (z - a > 21 * 864e5) out.push({ title: "Gather the evidence you expect", due_on: day(z - 7 * 864e5), type: "evidence-gathered" });
  return out;
}

export type AiPlanKind = "activities" | "milestones" | "structure" | "evidence" | "review";
export const AI_PLAN_KINDS: readonly AiPlanKind[] = ["activities", "milestones", "structure", "evidence", "review"];

const GUARD = "Use only my own record. Do not invent qualifications, roles, feedback, results or events, and do not state or imply that I lack competence.";

/** The question for each kind. The goal's own words go in, cut short so the whole question fits the gateway's limit. */
export function aiPlanQuestion(kind: AiPlanKind, goal: { title: string; intended_outcome: string | null }): string {
  const g = `My goal: "${goal.title.slice(0, 160)}"${goal.intended_outcome ? `, aiming for: "${goal.intended_outcome.slice(0, 120)}"` : ""}.`;
  switch (kind) {
    case "activities": return `${g} Suggest up to three development activities. One per line exactly as: - <activity> :: <why>. ${GUARD}`;
    case "milestones": return `${g} Suggest up to three milestones. One per line exactly as: - <milestone> :: <why>. ${GUARD}`;
    case "structure": return `${g} Help me shape it. Reply with up to three lines exactly as: - outcome :: <text>, - evidence :: <text>, - motivation :: <text>. ${GUARD}`;
    case "evidence": return `${g} Summarise, in at most five sentences, what my own record already holds towards it and what I might still gather. ${GUARD}`;
    case "review": return `${g} Give me up to four short questions to help me review my progress honestly. Do not answer them for me. ${GUARD}`;
  }
}

/** Pure: suggestions from an AI answer, in the "- <a> :: <b>" shape. Anything else is ignored, at most three kept. */
export function parseAiPlanLines(answer: string): { title: string; basis: string }[] {
  const out: { title: string; basis: string }[] = [];
  for (const line of answer.split(/\r?\n/)) {
    const m = /^\s*(?:[-*]|\d+[.)])\s*(.{2,200}?)\s*::\s*(.{2,1000})\s*$/.exec(line);
    if (!m) continue;
    const title = m[1].replace(/\*\*/g, "").trim(), basis = m[2].replace(/\*\*/g, "").trim();
    if (title.length >= 2 && basis.length >= 2) out.push({ title: title.slice(0, 200), basis: basis.slice(0, 1000) });
    if (out.length === 3) break;
  }
  return out;
}

// ── IN-APP REMINDERS: DETERMINISTIC, FROM THE PERSON'S OWN DATES ─────────────────────────────────────────────────

export type PlanReminder = { goalId: string; kind: "target" | "review" | "milestone" | "stale"; on: string; text: string };

/** Pure: what is coming up or due. In-app only: nothing here sends anything. */
export function planReminders(input: {
  goals: readonly { id: string; title: string; status: string; target_date: string | null; review_date: string | null; reviewed_at: string | null; updated_at: string }[];
  milestones: readonly { goal_id: string; title: string; due_on: string | null; achieved_on: string | null }[];
  today: string; leadDays: number; reviewDays: number;
}): PlanReminder[] {
  const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const horizon = add(input.today, input.leadDays);
  const open = new Map(input.goals.filter(g => g.status === "planned" || g.status === "in_progress").map(g => [g.id, g]));
  const out: PlanReminder[] = [];
  for (const g of open.values()) {
    if (g.target_date && g.target_date <= horizon) out.push({ goalId: g.id, kind: "target", on: g.target_date, text: g.target_date < input.today ? `"${g.title}" passed its target date` : `"${g.title}" is due` });
    if (g.review_date && g.review_date <= horizon) out.push({ goalId: g.id, kind: "review", on: g.review_date, text: `Review "${g.title}"` });
    else if (!g.review_date && add((g.reviewed_at ?? g.updated_at).slice(0, 10), input.reviewDays) <= input.today)
      out.push({ goalId: g.id, kind: "stale", on: add((g.reviewed_at ?? g.updated_at).slice(0, 10), input.reviewDays), text: `"${g.title}" has not been reviewed for a while` });
  }
  for (const m of input.milestones) {
    if (!open.has(m.goal_id) || m.achieved_on || !m.due_on || m.due_on > horizon) continue;
    out.push({ goalId: m.goal_id, kind: "milestone", on: m.due_on, text: `Milestone "${m.title}"` });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
}
