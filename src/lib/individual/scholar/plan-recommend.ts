import { experienceHref } from "../experiences";
import { dayNumber } from "../learning-plan/recurrence";
import { latestPerRef, type Occurrence, type PlanEvent, type PlanItem, type ScholarPlanSettings } from "../learning-plan/types";
import type { MasteryEntry } from "./mastery";
import { topicKey } from "./plan-proposal";
import { acc, learnHref, noun, refKey, reviseHref, topicApply, topicLearn, topicRevise, type PlanSpace, type StudyPlanResult, type UnstartedSection } from "./study-plan";

// ── THE NEXT-ACTIVITY ENGINE ── PLP-01..04 (owner GO 2 Nov 2026), design gap 6 (Level 2, deterministic) ───────────
//
// Pure, no AI, no clock of its own (`today` is passed in). Candidates come from records the learner already made; the ORDER the
// rules are applied in is policy (`scholar_plan_rule_order`). Each candidate says WHY (their own numbers or choice), WHY NOW and WHAT
// HAPPENS IF IT WAITS, in plain words. The same input always gives the same answer.
//
//   due_revision   spaced-review cards that reached their date
//   gaps           topics needing work, items missed again and again, topics the monthly review flagged
//   unfinished     a lesson or revision session started and left open
//   exam           the exam date is near: the weakest topic, else mixed practice
//   deadline       a deadline the learner put in their calendar within 14 days, linked to a material or topic
//   consolidate    topics practised in the last days that would benefit from a short revision now
//   coverage       the next unstarted section of an accepted material, in order
//   competency     a competency the learner's own self-assessment rated below what their programme expects (CHECKLIST STUDIO S3)
//
// A declined suggestion is NOT offered again until the evidence behind it changes (its fingerprint). A topic the learner postponed is
// left out until the date they chose.
//
// ⚠ A RECOMMENDATION IS A SUGGESTION ABOUT WHAT TO STUDY. It says nothing about competence, and it never changes the plan by itself.

export const RULES = ["due_revision", "gaps", "unfinished", "exam", "deadline", "consolidate", "coverage", "competency"] as const;
export type RuleId = (typeof RULES)[number];
export const isRuleId = (x: string): x is RuleId => (RULES as readonly string[]).includes(x);
export const DEADLINE_DAYS = 14;
export const CONSOLIDATE_AGES = [1, 2, 3, 7, 8] as const;

export type PlanRecommendation = PlanItem & {
  rule: RuleId;
  space: PlanSpace | null;
  /** The evidence behind it. A declined suggestion returns only when this changes. */
  fingerprint: string;
  /** Normalised topic keys it is about (for postponing). */
  topics: readonly string[];
};

/**
 * A competency where the learner's OWN latest self-assessment is below the level their programme expects, or where an item was
 * left unjudged. It is the learner's word, never a verified fact and never an AI declaration: the rule only suggests studying it.
 */
export type CompetencyGapInput = {
  competencyId: string; title: string;
  /** When the self-assessment was submitted (ISO) and the rating it gave on the programme's scale. */
  assessedAt: string; self: number | null; expected: number | null;
  /** Criteria rated below the expected level, unjudged or left unanswered. */
  gapItems: number;
};

