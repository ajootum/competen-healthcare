// ── CLASSIFY, SHOWN IN CONTEXT ── PRODUCT-EXPERIENCE P6 Option A (owner, 2026-10-26) ──────────────────────
//
// Stage 3 Classify stays a background capability (docs/COMPETEN-SCHOLAR-PRODUCT-ARCHITECTURE.md): no Classify screen
// and no "My Knowledge & Competencies" view. What it found is shown where the student already is -- the material page
// (what Scholar found in this material, with its suggestions to accept or reject) and Progress (practice by topic and
// by competency). Pure: it summarises rows the store already reads, and decides nothing.
//
// ⚠ A SUGGESTION IS NOT A LINK. Proposed, accepted and rejected stay distinct; only an accepted link counts as
// practice of a competency (competency-progress.ts). A topic is what the notes are about, never a competency.

export type TopicSummary = { name: string; chunkIds: string[] };

/** Pure. The topics across sections, one per name (case aside), most frequent first, in the sections' order. */
export function topicsOf(concepts: ReadonlyMap<string, readonly string[]>, chunkOrder?: readonly string[]): TopicSummary[] {
  const order = chunkOrder ?? [...concepts.keys()];
  const byKey = new Map<string, TopicSummary>();
  for (const chunkId of order) {
    for (const raw of concepts.get(chunkId) ?? []) {
      const name = raw.replace(/\s+/g, " ").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const t = byKey.get(key) ?? { name, chunkIds: [] };
      if (!t.chunkIds.includes(chunkId)) t.chunkIds.push(chunkId);
      byKey.set(key, t);
    }
  }
  return [...byKey.values()].sort((a, b) => b.chunkIds.length - a.chunkIds.length || a.name.localeCompare(b.name));
}

export type MappingLike = {
  id: string; chunkId: string; competencyId: string; state: "proposed" | "accepted" | "rejected";
  title: string; code: string | null; layer: string; contentStatus?: string | null; outcome?: string | null;
};
export type FoundCompetency = {
  competencyId: string; title: string; code: string | null; layer: string; contentStatus: string | null; outcomes: string[];
  chunkIds: string[]; proposedIds: string[]; accepted: number; rejected: number;
  /** proposed: something waits for the student's decision; accepted / rejected: all decided one way; mixed: both. */
  state: "proposed" | "accepted" | "rejected" | "mixed";
};

const RANK: Record<FoundCompetency["state"], number> = { proposed: 0, mixed: 1, accepted: 2, rejected: 3 };

/** Pure. One row per competency across the material's sections: what waits for a decision first, rejected last. */
export function competenciesFound(mappings: readonly MappingLike[]): FoundCompetency[] {
  const by = new Map<string, FoundCompetency>();
  for (const m of mappings) {
    const f = by.get(m.competencyId) ?? {
      competencyId: m.competencyId, title: m.title, code: m.code, layer: m.layer, contentStatus: m.contentStatus ?? null, outcomes: [],
      chunkIds: [], proposedIds: [], accepted: 0, rejected: 0, state: "proposed" as const,
    };
    if (!f.chunkIds.includes(m.chunkId)) f.chunkIds.push(m.chunkId);
    if (m.outcome && !f.outcomes.includes(m.outcome)) f.outcomes.push(m.outcome);
    if (m.state === "proposed") f.proposedIds.push(m.id);
    else if (m.state === "accepted") f.accepted++;
    else f.rejected++;
    by.set(m.competencyId, f);
  }
  for (const f of by.values()) {
    f.state = f.proposedIds.length ? "proposed" : f.accepted && f.rejected ? "mixed" : f.accepted ? "accepted" : "rejected";
  }
  return [...by.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || b.chunkIds.length - a.chunkIds.length || a.title.localeCompare(b.title));
}

export type TopicPractice = { name: string; sections: number; questions: number; answered: number; rightLatest: number };

/**
 * Pure. Practice on the sections each topic was found in: questions written from those sections, how many were
 * answered, and how many were right on the latest try. A topic with no answered question is "not practised yet",
 * never 0%. Practice, not knowledge -- and never competence.
 */
