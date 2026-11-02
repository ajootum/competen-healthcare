import { latestPerRef, type PlanEvent } from "../learning-plan/types";
import type { UnstartedSection } from "./study-plan";

// ── THE PLAN PROPOSAL ── PLP-01..04 (owner GO 2 Nov 2026), design gaps 5 ─────────────────────────────────────────────
//
// Pure, no AI, deterministic. When the learner's notes are ready, Scholar can PROPOSE how to fit them into the plan:
//   - a suggested SEQUENCE (the material's sections in their own order, new topics only),
//   - a WORKLOAD ESTIMATE (sections x `scholar_plan_section_minutes`),
//   - SUGGESTED SESSIONS given the learner's settings (or 30 minutes x 3 days when there are none),
//   - REVISION POINTS (+1, +3 and +7 days after first study).
// The learner accepts, personalises, defers or declines. Learning never waits for the answer. The decision is a plan event
// (kind proposal, ref the material id). An ACCEPTED material feeds the plan: its unstarted sections, in order, with a topic
// already planned from an earlier accepted material counted once (all source materials are kept as references).
//
// ⚠ A proposal is a suggestion about TIME. It says nothing about how well the learner knows the material.

export const DEFAULT_SESSION = { sessionMinutes: 30, daysPerWeek: 3 } as const;
export const REVISION_OFFSETS = [1, 3, 7] as const;
export type ProposalDecision = "accepted" | "declined" | "deferred";
export const isProposalDecision = (x: unknown): x is ProposalDecision => x === "accepted" || x === "declined" || x === "deferred";

/** The topic key: case, accents and punctuation do not make a different topic. */
export const topicKey = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export type SectionIn = { chunkId: string; ordinal: number; /** Topics found in the section (the learner's corrections included). */ topics: readonly string[]; started?: boolean };
export type MaterialIn = { materialId: string; title: string; sections: readonly SectionIn[] };
export type TopicRef = { key: string; label: string; materialIds: string[]; sections: number };

/** The label a section is planned under: its first topic, else "Section n" (n = its place in its material). */
export const sectionLabel = (s: SectionIn, index: number) => s.topics.map(t => t.trim()).find(Boolean) ?? `Section ${index + 1}`;

/**
 * Pure. The distinct topics across materials, in the order first met, each with EVERY material that names it and how many
 * sections name it. Deduped by normalised label.
 */
export function dedupeTopics(materials: readonly MaterialIn[]): TopicRef[] {
  const out = new Map<string, TopicRef>();
  for (const m of materials) {
    for (const s of m.sections) {
      for (const raw of new Set(s.topics.map(t => t.trim()).filter(Boolean))) {
        const k = topicKey(raw);
        if (!k) continue;
        const cur = out.get(k);
        if (!cur) out.set(k, { key: k, label: raw, materialIds: [m.materialId], sections: 1 });
        else { cur.sections++; if (!cur.materialIds.includes(m.materialId)) cur.materialIds.push(m.materialId); }
      }
    }
  }
  return [...out.values()];
}

export type SequenceStep = { chunkId: string; ordinal: number; label: string; minutes: number; /** Earlier accepted materials that already cover this topic. */ coveredIn: string[] };
export type PlanProposal = {
  materialId: string; title: string;
  /** No plan settings are saved yet: this is the learner's first plan. */
  firstPlan: boolean;
  sequence: SequenceStep[];
  /** Sections of the material, and how many of them are new to the plan (not a topic an earlier accepted material already plans). */
  sectionCount: number; newSections: number;
  workloadMinutes: number;
  sessions: { sessionMinutes: number; daysPerWeek: number; sessionsNeeded: number; weeksNeeded: number; usingDefaults: boolean };
  revisionPoints: { afterDays: number; label: string }[];
  topics: TopicRef[];
  /** In plain words. */
  summary: string;
};

/**
 * Pure. The proposal for ONE material. `earlier` are the learner's other ACCEPTED materials (their topics are not planned twice).
 * The sequence is the material's sections in order; a section whose first topic an earlier accepted material already covers is listed
 * as covered there and not counted in the workload.
 */
