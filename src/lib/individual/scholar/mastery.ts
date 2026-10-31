import { COGNITIVE_LEVELS, LEVEL_LABEL, type CognitiveLevel } from "./question-intel";
import { experienceHref } from "@/lib/individual/experiences";
import { withStudy } from "./study-carry";
import type { Recommendation } from "./intelligence";

// ── LEARNING PROGRESS BY TOPIC AND COMPETENCY, AND WHAT TO STUDY NEXT ── SCHOLAR-COMPANION-01 P1 ───────────────
//
// Pure: no I/O, no clock of its own (`now` is passed in), NO AI. Rows of evidence the learner already produced
// (answers to practice questions, spaced-review ratings, OSCE practice runs) are turned into, per topic and per
// accepted competency of the programme:
//
//   attempts, recency-weighted accuracy, accuracy by cognitive level, the highest level demonstrated,
//   a status (not_started | needs_work | developing | secure), the items still going wrong, and the BASIS in words.
//
// and into at most five "study next" recommendations, each with its reason in the learner's own numbers.
//
// ⚠ LEARNING PROGRESS IS NOT VERIFIED COMPETENCE. "secure" here means "your recent practice on this has gone
//   well", never "you are competent". Nothing here is read by, or written to, the Passport, and the Evaluation's
//   `verified` stays not_assessed. A competency row is learning activity against a competency, labelled so.
// ⚠ NEVER BLENDED SILENTLY. Evidence marked by the app (a question's key) counts in full. AI-evaluated written
//   answers and self-rated ones count less (MARKING_WEIGHT) AND are counted apart (`byMarking`) on every entry,
//   so the learner can see how much of a figure rests on what.
// ⚠ A STATUS NEEDS ITS EVIDENCE. "secure" needs a minimum of weighted evidence (`secureMinEvidence`), not just a
//   high percentage: three AI-evaluated answers do not make a topic secure on their own.
// ⚠ NOT STARTED IS NOT 0%. An entry with no evidence has `recentAccuracy: null`.

export type MasteryLevel = CognitiveLevel | "unknown";
/** code: marked by the app against a key. ai_evaluation: marked by an AI model. self: the learner's own rating. */
export type MasteryMarking = "code" | "ai_evaluation" | "self";
export type EvidenceKind = "question" | "review" | "osce";
export type MasteryStatus = "not_started" | "needs_work" | "developing" | "secure";

/** One piece of evidence. `correct` for a right/wrong answer, or `score` (0 to 1) for a graded one; `score` wins. */
export type MasteryEvidence = {
  /** The thing answered (a question id, a card's question id, an OSCE station): repeated answers share it. */
  itemId: string;
  topic: string | null;
  /** "topic": a topic found in the section or named on the item. "material": no topic known, the material stands in. */
  topicSource?: "topic" | "material";
  competencyId: string | null;
  materialId: string;
  chunkId: string | null;
  kind: EvidenceKind;
  level: MasteryLevel;
  correct?: boolean;
  score?: number;
  at: string;
  marking: MasteryMarking;
};

export type MasteryThresholds = {
  /** Recency-weighted accuracy, percent, at or above which a topic can be secure (only with enough evidence). */
  securePercent: number;
  /** Below this a topic needs work. Between this and securePercent it is developing. */
  developingPercent: number;
  /** Weighted evidence (answers by marking weight) a topic needs before it can be secure. */
  secureMinEvidence: number;
  /** An answer's weight halves every this many days. */
  halfLifeDays: number;
  /** A level is demonstrated with at least this much weighted correct evidence at it ... */
  levelMinCorrect: number;
  /** ... and at least this weighted accuracy at it. */
  levelMinPercent: number;
  /** An item missed this many times is a weak concept (as is one whose latest answer was wrong). */
  weakMisses: number;
  /** "N of your last K answers": K. */
  recentAnswers: number;
  /** How far back evidence is read, in days. */
  windowDays: number;
  /** Most recommendations. */
  maxRecommendations: number;
};