export type UnfinishedItem = { id: string; title: string; kind: "lesson" | "revision"; lastAt: string; href: string };
export type RecommendInput = {
  today: string;
  ruleOrder: readonly string[];
  settings: ScholarPlanSettings | null;
  /** The plan for the next seven days (today first), used for the exam phase and the length of an activity. */
  plan: StudyPlanResult | null;
  entries: readonly MasteryEntry[];
  dueCards: number;
  unfinished: readonly UnfinishedItem[];
  /** Weak topic labels from the monthly review, and its month. */
  monthlyWeak: { month: string; topics: readonly string[] } | null;
  /** Unstarted sections of the accepted materials, in order. */
  coverage: readonly UnstartedSection[];
  /** The learner's own calendar occurrences (deadlines are read). */
  calendar: readonly Occurrence[];
  /** recommendation_declined and topic_postponed events. */
  events: readonly PlanEvent[];
  postponed: ReadonlySet<string>;
  /** Activity refs the learner moved off today in the Calendar: not suggested for today (they are not declined, and come back on their new day). */
  moved?: ReadonlySet<string>;
  /** Fallback minutes for an activity when the plan does not give one. */
  fallbackMinutes: number;
  /** CHECKLIST STUDIO S3: gaps the learner's own self-assessments show. Absent or empty: the rule offers nothing. */
  competencyGaps?: readonly CompetencyGapInput[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const ago = (n: number) => (n === 1 ? "yesterday" : `${n} days ago`);

/** Pure. Everything the engine could suggest, grouped by rule and in each rule's own order, before declines and postponements. */
export function candidatesByRule(i: RecommendInput): Record<RuleId, PlanRecommendation[]> {
  const out: Record<RuleId, PlanRecommendation[]> = { due_revision: [], gaps: [], unfinished: [], exam: [], deadline: [], consolidate: [], coverage: [], competency: [] };
  const planned = new Map<string, number>();
  for (const d of i.plan?.thisWeek ?? []) for (const a of d.activities) if (!planned.has(a.ref)) planned.set(a.ref, a.minutes);
  const minutesFor = (ref: string) => planned.get(ref) ?? i.fallbackMinutes;
  const mk = (r: Omit<PlanRecommendation, "experience" | "source" | "due" | "topics"> & { topics?: readonly string[]; due?: string | null }): PlanRecommendation =>
    ({ experience: "scholar", source: "recommendation", due: null, topics: [], ...r });
  const keyed = (e: MasteryEntry) => [...new Set([topicKey(e.key), topicKey(e.label)])];

  // 1. due revision
  if (i.dueCards > 0) {
    out.due_revision.push(mk({
      rule: "due_revision", space: "revise", ref: "revise:due", title: "Review your due cards", minutes: minutesFor("revise:due"), href: reviseHref(),
      why: `${plural(i.dueCards, "card has", "cards have")} reached ${i.dueCards === 1 ? "its" : "their"} review date.`,
      whyNow: "Reviewing on the day a card is due is what makes it stick.",
      ifPostponed: `${i.dueCards === 1 ? "It stays" : "They stay"} due and will be first in line tomorrow. A card reviewed later is usually harder to recall.`,
      fingerprint: `due:${i.dueCards}`,
    }));
  }

  // 2. demonstrated gaps: needs work (lowest accuracy first), items missed again and again, then the monthly review's weak topics
  const needs = i.entries.filter(e => e.kind === "topic" && e.status === "needs_work").sort((a, b) => (a.recentAccuracy ?? 0) - (b.recentAccuracy ?? 0) || a.label.localeCompare(b.label));
  for (const e of needs) {
    out.gaps.push(mk({
      rule: "gaps", space: "learn", ref: `learn:${refKey(e.key)}`, title: `Learn ${noun(e)} again`, minutes: minutesFor(`learn:${refKey(e.key)}`), href: topicLearn(e), topics: keyed(e),
      why: `Your recent accuracy on ${noun(e)} is ${e.recentAccuracy}% over ${plural(e.attempts, "answer")}.`,
      whyNow: needs[0] === e ? "It is the topic that needs the most work right now." : "It is one of the topics that need work.",
      ifPostponed: "Your accuracy on it stays where it is until you practise it again, and it stays at the top of your list.",
      fingerprint: `gap:${e.key}:${e.attempts}:${e.recentAccuracy}`,
    }));
  }
  const missed = i.entries.filter(e => e.kind === "topic" && e.status !== "needs_work" && e.weakConcepts.some(w => w.latestWrong && w.misses >= 2))
    .sort((a, b) => b.weakConcepts.filter(w => w.latestWrong).length - a.weakConcepts.filter(w => w.latestWrong).length || a.label.localeCompare(b.label));
  for (const e of missed) {
    const n = e.weakConcepts.filter(w => w.latestWrong && w.misses >= 2).length;
    out.gaps.push(mk({
      rule: "gaps", space: "apply", ref: `apply:${refKey(e.key)}`, title: `Work on what you keep missing in ${noun(e)}`, minutes: minutesFor(`apply:${refKey(e.key)}`), href: topicApply(e), topics: keyed(e),
      why: `${plural(n, "question")} in ${noun(e)} ${n === 1 ? "has" : "have"} been answered wrongly more than once, most recently wrong${acc(e)}.`,
      whyNow: "Questions missed repeatedly are the ones that most need a different approach.",
      ifPostponed: "They stay on your list of mistakes and will come back in your practice.",
      fingerprint: `missed:${e.key}:${e.attempts}:${n}`,
    }));
  }
  const known = new Set(i.entries.map(e => topicKey(e.label)));
  for (const t of i.monthlyWeak?.topics ?? []) {
    if (known.has(topicKey(t)) && out.gaps.some(g => g.topics.includes(topicKey(t)))) continue;
    out.gaps.push(mk({
      rule: "gaps", space: "learn", ref: `learn:${refKey(t)}`, title: `Revisit ${t}`, minutes: minutesFor(`learn:${refKey(t)}`), href: learnHref(`topic=${encodeURIComponent(t)}`), topics: [topicKey(t)],
      why: `Your monthly review for ${i.monthlyWeak!.month} showed ${t} as a topic to revisit.`,
      whyNow: "It is the most recent review of your own work.",
      ifPostponed: "It stays on your review's list until you practise it.",
      fingerprint: `monthly:${i.monthlyWeak!.month}:${topicKey(t)}`,
    }));
  }

  // 3. unfinished lessons and open study sessions, most recently left first
  for (const u of [...i.unfinished].sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(b.id))) {
    out.unfinished.push(mk({
      rule: "unfinished", space: u.kind === "lesson" ? "learn" : "revise", ref: `unfinished:${u.id}`, title: `Finish ${u.title}`, minutes: i.fallbackMinutes, href: u.href,
      why: `You started ${u.title} on ${u.lastAt.slice(0, 10)} and have not finished it.`,
      whyNow: "It is where you left off, so it is quick to pick up.",
      ifPostponed: "It stays exactly where you left it.",
      fingerprint: `unfinished:${u.id}:${u.lastAt}`,
    }));
  }

  // 4. the exam date
  const plan = i.plan;
  if (plan && plan.daysLeft !== null && plan.daysLeft > 0 && (plan.phase === "final_week" || plan.phase === "consolidate")) {
    const exam = i.settings?.examLabel?.trim() || "your exam";
    const prio = new Set((i.settings?.priorities ?? []).map(topicKey));
    const weak = i.entries.filter(e => e.kind === "topic" && (e.status === "needs_work" || e.status === "developing"))
      .sort((a, b) => Number(prio.has(topicKey(b.key))) - Number(prio.has(topicKey(a.key))) || (a.status === "needs_work" ? 0 : 1) - (b.status === "needs_work" ? 0 : 1) || (a.recentAccuracy ?? 0) - (b.recentAccuracy ?? 0) || a.label.localeCompare(b.label));
    const w = weak[0];
    if (w) {
      out.exam.push(mk({
        rule: "exam", space: "revise", ref: `revise:${refKey(w.key)}`, title: `Review ${noun(w)}`, minutes: minutesFor(`revise:${refKey(w.key)}`), href: topicRevise(w), topics: keyed(w),
        why: `${plural(plan.daysLeft, "day")} until ${exam}, and ${noun(w)} is still ${w.status === "needs_work" ? "needing work" : "developing"}${acc(w)}.`,
        whyNow: plan.phase === "final_week" ? "It is your last week: weak topics come before new ground." : "The exam is close enough to check and consolidate before taking on more.",
        ifPostponed: `${plural(plan.daysLeft - 1, "day")} would be left to work on it.`,
        fingerprint: `exam:${w.key}:${w.attempts}:${w.recentAccuracy}:${plan.daysLeft}`,
      }));
    } else {
      out.exam.push(mk({
        rule: "exam", space: "revise", ref: "revise:mixed", title: "Mixed practice across your topics", minutes: minutesFor("revise:mixed"), href: reviseHref(),
        why: `${plural(plan.daysLeft, "day")} until ${exam}, and no topic is flagged as weak.`,
        whyNow: "Mixed questions keep every topic fresh and show which need attention.",
        ifPostponed: `${plural(plan.daysLeft - 1, "day")} would be left.`,
        fingerprint: `exam:mixed:${plan.daysLeft}`,
      }));
    }
  }

  // 5. deadlines in the learner's own calendar: within 14 days, linked to a material or topic
  const deadlines = i.calendar.filter(o => o.entryType === "deadline" && o.status === "planned" && o.link && (o.link.kind === "material" || o.link.kind === "topic")
    && o.date >= i.today && daysBetween(i.today, o.date) <= DEADLINE_DAYS).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const o of deadlines) {
    const left = daysBetween(i.today, o.date);
    const link = o.link!;
    out.deadline.push(mk({
      rule: "deadline", space: "learn", ref: `deadline:${o.key}`, title: `Prepare for ${o.title}`, minutes: i.fallbackMinutes, due: o.date,
      href: link.kind === "material" ? experienceHref("scholar", `study/${link.id}`) : learnHref(`topic=${encodeURIComponent(link.label)}`), topics: [topicKey(link.label), topicKey(link.id)],
      why: `You put ${o.title} in your calendar for ${o.date}, about ${link.label}.`,
      whyNow: left === 0 ? "It is today." : `${plural(left, "day")} left.`,
      ifPostponed: left === 0 ? "It will have passed." : `${plural(left - 1, "day")} would be left to prepare.`,
      fingerprint: `deadline:${o.key}:${o.date}`,
    }));
  }

  // 6. consolidate topics practised a few days ago that are not yet secure
  const consolidate = i.entries.filter(e => e.kind === "topic" && e.lastAt && e.status !== "secure" && e.status !== "not_started"
    && (CONSOLIDATE_AGES as readonly number[]).includes(daysBetween(e.lastAt.slice(0, 10), i.today)) && !out.gaps.some(g => g.ref === `learn:${refKey(e.key)}`))
    .sort((a, b) => b.lastAt!.localeCompare(a.lastAt!) || a.label.localeCompare(b.label));
  for (const e of consolidate) {
    const n = daysBetween(e.lastAt!.slice(0, 10), i.today);
    out.consolidate.push(mk({
      rule: "consolidate", space: "revise", ref: `revise:${refKey(e.key)}`, title: `Revise ${noun(e)}`, minutes: minutesFor(`revise:${refKey(e.key)}`), href: topicRevise(e), topics: keyed(e),
      why: `You practised ${noun(e)} ${ago(n)}${acc(e)}.`,
      whyNow: "A short revision a few days after first studying a topic helps it stay.",
      ifPostponed: "The longer the gap, the more you may need to relearn.",
      fingerprint: `consolidate:${e.key}:${e.lastAt}`,
    }));
  }

  // 7. coverage of the accepted materials, in order
  for (const s of i.coverage.slice(0, 3)) {
    out.coverage.push(mk({
      rule: "coverage", space: "learn", ref: `learn:${/^[0-9a-f-]{36}$/i.test(s.chunkId) ? s.chunkId.toLowerCase() : refKey(s.chunkId)}`, title: `Start on ${s.label}`, minutes: minutesFor(`learn:${s.chunkId.toLowerCase()}`),
      href: learnHref(`section=${s.chunkId}`), topics: [topicKey(s.label), ...(s.materialIds ?? []).map(topicKey)],
      why: s.competencyTitle ? `This section is linked to ${s.competencyTitle} and is in your plan with no practice yet.` : "This section of your notes is in your plan and has no practice yet.",
      whyNow: "Working through your notes in order keeps the whole plan covered.",
      ifPostponed: "It stays next in line and the sections after it wait too.",
      fingerprint: `coverage:${s.chunkId}`,
    }));
  }

  // 8. a competency the learner's own self-assessment rated below the programme's expectation: the largest shortfall first, then by title
  const shortfall = (g: CompetencyGapInput) => (g.expected !== null && g.self !== null ? Math.max(0, g.expected - g.self) : 0);
  const gapsOwn = [...(i.competencyGaps ?? [])].filter(g => g.gapItems > 0 || shortfall(g) > 0)
    .sort((a, b) => shortfall(b) - shortfall(a) || b.gapItems - a.gapItems || a.title.localeCompare(b.title) || a.competencyId.localeCompare(b.competencyId));
  for (const g of gapsOwn.slice(0, 3)) {
    const ref = `learn:competency-${g.competencyId.toLowerCase()}`;
    out.competency.push(mk({
      rule: "competency", space: "learn", ref, title: `Study ${g.title}`, minutes: minutesFor(ref), href: experienceHref("scholar", `study/learn?competency=${encodeURIComponent(g.competencyId)}`), topics: [topicKey(g.title)],
      why: shortfall(g) > 0
        ? `Your self-assessment on ${g.assessedAt.slice(0, 10)} rated ${g.title} at ${g.self} where your programme expects ${g.expected}. That is your own rating, not a verified result.`
        : `Your self-assessment on ${g.assessedAt.slice(0, 10)} left ${plural(g.gapItems, "criterion", "criteria")} of ${g.title} unjudged or unanswered. That is your own rating, not a verified result.`,
      whyNow: "Studying what you rated lowest is the quickest way to see whether your rating changes.",
      ifPostponed: "Your self-assessment stays as it is until you study this and repeat it.",
      fingerprint: `competency:${g.competencyId}:${g.assessedAt}`,
    }));
  }
  return out;
}

