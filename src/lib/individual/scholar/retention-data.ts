/* eslint-disable @typescript-eslint/no-explicit-any */
import { getStudyPlan, listMappings, listMaterials, type Read } from "./store";
import { readStateInputs, norm, type StateInputs, type StateSources } from "./learning-state-data";
import { buildRetrievalSchedule, type RetrievalPlan, type RetrievalSchedule } from "./retrieval-schedule";
import { decidePrerequisite, frameworkPrerequisite, type CatalogueNode, type LinkedSection, type PrerequisiteDecision, type PrerequisiteSuggestion } from "./prerequisite";
import { transferOffered } from "./transfer";
import { loadLearnerCatalogue } from "./competency-view";
import { experienceHref } from "@/lib/individual/experiences";
import type { StateEvidence } from "./learning-state";
import type { IndividualPolicy } from "../policy";
import type { StudyNext } from "./mastery";

// ── SALE-2026-11 R2: THE RETENTION READS ── retrieval scheduling (SALE-08), prerequisite suggestions (SALE-09), transfer offers (SALE-10) ──
//
// Every one of them starts from readStateInputs (the learning state's own join) and is otherwise pure (retrieval.ts, prerequisite.ts,
// transfer.ts). Nothing is written and nothing is generated here. Each is behind its own HQ policy key, default OFF:
//   scholar_retrieval_schedule, scholar_prerequisite_suggestions, scholar_transfer_checks.
//
// ⚠ FOR R3 (My Plan, SALE-11): loadRetrievalSchedule is the read API. It returns null while the policy is off, never touches the plan,
// and every item names an action (kind, label, href), its minutes and its reasons. My Plan decides whether to propose it.

const revise = (q: string) => experienceHref("scholar", `study/revise${q ? `?${q}` : ""}`);
export const RETRIEVAL_HREFS = {
  questions: (materialId: string | null, chunkIds: readonly string[]) =>
    materialId ? revise(`material=${materialId}${chunkIds.length ? `&sections=${chunkIds.slice(0, 24).join(",")}` : ""}`) : revise(""),
  cards: (materialId: string | null) => revise(materialId ? `material=${materialId}` : ""),
};

/** The plan the learner set (780/840), as the retrieval rules read it. Absent, unreadable or not provisioned: no plan. */
async function retrievalPlan(admin: unknown, userId: string): Promise<RetrievalPlan | null> {
  const p = await Promise.resolve(getStudyPlan(admin, userId)).catch(() => null);
  if (!p?.ok || !p.data) return null;
  return { examDate: p.data.examDate, examLabel: p.data.examLabel, daysPerWeek: p.data.daysPerWeek || null, sessionMinutes: p.data.sessionMinutes, weeklyMinutes: p.data.weeklyMinutes || null, priorities: p.data.priorities };
}

/** The materials and section topics, read here when the caller has not already read them (My Plan, R3). */
async function sourcesOf(admin: unknown, userId: string, o?: StateSources): Promise<Read<StateSources>> {
  if (o) return { ok: true, data: o };
  const [m, maps] = await Promise.all([listMaterials(admin, userId), listMappings(admin, userId)]);
  if (!m.ok) return m;
  return { ok: true, data: { materials: m.data.map(x => ({ id: x.id, title: x.title })), concepts: maps.ok ? maps.data.concepts : null } };
}

/**
 * SALE-08, THE READ API (R3 consumes it). Null while scholar_retrieval_schedule is off. `today` is the learner's local day
 * (learnerToday); without it, the UTC day of `now`. Pass `sources` and `inputs` where already read, to read nothing twice.
 */
export async function loadRetrievalSchedule(admin: unknown, userId: string, policy: IndividualPolicy, now: string, o: { today?: string; sources?: StateSources; inputs?: StateInputs } = {}): Promise<Read<RetrievalSchedule> | null> {
  if (policy.scholarRetrievalSchedule !== "on") return null;
  let inputs = o.inputs;
  if (!inputs) {
    const src = await sourcesOf(admin, userId, o.sources);
    if (!src.ok) return src;
    const r = await readStateInputs(admin, userId, policy, now, src.data);
    if (!r.ok) return r;
    inputs = r.data;
  }
  const plan = await retrievalPlan(admin, userId);
  return {
    ok: true,
    data: buildRetrievalSchedule({
      topics: inputs.topics, evidence: inputs.evidence, cards: inputs.cards, today: o.today ?? now.slice(0, 10), plan,
      srs: { masteryReps: policy.scholarSrsMasteryReps, masteryDays: policy.scholarSrsMasteryDays, maxIntervalDays: policy.scholarSrsMaxIntervalDays, harderIntervalPercent: policy.scholarSrsHarderIntervalPercent },
      policy: { misconceptionPercent: policy.scholarRetrievalMisconceptionPercent, examBufferDays: policy.scholarRetrievalExamBufferDays, minutesPerTopic: policy.scholarRetrievalMinutesPerTopic, sharePercent: policy.scholarRetrievalSharePercent },
      hrefs: RETRIEVAL_HREFS,
    }),
  };
}