export const DEFAULT_MASTERY_THRESHOLDS: MasteryThresholds = {
  securePercent: 80, developingPercent: 50, secureMinEvidence: 3, halfLifeDays: 14,
  levelMinCorrect: 2, levelMinPercent: 70, weakMisses: 2, recentAnswers: 5, windowDays: 180, maxRecommendations: 5,
};

/** How much one answer counts, by who marked it. */
export const MARKING_WEIGHT: Record<MasteryMarking, number> = { code: 1, ai_evaluation: 0.5, self: 0.35 };
export const MARKING_LABEL: Record<MasteryMarking, string> = { code: "marked by the app", ai_evaluation: "AI-evaluated", self: "self-rated" };
export const MASTERY_STATUS_LABEL: Record<MasteryStatus, string> = { not_started: "Not started", needs_work: "Needs work", developing: "Developing", secure: "Going well" };

export type LevelStat = { level: MasteryLevel; attempts: number; correct: number; accuracy: number | null; demonstrated: boolean };
export type WeakConcept = { itemId: string; attempts: number; misses: number; latestWrong: boolean };
export type MasteryEntry = {
  kind: "topic" | "competency";
  /** The normalised topic, or the competency id. */
  key: string;
  label: string;
  /** The material with the most evidence (a topic), used to open it. */
  materialId: string | null;
  chunkId: string | null;
  topicSource: "topic" | "material" | null;
  status: MasteryStatus;
  attempts: number;
  /** Recency- and marking-weighted accuracy as a whole percentage. Null with no evidence. */
  recentAccuracy: number | null;
  byLevel: LevelStat[];
  highestLevel: CognitiveLevel | null;
  byMarking: Record<MasteryMarking, number>;
  weakConcepts: WeakConcept[];
  /** The last `recentAnswers` answers: how many, and how many were wrong. */
  last: { n: number; wrong: number };
  lastAt: string | null;
  basis: string;
};

export type StudySpaceName = "revise" | "learn" | "apply";
export type StudyNext = {
  id: string;
  tier: "needs_work" | "step_up" | "due_cards" | "unpractised" | "other";
  title: string;
  reason: string;
  action: { space: StudySpaceName; label: string; href: string };
  /** Learning-intelligence recommendation ids this one says the same thing as. */
  covers: string[];
};

export type MasteryInput = {
  evidence: readonly MasteryEvidence[];
  now: string;
  /** The programme's competencies (accepted maps only count against them). Empty: no competency entries. */
  competencies?: readonly { id: string; title: string }[];
  /** Topics known from the notes but possibly never practised: they appear as not_started. */
  knownTopics?: readonly { topic: string; materialId: string; chunkId: string | null }[];
  /** Sections accepted-mapped to a programme competency. Those with no evidence at all are "never practised". */
  mappedSections?: readonly { chunkId: string; materialId: string; label: string; competencyId: string; competencyTitle: string }[];
  /** Spaced-review cards due today, per material. */
  dueCards?: readonly { materialId: string; materialTitle: string; due: number }[];
  /** A connected study session: carried onto every link (withStudy). */
  studyId?: string | null;
  /** The loader hit its row cap, so older evidence was not read. Said in every basis. */
  truncated?: boolean;
  thresholds?: Partial<MasteryThresholds>;
};

export type MasteryResult = {
  topics: MasteryEntry[];
  competencies: MasteryEntry[];
  studyNext: StudyNext[];
  /** Everything read, by who marked it: never blended. */
  byMarking: Record<MasteryMarking, number>;
  evidenceCount: number;
  thresholds: MasteryThresholds;
};

const DAY = 86_400_000;
const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
const outcomeOf = (r: MasteryEvidence) => (typeof r.score === "number" ? Math.max(0, Math.min(1, r.score)) : r.correct ? 1 : 0);
const isRight = (r: MasteryEvidence) => outcomeOf(r) >= 0.5;
const pct = (x: number) => Math.round(x * 100);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const emptyMarking = (): Record<MasteryMarking, number> => ({ code: 0, ai_evaluation: 0, self: 0 });
const LADDER: readonly CognitiveLevel[] = COGNITIVE_LEVELS;