export type TodayChoice = { next: PlanRecommendation | null; alternatives: PlanRecommendation[]; /** Suggestions left out because the learner declined them and nothing changed. */ declined: number };

/**
 * Pure. The next activity and two alternatives: the rules in policy order, each rule's own order inside it, one entry per ref,
 * without a declined suggestion whose evidence is unchanged and without a postponed topic.
 */
export function chooseToday(i: RecommendInput): TodayChoice {
  const by = candidatesByRule(i);
  const declined = new Map([...latestPerRef(i.events.filter(e => e.kind === "recommendation_declined")).entries()].map(([ref, e]) => [ref, typeof e.value.fingerprint === "string" ? e.value.fingerprint : null]));
  const order = [...new Set(i.ruleOrder.filter(isRuleId))];
  const seen = new Set<string>();
  const list: PlanRecommendation[] = [];
  let skipped = 0;
  for (const rule of order) {
    for (const c of by[rule]) {
      if (seen.has(c.ref)) continue;
      if (c.topics.some(t => i.postponed.has(t))) continue;
      if (i.moved?.has(c.ref)) continue;
      if (declined.has(c.ref) && declined.get(c.ref) === c.fingerprint) { skipped++; seen.add(c.ref); continue; }
      seen.add(c.ref);
      list.push(c);
    }
  }
  return { next: list[0] ?? null, alternatives: list.slice(1, 3), declined: skipped };
}