export function topicPractice(
  concepts: ReadonlyMap<string, readonly string[]>,
  questions: readonly { id: string; chunkId: string }[],
  attempts: readonly { questionId: string; correct: boolean; answeredAt: string }[],
  limit = 12,
): TopicPractice[] {
  const latest = new Map<string, { correct: boolean; at: string }>();
  for (const a of attempts) {
    const l = latest.get(a.questionId);
    if (!l || a.answeredAt > l.at) latest.set(a.questionId, { correct: a.correct, at: a.answeredAt });
  }
  const byChunk = new Map<string, string[]>();
  for (const q of questions) byChunk.set(q.chunkId, [...(byChunk.get(q.chunkId) ?? []), q.id]);
  return topicsOf(concepts).map(t => {
    const qs = t.chunkIds.flatMap(c => byChunk.get(c) ?? []);
    const answered = qs.filter(id => latest.has(id));
    return { name: t.name, sections: t.chunkIds.length, questions: qs.length, answered: answered.length, rightLatest: answered.filter(id => latest.get(id)!.correct).length };
  }).sort((a, b) => b.answered - a.answered || b.sections - a.sections || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Why there are no competency suggestions, worded for where the student is. `offered`: programmes Competen offers
 * (null when unreadable). With none offered -- production today -- the student is not told to choose one: there is
 * nothing to choose, and topics are still found.
 */
export function noProgrammeText(offered: number | null): string {
  return offered === 0
    ? "Competen has not set up a programme or competency framework for Scholar yet, so your notes are not linked to competencies. Scholar still finds the topics in them, and you can study them either way."
    : "No programme is chosen, so your notes are not linked to competencies. Choose your programme in My Learning to see which competencies they support. You can study them either way.";
}

// ── SCHOLAR-UPLOAD-FIX: WHAT THE TOPICS LINE SAYS ── never "none" while topic finding is still running ──────────
//
// "No topics found" is a FINDING, and only true once every section was looked at. While sections are still waiting
// (with AI help on) the line says how far it has got. With AI help off and sections waiting, the surface keeps its own
// AI-off words ("off"). Progress that could not be read is said as such, never guessed.

export const TOPICS_NONE = "No topics found in these notes.";
export const TOPICS_UNREAD = "How far topic finding has got could not be read just now.";

export type TopicsState = { kind: "found" | "finding" | "none" | "off" | "unread"; text: string | null };

/** Pure. `analysed`/`sections` null: unreadable. `text` for "found" is the progress line while finding continues. */
export function topicsState(s: { consent: boolean; analysed: number | null; sections: number | null; topics: number }): TopicsState {
  const known = s.analysed !== null && s.sections !== null;
  const complete = known && s.analysed! >= s.sections!;
  const finding = known && !complete && s.consent ? `Finding topics… ${s.analysed} of ${s.sections} section${s.sections === 1 ? "" : "s"}` : null;
  if (s.topics > 0) return { kind: "found", text: finding };
  if (complete) return { kind: "none", text: TOPICS_NONE };
  if (!s.consent) return { kind: "off", text: null };
  return finding ? { kind: "finding", text: finding } : { kind: "unread", text: TOPICS_UNREAD };
}

// ── SCHOLAR-UPLOAD-FIX: RE-LINKING ANALYSED SECTIONS TO THE PROGRAMME NOW CHOSEN ──────────────────────────────────
//
// individual_scholar_chunk_analysis.programme_code records the programme each section was analysed against (null: none).
// When the learner now has a programme with a usable catalogue, the sections analysed against nothing or against another
// programme can be sent for competency mapping again. Sections never analysed are NOT here: the ordinary run maps them.

/** Pure. The analysed sections, in document order, whose recorded programme is not `programme`. */
export function relinkTargets(chunkOrder: readonly string[], analysedProgramme: ReadonlyMap<string, string | null>, programme: string | null): string[] {
  if (!programme) return [];
  return chunkOrder.filter(id => analysedProgramme.has(id) && analysedProgramme.get(id) !== programme);
}