/** Pure. Everything known about one topic or competency from its evidence rows. */
function summarise(
  kind: "topic" | "competency", key: string, label: string, rows: readonly MasteryEvidence[], T: MasteryThresholds, nowMs: number,
  fallback: { materialId: string | null; chunkId: string | null; topicSource: "topic" | "material" | null }, truncated: boolean,
): MasteryEntry {
  const byMarking = emptyMarking();
  let wSum = 0, wOut = 0, evidenceWeight = 0;
  const levels = new Map<MasteryLevel, { n: number; right: number; wTotal: number; wRight: number }>();
  const items = new Map<string, { n: number; misses: number; latestAt: string; latestWrong: boolean }>();
  const perMaterial = new Map<string, number>();
  for (const r of rows) {
    const mw = MARKING_WEIGHT[r.marking];
    const age = Math.max(0, (nowMs - Date.parse(r.at)) / DAY);
    const w = mw * Math.pow(0.5, age / T.halfLifeDays);
    wSum += w; wOut += w * outcomeOf(r); evidenceWeight += mw;
    byMarking[r.marking]++;
    const right = isRight(r);
    const l = levels.get(r.level) ?? { n: 0, right: 0, wTotal: 0, wRight: 0 };
    l.n++; if (right) l.right++; l.wTotal += mw; if (right) l.wRight += mw;
    levels.set(r.level, l);
    const it = items.get(r.itemId) ?? { n: 0, misses: 0, latestAt: "", latestWrong: false };
    it.n++; if (!right) it.misses++;
    if (r.at >= it.latestAt) { it.latestAt = r.at; it.latestWrong = !right; }
    items.set(r.itemId, it);
    perMaterial.set(r.materialId, (perMaterial.get(r.materialId) ?? 0) + 1);
  }
  const attempts = rows.length;
  const acc = wSum > 0 ? wOut / wSum : null;

  const levelOrder: MasteryLevel[] = [...LADDER, ...(levels.has("unknown") ? (["unknown"] as const) : [])];
  const byLevel: LevelStat[] = levelOrder.map(level => {
    const l = levels.get(level);
    if (!l) return { level, attempts: 0, correct: 0, accuracy: null, demonstrated: false };
    const wAcc = l.wTotal > 0 ? l.wRight / l.wTotal : 0;
    return { level, attempts: l.n, correct: l.right, accuracy: pct(l.right / l.n),
      demonstrated: level !== "unknown" && l.wRight >= T.levelMinCorrect && wAcc * 100 >= T.levelMinPercent };
  });
  const highestLevel = [...LADDER].reverse().find(lv => byLevel.find(b => b.level === lv)?.demonstrated) ?? null;

  const status: MasteryStatus = attempts === 0 ? "not_started"
    : acc! * 100 < T.developingPercent ? "needs_work"
      : acc! * 100 >= T.securePercent && evidenceWeight >= T.secureMinEvidence ? "secure" : "developing";

  const weakConcepts: WeakConcept[] = [...items.entries()]
    .filter(([, v]) => v.misses >= T.weakMisses || v.latestWrong)
    .map(([itemId, v]) => ({ itemId, attempts: v.n, misses: v.misses, latestWrong: v.latestWrong }))
    .sort((a, b) => b.misses - a.misses || Number(b.latestWrong) - Number(a.latestWrong) || a.itemId.localeCompare(b.itemId)).slice(0, 10);

  const recent = [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, T.recentAnswers);
  const last = { n: recent.length, wrong: recent.filter(r => !isRight(r)).length };
  const lastAt = rows.reduce<string | null>((m, r) => (m === null || r.at > m ? r.at : m), null);

  const bestMaterial = [...perMaterial.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback.materialId;
  const chunkRows = rows.filter(r => r.chunkId && r.materialId === bestMaterial);
  const chunkCount = new Map<string, number>();
  for (const r of chunkRows) chunkCount.set(r.chunkId!, (chunkCount.get(r.chunkId!) ?? 0) + 1);
  const bestChunk = [...chunkCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback.chunkId;
  const sources = new Set(rows.map(r => r.topicSource ?? "topic"));
  const topicSource = kind === "topic" ? (rows.length ? (sources.has("topic") ? "topic" : "material") : fallback.topicSource) : null;

  const marks = (["code", "ai_evaluation", "self"] as const).filter(m => byMarking[m] > 0).map(m => `${byMarking[m]} ${MARKING_LABEL[m]}`);
  const basis = attempts === 0
    ? "No answers recorded yet, so there is nothing to base a status on."
    : `${plural(attempts, "answer")} in the last ${T.windowDays} days (${marks.join(", ")})${truncated ? ", not counting older ones that were not read" : ""}. `
      + `Recent answers count more (half-life ${T.halfLifeDays} days) and AI-evaluated or self-rated ones count less, which gives ${pct(acc!)}% recent accuracy. `
      + (status === "needs_work" ? `Below ${T.developingPercent}% means needs work.`
        : status === "secure" ? `${T.securePercent}% or more with at least ${T.secureMinEvidence} marked answers' worth of evidence means going well.`
          : acc! * 100 >= T.securePercent ? `${T.securePercent}% or more, but there is not yet enough evidence (about ${T.secureMinEvidence} app-marked answers) to call it going well.`
            : `${T.developingPercent}% to ${T.securePercent - 1}% means developing.`)
      + " This is learning progress on your own practice, not verified competence.";

  return {
    kind, key, label, materialId: bestMaterial, chunkId: bestChunk, topicSource, status, attempts, recentAccuracy: acc === null ? null : pct(acc),
    byLevel, highestLevel, byMarking, weakConcepts, last, lastAt, basis,
  };
}

const STATUS_RANK: Record<MasteryStatus, number> = { needs_work: 0, developing: 1, secure: 2, not_started: 3 };
const byUrgency = (a: MasteryEntry, b: MasteryEntry) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.attempts - a.attempts || a.label.localeCompare(b.label);

const learnHref = (q: string) => experienceHref("scholar", `study/learn?${q}`);
const reviseHref = (q = "") => experienceHref("scholar", `study/revise${q ? `?${q}` : ""}`);
const applyHref = (q = "") => experienceHref("scholar", `study/apply${q ? `?${q}` : ""}`);

/** Pure. Everything the Progress page's "Study next" and "Mastery" views show, from the evidence rows. */
export function buildMastery(input: MasteryInput): MasteryResult {
  const T: MasteryThresholds = { ...DEFAULT_MASTERY_THRESHOLDS, ...input.thresholds };
  const nowMs = Date.parse(input.now);
  const truncated = !!input.truncated;
  const evidence = input.evidence;

  // ── topics ──
  const topicRows = new Map<string, { label: string; rows: MasteryEvidence[] }>();
  for (const r of evidence) {
    if (!r.topic || !r.topic.trim()) continue;
    const k = norm(r.topic);
    const g = topicRows.get(k) ?? { label: r.topic.trim(), rows: [] };
    g.rows.push(r); topicRows.set(k, g);
  }
  const topics: MasteryEntry[] = [...topicRows.entries()].map(([k, g]) =>
    summarise("topic", k, g.label, g.rows, T, nowMs, { materialId: null, chunkId: null, topicSource: "topic" }, truncated));
  for (const kt of input.knownTopics ?? []) {
    const k = norm(kt.topic);
    if (!k || topicRows.has(k)) continue;
    topicRows.set(k, { label: kt.topic.trim(), rows: [] });
    topics.push(summarise("topic", k, kt.topic.trim(), [], T, nowMs, { materialId: kt.materialId, chunkId: kt.chunkId, topicSource: "topic" }, truncated));
  }
  topics.sort(byUrgency);

  // ── competencies (accepted maps only: the loader attaches competencyId only through an accepted link) ──
  const programme = new Map((input.competencies ?? []).map(c => [c.id, c.title]));
  const compRows = new Map<string, MasteryEvidence[]>();
  for (const r of evidence) if (r.competencyId && programme.has(r.competencyId)) compRows.set(r.competencyId, [...(compRows.get(r.competencyId) ?? []), r]);
  const linked = new Set((input.mappedSections ?? []).filter(s => programme.has(s.competencyId)).map(s => s.competencyId));
  const competencies: MasteryEntry[] = [...new Set([...compRows.keys(), ...linked])].map(id =>
    summarise("competency", id, programme.get(id)!, compRows.get(id) ?? [], T, nowMs, { materialId: null, chunkId: null, topicSource: null }, truncated)).sort(byUrgency);

  const byMarking = emptyMarking();
  for (const r of evidence) byMarking[r.marking]++;

  // ── study next ──
  const out: StudyNext[] = [];
  const topicNoun = (e: MasteryEntry) => (e.topicSource === "material" ? `your notes "${e.label}"` : e.label);
  const topicLearn = (e: MasteryEntry) => e.topicSource === "material" && e.materialId ? experienceHref("scholar", `study/${e.materialId}`) : learnHref(`topic=${encodeURIComponent(e.label)}`);
  const hits = (e: MasteryEntry) => e.last.wrong;

  // 1. needs work, recent misses first
  const weak = topics.filter(t => t.status === "needs_work")
    .sort((a, b) => Number(hits(b) > 0) - Number(hits(a) > 0) || hits(b) - hits(a) || (a.recentAccuracy ?? 0) - (b.recentAccuracy ?? 0) || a.label.localeCompare(b.label));
  for (const e of weak) {
    out.push({
      id: `needs-${e.key}`, tier: "needs_work", title: `Go back over ${topicNoun(e)}`,
      reason: hits(e) > 0
        ? `${e.last.wrong} of your last ${e.last.n} answer${e.last.n === 1 ? " was" : "s were"} wrong on ${topicNoun(e)}, and your recent accuracy is ${e.recentAccuracy}%.`
        : `Your recent accuracy on ${topicNoun(e)} is ${e.recentAccuracy}% over ${plural(e.attempts, "answer")}.`,
      action: { space: "learn", label: "Teach me", href: topicLearn(e) },
      covers: e.materialId ? [`revisit-${e.materialId}`] : [],
    });
  }
  // 2. developing, not yet shown at application: step up a level
  const stepUp = topics.filter(t => t.status === "developing" && (t.highestLevel === null || LADDER.indexOf(t.highestLevel) < LADDER.indexOf("application")))
    .sort((a, b) => (b.recentAccuracy ?? 0) - (a.recentAccuracy ?? 0) || b.attempts - a.attempts || a.label.localeCompare(b.label));
  for (const e of stepUp) {
    const target = LADDER[e.highestLevel === null ? 0 : LADDER.indexOf(e.highestLevel) + 1];
    const shown = e.highestLevel === null ? "no level shown yet" : `${LEVEL_LABEL[e.highestLevel].toLowerCase()} shown so far`;
    const toApply = target === "application";
    out.push({
      id: `step-${e.key}`, tier: "step_up", title: `${e.highestLevel === null ? "Practise" : "Step up to"} ${LEVEL_LABEL[target].toLowerCase()} questions on ${topicNoun(e)}`,
      reason: `You are developing on ${topicNoun(e)} (${e.recentAccuracy}% recent accuracy, ${shown}). Questions at the next level show whether it holds when you use it.`,
      action: toApply && e.chunkId
        ? { space: "apply", label: "Try a scenario", href: applyHref(`section=${e.chunkId}&from=revision`) }
        : { space: "revise", label: "Practise", href: reviseHref(e.materialId ? `material=${e.materialId}&difficulty=${toApply ? "harder" : "standard"}` : "") },
      covers: [],
    });
  }
  // 3. cards due
  const due = (input.dueCards ?? []).filter(d => d.due > 0);
  if (due.length) {
    const total = due.reduce((n, d) => n + d.due, 0);
    const one = due.length === 1 ? due[0] : null;
    out.push({
      id: "due-cards", tier: "due_cards", title: `Review ${plural(total, "due card")}`,
      reason: one ? `${plural(total, "card has", "cards have")} reached its review date in ${one.materialTitle}.` : `${plural(total, "card has", "cards have")} reached its review date, across ${plural(due.length, "material")}.`,
      action: { space: "revise", label: "Review cards", href: reviseHref(one ? `material=${one.materialId}` : "") },
      covers: ["review-due"],
    });
  }
  // 4. mapped sections never practised
  const touched = new Set(evidence.map(r => r.chunkId).filter((x): x is string => !!x));
  const fresh = (input.mappedSections ?? []).filter(s => programme.has(s.competencyId) && !touched.has(s.chunkId));
  const byComp = new Map<string, typeof fresh>();
  for (const s of fresh) byComp.set(s.competencyId, [...(byComp.get(s.competencyId) ?? []), s]);
  for (const [, secs] of [...byComp.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0].competencyTitle.localeCompare(b[1][0].competencyTitle))) {
    const s = secs[0];
    out.push({
      id: `fresh-${s.competencyId}`, tier: "unpractised", title: `Start on ${s.label}`,
      reason: `${plural(secs.length, "section")} of your notes linked to ${s.competencyTitle} ${secs.length === 1 ? "has" : "have"} no practice yet.`,
      action: { space: "learn", label: "Start learning", href: learnHref(`section=${s.chunkId}`) },
      covers: ["coverage-gaps"],
    });
  }

  const studyNext = out.slice(0, T.maxRecommendations).map(r => ({ ...r, action: { ...r.action, href: withStudy(r.action.href, input.studyId) } }));
  return { topics, competencies, studyNext, byMarking, evidenceCount: evidence.length, thresholds: T };
}

// ── MERGING WITH LEARNING INTELLIGENCE ──────────────────────────────────────────────────────────────────────────

/** Pure. A link without its `study` parameter and with the others in a fixed order, so equal places compare equal. */
export function hrefKey(href: string): string {
  const hash = href.indexOf("#");
  const base = hash >= 0 ? href.slice(0, hash) : href;
  const q = base.indexOf("?");
  const path = q >= 0 ? base.slice(0, q) : base;
  const params = new URLSearchParams(q >= 0 ? base.slice(q + 1) : "");
  params.delete("study");
  params.sort();
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
}

const spaceOf = (href: string): StudySpaceName => (/\/study\/revise(\?|$)/.test(href) ? "revise" : /\/study\/apply(\?|$)/.test(href) ? "apply" : "learn");
const LABEL: Record<StudySpaceName, string> = { revise: "Open Revise", apply: "Open Apply", learn: "Open" };

/**
 * Pure. The "Study next" list: ours first, then learning-intelligence recommendations that say something new, up to
 * `cap`. A recommendation of intelligence's is a duplicate (and is dropped from both lists) when its link is the same
 * place as one of ours (hrefKey), or when one of ours names it in `covers`. `rest` is what intelligence still shows
 * in its own "What to do next" list: the recommendations not placed in the card and not duplicates of it.
 */
export function mergeStudyNext(own: readonly StudyNext[], intel: readonly Recommendation[], cap: number, studyId?: string | null): { items: StudyNext[]; rest: Recommendation[] } {
  const items = own.slice(0, cap);
  const keys = new Set(items.map(i => hrefKey(i.action.href)));
  const covered = new Set(items.flatMap(i => i.covers));
  const duplicate = (r: Recommendation) => covered.has(r.id) || (r.href !== null && keys.has(hrefKey(r.href)));
  const rest: Recommendation[] = [];
  for (const r of intel) {
    if (duplicate(r)) continue;
    if (r.href !== null && items.length < cap && !keys.has(hrefKey(r.href))) {
      const space = spaceOf(r.href);
      items.push({ id: `intel-${r.id}`, tier: "other", title: r.title, reason: r.reason, action: { space, label: LABEL[space], href: withStudy(r.href, studyId) }, covers: [r.id] });
      keys.add(hrefKey(r.href));
    } else rest.push(r);
  }
  return { items, rest };
}