/** What SALE-09 needs beyond the learner's answers: their catalogue with prerequisite links, and their ACCEPTED section links. */
export type PrerequisiteGraph = { catalogue: Map<string, CatalogueNode>; sections: LinkedSection[]; byChunk: Map<string, string[]> };

/** The learner's catalogue (offered, published, allowlisted: catalogue.ts) and accepted section links. Null: unreadable or none. */
export async function loadPrerequisiteGraph(admin: unknown, userId: string, materials?: readonly { id: string; title: string }[]): Promise<PrerequisiteGraph | null> {
  const [cat, maps, mats] = await Promise.all([
    loadLearnerCatalogue(admin as any, userId), listMappings(admin, userId), materials ? Promise.resolve(null) : listMaterials(admin, userId),
  ]);
  if (!cat.competencies?.length || !maps.ok) return null;
  const catalogue = new Map<string, CatalogueNode>(cat.competencies.map(c => [c.id, { id: c.id, title: c.title, framework: c.catalogue, prerequisites: c.prerequisites ?? [] }]));
  if (![...catalogue.values()].some(c => c.prerequisites.length)) return { catalogue, sections: [], byChunk: new Map() };
  const titles = new Map((materials ?? (mats?.ok ? mats.data : [])).map(m => [m.id, m.title]));
  const sections: LinkedSection[] = [];
  const byChunk = new Map<string, string[]>();
  for (const m of maps.data.mappings) {
    if (m.state !== "accepted" || !catalogue.has(m.competencyId)) continue;
    const topic = maps.data.concepts.get(m.chunkId)?.find(x => x.trim())?.trim();
    sections.push({ chunkId: m.chunkId, materialId: m.materialId, competencyId: m.competencyId, label: `${titles.get(m.materialId) ?? "Your notes"}${topic ? `: ${topic}` : ""}` });
    byChunk.set(m.chunkId, [...new Set([...(byChunk.get(m.chunkId) ?? []), m.competencyId])]);
  }
  return { catalogue, sections, byChunk };
}

const byChunkOf = (evidence: readonly StateEvidence[]) => {
  const m = new Map<string, StateEvidence[]>();
  for (const e of evidence) if (e.chunkId) m.set(e.chunkId, [...(m.get(e.chunkId) ?? []), e]);
  return m;
};

/** SALE-09 for every topic of the learner's evidence. Empty while the policy is off or the graph cannot be read. */
export function prerequisiteDecisions(inputs: StateInputs, graph: PrerequisiteGraph | null, policy: IndividualPolicy): Map<string, PrerequisiteDecision> {
  const out = new Map<string, PrerequisiteDecision>();
  if (policy.scholarPrerequisiteSuggestions !== "on" || !graph) return out;
  const rows = new Map<string, StateEvidence[]>();
  for (const e of inputs.evidence) rows.set(e.topicKey, [...(rows.get(e.topicKey) ?? []), e]);
  const evidenceByChunk = byChunkOf(inputs.evidence);
  for (const t of inputs.topics) {
    const topicCompetencies = [...new Set(t.chunkIds.flatMap(c => graph.byChunk.get(c) ?? []))];
    out.set(t.key, decidePrerequisite({
      topic: t, rows: rows.get(t.key) ?? [], topicCompetencies, catalogue: graph.catalogue, sections: graph.sections, evidenceByChunk,
      thresholds: { misses: policy.scholarAdaptivePrerequisiteMisses, distinctQuestions: policy.scholarLearningStateDistinctQuestions },
    }));
  }
  return out;
}

/** SALE-09 in a lesson (R1 rule N3 already found a possible missing foundation): the framework prerequisite for these sections, if any. */
export async function lessonPrerequisite(admin: unknown, userId: string, policy: IndividualPolicy, o: {
  chunkIds: readonly string[]; label: string; missed: number; evidence: readonly StateEvidence[];
}): Promise<PrerequisiteSuggestion | null> {
  if (policy.scholarPrerequisiteSuggestions !== "on" || !o.chunkIds.length) return null;
  const graph = await loadPrerequisiteGraph(admin, userId).catch(() => null);
  if (!graph) return null;
  const topicCompetencies = [...new Set(o.chunkIds.flatMap(c => graph.byChunk.get(c) ?? []))];
  const d = frameworkPrerequisite({
    topic: { key: norm(o.label), label: o.label, chunkIds: o.chunkIds }, missed: o.missed, topicCompetencies, catalogue: graph.catalogue,
    sections: graph.sections, evidenceByChunk: byChunkOf(o.evidence), thresholds: { distinctQuestions: policy.scholarLearningStateDistinctQuestions },
  });
  return d.kind === "suggest" ? d.suggestion : null;
}