export function buildProposal(o: {
  material: MaterialIn;
  earlier: readonly MaterialIn[];
  settings: { sessionMinutes: number; daysPerWeek: number } | null;
  sectionMinutes: number;
  firstPlan: boolean;
}): PlanProposal {
  const have = new Map<string, string[]>();
  for (const t of dedupeTopics(o.earlier)) have.set(t.key, t.materialIds);
  const titleOf = new Map(o.earlier.map(m => [m.materialId, m.title]));
  const seenHere = new Set<string>();
  const sequence: SequenceStep[] = [];
  let fresh = 0;
  o.material.sections.slice().sort((a, b) => a.ordinal - b.ordinal || a.chunkId.localeCompare(b.chunkId)).forEach((s, i) => {
    const label = sectionLabel(s, i);
    const k = topicKey(label);
    const covered = (have.get(k) ?? []).map(id => titleOf.get(id) ?? "your notes");
    const dup = k !== "" && (covered.length > 0 || seenHere.has(k));
    if (k) seenHere.add(k);
    if (!dup) fresh++;
    sequence.push({ chunkId: s.chunkId, ordinal: s.ordinal, label, minutes: dup ? 0 : o.sectionMinutes, coveredIn: covered });
  });
  const workloadMinutes = fresh * o.sectionMinutes;
  const usingDefaults = !o.settings;
  const { sessionMinutes, daysPerWeek } = o.settings ?? DEFAULT_SESSION;
  const sessionsNeeded = workloadMinutes > 0 ? Math.ceil(workloadMinutes / Math.max(1, sessionMinutes)) : 0;
  const weeksNeeded = sessionsNeeded > 0 ? Math.ceil(sessionsNeeded / Math.max(1, daysPerWeek)) : 0;
  const revisionPoints = REVISION_OFFSETS.map(d => ({ afterDays: d, label: `Revise ${d === 1 ? "the next day" : `${d} days after`} first studying a topic` }));
  const topics = dedupeTopics([...o.earlier, o.material]).filter(t => t.materialIds.includes(o.material.materialId));
  const summary = o.material.sections.length === 0
    ? "These notes have no sections to plan yet."
    : fresh === 0
      ? "Everything in these notes is a topic your plan already covers from your other notes."
      : `${fresh} ${fresh === 1 ? "section" : "sections"} to plan, about ${workloadMinutes} minutes in all: ${sessionsNeeded} ${sessionsNeeded === 1 ? "session" : "sessions"} of ${sessionMinutes} minutes${usingDefaults ? " (a starting suggestion: you can change it)" : ""}, about ${weeksNeeded} ${weeksNeeded === 1 ? "week" : "weeks"} at ${daysPerWeek} ${daysPerWeek === 1 ? "day" : "days"} a week.`;
  return {
    materialId: o.material.materialId, title: o.material.title, firstPlan: o.firstPlan, sequence, sectionCount: o.material.sections.length, newSections: fresh,
    workloadMinutes, sessions: { sessionMinutes, daysPerWeek, sessionsNeeded, weeksNeeded, usingDefaults }, revisionPoints, topics, summary,
  };
}

// ── what the learner decided ──
/** Pure. The latest decision per material from the proposal events. */
export function proposalDecisions(events: readonly PlanEvent[]): Map<string, ProposalDecision> {
  const out = new Map<string, ProposalDecision>();
  for (const [ref, e] of latestPerRef(events.filter(x => x.kind === "proposal"))) if (isProposalDecision(e.status)) out.set(ref, e.status);
  return out;
}
/** Pure. The material ids the learner accepted, oldest acceptance first (the order they feed the plan). */
export function acceptedMaterialIds(events: readonly PlanEvent[]): string[] {
  const latest = latestPerRef(events.filter(x => x.kind === "proposal"));
  return [...latest.values()].filter(e => e.status === "accepted").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.ref.localeCompare(b.ref)).map(e => e.ref);
}

/**
 * Pure. The unstarted sections that accepted materials add to the plan: for each accepted material (in the order given), its sections in
 * order that have no practice yet, a topic already planned from an earlier section or material counted ONCE (the later material is kept as a reference
 * on the earlier section). Sections the programme mapping already lists (`mapped`) come first and are not repeated.
 */
export function acceptedUnstarted(accepted: readonly MaterialIn[], mapped: readonly UnstartedSection[]): UnstartedSection[] {
  const out: UnstartedSection[] = mapped.map(m => ({ ...m }));
  const byChunk = new Set(out.map(m => m.chunkId));
  const byTopic = new Map<string, UnstartedSection>();
  for (const m of out) { const k = topicKey(m.label); if (k && !byTopic.has(k)) byTopic.set(k, m); }
  for (const mat of accepted) {
    mat.sections.slice().sort((a, b) => a.ordinal - b.ordinal || a.chunkId.localeCompare(b.chunkId)).forEach((s, i) => {
      if (s.started || byChunk.has(s.chunkId)) return;
      const label = sectionLabel(s, i);
      const k = topicKey(label);
      const prior = k ? byTopic.get(k) : undefined;
      if (prior) { prior.materialIds = [...new Set([...(prior.materialIds ?? []), mat.materialId])]; return; }
      const section: UnstartedSection = { chunkId: s.chunkId, label, competencyTitle: null, materialIds: [mat.materialId] };
      out.push(section); byChunk.add(s.chunkId);
      if (k) byTopic.set(k, section);
    });
  }
  return out;
}

/** Pure. The topics the learner postponed and that are still postponed on `today` (until is YYYY-MM-DD, exclusive of that day). */
export function postponedTopics(events: readonly PlanEvent[], today: string): Set<string> {
  const out = new Set<string>();
  for (const e of latestPerRef(events.filter(x => x.kind === "topic_postponed")).values()) {
    const until = typeof e.value.until === "string" ? e.value.until : null;
    if (until && until > today) { out.add(topicKey(e.ref)); const label = typeof e.value.label === "string" ? e.value.label : null; if (label) out.add(topicKey(label)); }
  }
  return out;
}