/** SALE-10 rule X1 for every topic. Empty while the policy is off or transfer evidence could not be read (970 absent). */
export function transferOffers(inputs: StateInputs, policy: IndividualPolicy): Map<string, { offered: boolean; reason: string }> {
  const out = new Map<string, { offered: boolean; reason: string }>();
  if (policy.scholarTransferChecks !== "on" || !inputs.transferRead) return out;
  const rows = new Map<string, StateEvidence[]>();
  for (const e of inputs.evidence) rows.set(e.topicKey, [...(rows.get(e.topicKey) ?? []), e]);
  for (const t of inputs.topics) out.set(t.key, transferOffered(rows.get(t.key) ?? [], policy.scholarLearningStateDistinctQuestions));
  return out;
}

/** Prerequisite link to the learner's own notes, or to a lesson on the prerequisite by name. */
export const prerequisiteHref = (s: PrerequisiteSuggestion): string =>
  s.section ? experienceHref("scholar", `study/learn?section=${s.section.chunkId}`) : experienceHref("scholar", `study/learn?topic=${encodeURIComponent(s.prerequisite.title.slice(0, 120))}`);

/** What the Revise page shows (retention-panel.tsx): each part null while its policy key is off or its read failed. */
export type RetentionView = {
  schedule: RetrievalSchedule | null;
  prerequisites: (PrerequisiteSuggestion & { href: string })[] | null;
  transfer: { topic: string; reason: string }[] | null;
};

/** The three R2 reads in one pass over the learner's evidence. Null when all three keys are off. Never throws. */
export async function loadRetentionView(admin: unknown, userId: string, policy: IndividualPolicy, now: string, o: { today: string; sources?: StateSources; inputs?: StateInputs }): Promise<RetentionView | null> {
  const on = { r: policy.scholarRetrievalSchedule === "on", p: policy.scholarPrerequisiteSuggestions === "on", t: policy.scholarTransferChecks === "on" };
  if (!on.r && !on.p && !on.t) return null;
  try {
    const src = await sourcesOf(admin, userId, o.sources);
    if (!src.ok) return { schedule: null, prerequisites: null, transfer: null };
    const inputs = o.inputs ? { ok: true as const, data: o.inputs } : await readStateInputs(admin, userId, policy, now, src.data);
    if (!inputs.ok) return { schedule: null, prerequisites: null, transfer: null };
    const [schedule, graph] = await Promise.all([
      on.r ? loadRetrievalSchedule(admin, userId, policy, now, { today: o.today, inputs: inputs.data }) : Promise.resolve(null),
      on.p ? loadPrerequisiteGraph(admin, userId, src.data.materials).catch(() => null) : Promise.resolve(null),
    ]);
    const decisions = prerequisiteDecisions(inputs.data, graph, policy);
    const lastAt = new Map<string, string>();
    for (const e of inputs.data.evidence) if ((lastAt.get(e.topicKey) ?? "") < e.at) lastAt.set(e.topicKey, e.at);
    const recent = (a: string, b: string) => (lastAt.get(b) ?? "").localeCompare(lastAt.get(a) ?? "");
    const prerequisites = on.p && graph ? [...decisions.values()].flatMap(d => (d.kind === "suggest" ? [{ ...d.suggestion, href: prerequisiteHref(d.suggestion) }] : []))
      .sort((a, b) => recent(a.topicKey, b.topicKey)) : null;
    const offers = transferOffers(inputs.data, policy);
    const label = new Map(inputs.data.topics.map(t => [t.key, t.label]));
    const transfer = on.t && inputs.data.transferRead ? [...offers.entries()].filter(([, x]) => x.offered).sort((a, b) => recent(a[0], b[0]))
      .map(([k, x]) => ({ topic: label.get(k) ?? k, reason: x.reason })) : null;
    return { schedule: schedule?.ok ? schedule.data : null, prerequisites, transfer };
  } catch { return { schedule: null, prerequisites: null, transfer: null }; }
}

/**
 * Pure. SALE-08 in Study next (Progress, where My Plan is off): at most `max` due retrieval items, placed after the "needs work"
 * items and before the rest, so going back over a weak topic still comes first. Never more than `cap` items in all.
 */
export function withRetrieval(own: readonly StudyNext[], schedule: RetrievalSchedule | null, cap = 5, max = 2): StudyNext[] {
  if (!schedule?.due.length) return [...own];
  const due: StudyNext[] = schedule.due.slice(0, max).map(i => ({
    id: `retrieval-${i.topicKey}`, tier: "other", title: `Recall ${i.label}`, reason: i.reasons[0],
    action: { space: i.action.kind === "case" ? "apply" : "revise", label: i.action.label, href: i.action.href }, covers: [],
  }));
  const weak = own.filter(x => x.tier === "needs_work");
  const rest = own.filter(x => x.tier !== "needs_work");
  return [...weak, ...due, ...rest].slice(0, cap);
}
