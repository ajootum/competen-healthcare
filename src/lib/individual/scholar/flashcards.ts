// ── SCHOLAR FLASHCARDS: THE RULES ── SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026) ──────────────────────────────────────
//
// Pure: no I/O and no clock of its own. The store reads and writes the rows (372, 391, 416, 710, 730); the routes and
// pages put them together; flashcard-service.ts is the server loader the exports build on.
//
// ⚠ REUSE, NOT A SECOND ENGINE. A flashcard IS an individual_scholar_question of kind flashcard (416). Its schedule IS
// the 372 card on the shared SM-2 (revision.ts scheduleReview over src/lib/delivery/reinforcement.ts), its history IS
// the 391 review log, a study run IS a 417 revision session in mode flashcards. Nothing here schedules anything: the two
// recall buttons are two SM-2 qualities, sent through the same answer route as every revision answer.
// ⚠ THREE ORIGINS, EACH SAID. "notes": written by AI from the learner's notes, grounded, quote kept. "library": a
// governed, clinically approved Competen library question (710) whose stem stands alone as a recall prompt, its back
// the approved answer exactly. "learner": written by hand, no AI, never presented as clinically reviewed (730 binds it).
// ⚠ FORMATIVE AND PRIVATE. Nothing here is assessment, mastery or verified competence, and nothing is published.

import type { QuestionRow } from "./store";
import { findPatientIdentifiers } from "./extract";
import { LEARNER_CARD, LEARNER_CARD_LABEL, LIBRARY_QUESTION_LABEL } from "./config";
import { flashcardFrontAsks, rubricOf, stemKey, type CognitiveLevel } from "./question-intel";
import { scheduleReview, type SrsParams } from "./revision";
import { citationOf } from "./revision-view";

// ── A CARD THE LEARNER WRITES (730) ──

export { LEARNER_CARD };
export const isLearnerCard = (q: { model: string }) => q.model === LEARNER_CARD.model;

export const PERSONAL_FRONT_MAX = 300;
export const PERSONAL_BACK_MAX = 600;
export const PERSONAL_NOTE_MAX = 1000;

export type PersonalCardProblem = "front" | "back" | "not_a_prompt" | "identifier" | "duplicate";
export const PERSONAL_CARD_MESSAGE: Record<PersonalCardProblem, string> = {
  front: `Write the front in 3 to ${PERSONAL_FRONT_MAX} characters.`,
  back: `Write the back in 1 to ${PERSONAL_BACK_MAX} characters.`,
  not_a_prompt: "Write the front as a question, or a short term to recall, not a sentence copied from your notes.",
  identifier: "That looks like it identifies a patient. Remove it and try again.",
  duplicate: "You already have a card with that front.",
};

/**
 * Pure. A hand-written card checked before it is stored: a front of 3 to 300 characters that asks (a question, or a
 * short term), a back of 1 to 600, nothing that identifies a patient in either, and not a repeat of a card the learner
 * already has (`existing`: stemKey of their other fronts).
 */
export function checkPersonalCard(raw: unknown, existing: ReadonlySet<string>): { ok: true; front: string; back: string } | { ok: false; reason: PersonalCardProblem; message: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const front = typeof r.front === "string" ? r.front.replace(/\s+/g, " ").trim() : "";
  const back = typeof r.back === "string" ? r.back.trim() : "";
  const no = (reason: PersonalCardProblem) => ({ ok: false as const, reason, message: PERSONAL_CARD_MESSAGE[reason] });
  if (front.length < 3 || front.length > PERSONAL_FRONT_MAX) return no("front");
  if (!back || back.length > PERSONAL_BACK_MAX) return no("back");
  if (findPatientIdentifiers(`${front}\n${back}`).length) return no("identifier");
  if (!flashcardFrontAsks(front)) return no("not_a_prompt");
  if (existing.has(stemKey(front))) return no("duplicate");
  return { ok: true, front, back };
}

/** Pure. A private note on a card: trimmed, at most 1000 characters, no patient identifier. null clears it. */
export function checkCardNote(raw: unknown): { ok: true; note: string | null } | { ok: false; message: string } {
  if (raw === null || raw === "") return { ok: true, note: null };
  if (typeof raw !== "string") return { ok: false, message: "That note could not be read." };
  const note = raw.trim();
  if (!note) return { ok: true, note: null };
  if (note.length > PERSONAL_NOTE_MAX) return { ok: false, message: `Keep the note to ${PERSONAL_NOTE_MAX} characters.` };
  if (findPatientIdentifiers(note).length) return { ok: false, message: PERSONAL_CARD_MESSAGE.identifier };
  return { ok: true, note };
}

// ── A GENERATED CARD: ONE CONCEPT, A RECALL PROMPT (question-intel.ts, applied in revision.ts checkRevisionDraft) ──
export { CARD_BACK_ONE_CONCEPT, flashcardDraftProblem } from "./question-intel";
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// ── THE TWO RECALL BUTTONS, ON THE EXISTING SM-2 ──
//
// SM-2 grades recall 0 to 5 (src/lib/delivery/reinforcement.ts). Below 3 is a lapse: repetitions restart and the card
// comes back tomorrow. 3 and above is a recall: the interval goes 1 day, then 6, then grows by the ease factor.
//   "Didn't remember / Review sooner"  = quality 1  (a lapse: tomorrow, ease down 0.54)
//   "Remembered / Review later"        = quality 4  (a recall: 1, 6, then x ease, ease unchanged)
// The policy bounds of REVISION-01 R3 (harder interval share, longest interval, mastery) apply as to every review.

export const RECALL = {
  again: { quality: 1, label: "Didn't remember", sub: "Review sooner", key: "1" },
  remembered: { quality: 4, label: "Remembered", sub: "Review later", key: "2" },
} as const;
export type RecallChoice = keyof typeof RECALL;
/** Pure. What a stored grade reads as: recalled at 3 or above (the line the insights already use), else not. */
export const recallOf = (quality: number): RecallChoice => (quality >= 3 ? "remembered" : "again");
/** Pure. The schedule one button gives, through the SAME scheduler every review uses. Never a second scheduler. */
export const scheduleRecall = (prev: { ease: number; interval: number; reps: number }, choice: RecallChoice, difficulty: number | null, p: SrsParams) =>
  scheduleReview(prev, RECALL[choice].quality, difficulty, p);

// ── A GOVERNED LIBRARY QUESTION USED AS A CARD (library first) ──
//
// The governed library (442 revision_question, copied under 710) holds four-option questions only, and 710 binds a copy
// to kind mcq and its exact content: there is no governed flashcard kind. A library question whose stem asks on its
// own (a question that does not lean on its options) is offered as a recall card: front its stem, back its approved
// answer exactly. The stored copy is unchanged. One that leans on its options ("which of the following") is not.
const LEANS_ON_OPTIONS = /\b(following|above|below|these|options?|statements?|true|false|except|not|least|correct answer|best answer)\b/i;
export const libraryRecallFits = (stem: string) => /\?\s*$/.test(stem.trim()) && flashcardFrontAsks(stem) && !LEANS_ON_OPTIONS.test(stem);

/**
 * Pure. The card a stored question is, or null: a flashcard is itself, a governed library question that stands alone
 * as a recall prompt is that prompt with its approved answer as the back, and anything else is not a card.
 */
export function recallCardOf(q: QuestionRow): QuestionRow | null {
  if (q.kind === "flashcard") return q;
  if (q.kind === "mcq" && q.library && q.correctIndex !== null && q.options[q.correctIndex] && libraryRecallFits(q.stem))
    return { ...q, kind: "flashcard", options: [], correctIndex: null, answer: { back: q.options[q.correctIndex] } };
  return null;
}

// ── WHAT A CARD IS, AS EVERY SURFACE (AND THE EXPORTS) READ IT ──

export type CardOrigin = "notes" | "library" | "learner";
export const ORIGIN_LABEL: Record<CardOrigin, string> = {
  notes: "From your notes · AI-written, not clinically reviewed",
  library: LIBRARY_QUESTION_LABEL,
  learner: LEARNER_CARD_LABEL,
};
export const originOf = (q: QuestionRow): CardOrigin => (q.library ? "library" : isLearnerCard(q) ? "learner" : "notes");

/**
 * SCHOLAR-FLASHCARDS-QA-01: what identifies a cited work, and how to reach it -- every field only where the record it
 * comes from holds it (442 library version, the governed reference catalogue, a research record). Never invented: a
 * field the record does not hold is absent, and the downloads print only what is present.
 */
export type CitationMeta = {
  title: string;
  /** What it is: a Competen library item, a governed competency framework reference, or an external work. */
  kind: "library" | "framework" | "external";
  publisher?: string | null; year?: string | null; version?: string | null; code?: string | null;
  doi?: string | null; pmid?: string | null; url?: string | null;
  /** Licence, or access such as "abstract only", where the record says. */
  licence?: string | null; access?: string | null;
  /** Its review standing as it is NOW (e.g. "Clinically approved"), and the date of that standing where recorded. */
  status?: string | null; reviewedAt?: string | null;
};

/** One source a card rests on. notes: the section of the learner's notes, with its quote. library: the governed version. external: one approved reference. */
export type CardSource = {
  origin: "notes" | "library" | "external"; label: string; citation: string; quote: string | null;
  materialId: string | null; chunkId: string | null; libraryVersionId: string | null; referenceIds: string[];
  /** Library and external: the cited work's metadata, where recorded. Notes are cited by document and section. */
  reference?: CitationMeta | null;
};

/** Pure. A cited work in one line: title, code, publisher, version, year, identifiers, licence, standing -- what is recorded. */
export function citationText(m: CitationMeta): string {
  const ids = [m.doi ? `doi:${m.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : null, m.pmid ? `PMID ${m.pmid}` : null, m.url].filter(Boolean);
  return [
    `${m.title}${m.code ? ` (${m.code})` : ""}`, m.publisher, m.version ? `version ${m.version}` : null, m.year,
    ids.length ? ids.join(", ") : null, m.licence, m.access, m.status ? `${m.status}${m.reviewedAt ? ` ${m.reviewedAt.slice(0, 10)}` : ""}` : null,
  ].filter(Boolean).join(". ");
}
export type ReviewState = "new" | "due" | "needs_practice" | "remembered";
export const REVIEW_STATE_LABEL: Record<ReviewState, string> = { new: "Not studied yet", due: "Due today", needs_practice: "Needs more practice", remembered: "Remembered" };
export type CardReview = {
  state: ReviewState; nextReviewAt: string | null; lastReviewedAt: string | null; reviews: number;
  intervalDays: number | null; ease: number | null; status: "active" | "mastered" | null;
  /** Newest first, from the 391 review log. */
  history: { quality: number; recall: RecallChoice; at: string; intervalDays: number | null }[];
};
export type FlashcardView = {
  id: string; front: string; back: string; explanation: string | null;
  origin: CardOrigin; originLabel: string; topic: string | null; objective: string | null; keyPoints: string[];
  /** The rubric's cognitive level where one is stored. application and reasoning cards are the revision guide's Clinical Application. */
  level: CognitiveLevel | null;
  difficulty: 1 | 2 | 3 | null; competency: { id: string; title: string } | null; sources: CardSource[];
  createdAt: string; updatedAt: string | null; contentVersion: number; version: string;
  material: { id: string; title: string }; chunkId: string;
  review: CardReview; bookmarked: boolean; note: string | null; issue: string | null; deckIds: string[]; editable: boolean;
};

export type CardRowExtras = {
  card: { id: string; nextReviewAt: string; lastReviewedAt: string | null; lastQuality: number | null; reviews: number; intervalDays: number; ease: number; status: "active" | "mastered" } | null;
  history: { quality: number; at: string; intervalDays: number | null }[];
  topics: string[]; competencyTitle: string | null;
  mark: { bookmarked: boolean; note: string | null; issue: string | null } | null;
  deckIds: string[]; contentVersion: number; updatedAt: string | null;
  /** SCHOLAR-FLASHCARDS-QA-01: the governed references a card's rubric cites, by id, as the catalogue holds them now. */
  references?: ReadonlyMap<string, CitationMeta>;
};

/** Pure. Where a card stands: new (never reviewed), due, needing more practice (last not remembered), or remembered. */
export function reviewStateOf(card: CardRowExtras["card"], today: string): ReviewState {
  if (!card || card.reviews === 0) return "new";
  if (card.status === "active" && card.nextReviewAt <= today) return "due";
  return card.lastQuality !== null && card.lastQuality < 3 ? "needs_practice" : "remembered";
}

/** Pure. One stored card (already a recall card: recallCardOf) as every surface and the exports read it. */
export function flashcardView(q: QuestionRow, x: CardRowExtras, today: string): FlashcardView {
  const origin = originOf(q);
  const rubric = rubricOf(q.answer);
  const back = String(((q.answer ?? {}) as Record<string, unknown>).back ?? "");
  const sources: CardSource[] = [];
  if (origin === "library" && q.library) {
    const l = q.library;
    // SCHOLAR-FLASHCARDS-QA-01: the item and its version as 442 records them; the date is the version's publication,
    // which 442 allows only after clinical approval of that exact content.
    const reference: CitationMeta = {
      title: l.title ?? "Competen library question", kind: "library", publisher: "Competen library", version: String(l.versionNo), code: l.code ?? null,
      status: "Clinically approved, published", reviewedAt: l.publishedAt ?? null,
    };
    sources.push({ origin: "library", label: LIBRARY_QUESTION_LABEL, citation: l.title ? `${l.title}, ${citationOf(q)}` : citationOf(q), quote: null, materialId: null, chunkId: null, libraryVersionId: l.versionId, referenceIds: [], reference });
  }
  if (origin === "notes") {
    sources.push({ origin: "notes", label: "Your uploaded notes", citation: citationOf(q), quote: q.sourceQuote || null, materialId: q.materialId, chunkId: q.chunkId, libraryVersionId: null, referenceIds: [] });
    // One source per approved reference the rubric cites, with what the catalogue records of it now. One the catalogue
    // no longer holds is said so, never given a title it does not have.
    if (rubric?.source === "references")
      for (const id of rubric.referenceIds) {
        const reference = x.references?.get(id) ?? null;
        sources.push({
          origin: "external", label: "Approved references", citation: reference ? citationText(reference) : "An approved reference linked to your notes (its record is not available now)",
          quote: null, materialId: null, chunkId: null, libraryVersionId: null, referenceIds: [id], reference,
        });
      }
  }
  const explanation = q.rationale && q.rationale.trim() && q.rationale.trim() !== back.trim() ? q.rationale.trim() : null;
  return {
    id: q.id, front: q.stem, back, explanation, origin, originLabel: ORIGIN_LABEL[origin],
    // The section's topic (the learner's correction, else the topic finding), else the topic the card was written with
    // (SCHOLAR-FLASHCARDS-QA-01), else none -- the downloads then file it under its document.
    topic: x.topics[0] ?? rubric?.topic ?? null, objective: rubric?.objective ?? null, keyPoints: rubric?.keyPoints ?? [], level: rubric?.level ?? null,
    difficulty: q.difficulty === 1 || q.difficulty === 2 || q.difficulty === 3 ? q.difficulty : null,
    competency: q.competencyId ? { id: q.competencyId, title: x.competencyTitle ?? "A linked competency" } : null,
    sources, createdAt: q.createdAt, updatedAt: x.updatedAt, contentVersion: x.contentVersion,
    version: origin === "library" ? `Competen library version ${q.library!.versionNo}` : origin === "learner" ? `Your card, version ${x.contentVersion}` : q.promptVersion,
    material: { id: q.materialId, title: q.materialTitle }, chunkId: q.chunkId,
    review: {
      state: reviewStateOf(x.card, today), nextReviewAt: x.card?.nextReviewAt ?? null, lastReviewedAt: x.card?.lastReviewedAt ?? null, reviews: x.card?.reviews ?? 0,
      intervalDays: x.card ? x.card.intervalDays : null, ease: x.card ? x.card.ease : null, status: x.card?.status ?? null,
      history: x.history.map(h => ({ ...h, recall: recallOf(h.quality) })),
    },
    bookmarked: x.mark?.bookmarked ?? false, note: x.mark?.note ?? null, issue: x.mark?.issue ?? null, deckIds: x.deckIds,
    editable: origin === "learner",
  };
}

// ── DECKS: the learner's own (730), and the ones their cards already make ──

export type PersonalDeck = {
  id: string; title: string; organiseBy: "personal" | "module" | "topic" | "document" | "competency"; organiseRef: string | null;
  createdAt: string; updatedAt: string; lastStudiedAt: string | null; cardIds: string[];
};
export const DECK_ORGANISE = ["personal", "module", "topic", "document", "competency"] as const;
export type DeckKind = "all" | "personal" | "document" | "topic" | "competency" | "bookmarked";
export type DeckSummary = {
  key: string; kind: DeckKind; id: string | null; title: string; subtitle: string | null; cardIds: string[];
  total: number; due: number; fresh: number; needsPractice: number; remembered: number; lastStudiedAt: string | null;
};

const latest = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;

/** Pure. A deck's counts from its cards: due and new are what a study run would offer first. */
function summarise(key: string, kind: DeckKind, id: string | null, title: string, subtitle: string | null, cards: FlashcardView[], studied: string | null = null): DeckSummary {
  const n = (s: ReviewState) => cards.filter(c => c.review.state === s).length;
  return {
    key, kind, id, title, subtitle, cardIds: cards.map(c => c.id), total: cards.length, due: n("due"), fresh: n("new"), needsPractice: n("needs_practice"), remembered: n("remembered"),
    lastStudiedAt: latest([studied, ...cards.map(c => c.review.lastReviewedAt)]),
  };
}

/**
 * Pure. Every deck: all cards (key "all"), the learner's own named decks (in their order of cards), then the decks their
 * cards already make by document, topic and competency, then their bookmarks. A card is in each deck it belongs to:
 * decks reference cards.
 */
export function buildDecks(cards: readonly FlashcardView[], personal: readonly PersonalDeck[]): DeckSummary[] {
  const byId = new Map(cards.map(c => [c.id, c]));
  const out: DeckSummary[] = [summarise("all", "all", null, "All cards", null, [...cards])];
  out.push(...personal.map(d => summarise(`deck:${d.id}`, "personal", d.id, d.title,
    d.organiseBy === "personal" ? null : `${d.organiseBy[0].toUpperCase()}${d.organiseBy.slice(1)}: ${d.organiseRef ?? ""}`,
    d.cardIds.map(id => byId.get(id)).filter((c): c is FlashcardView => !!c), d.lastStudiedAt)));
  const group = (keyOf: (c: FlashcardView) => string | null, titleOf: (c: FlashcardView) => string, kind: DeckKind, prefix: string, subtitle: string) => {
    const by = new Map<string, FlashcardView[]>();
    for (const c of cards) { const k = keyOf(c); if (k) by.set(k, [...(by.get(k) ?? []), c]); }
    return [...by].map(([k, cs]) => summarise(`${prefix}:${k}`, kind, null, titleOf(cs[0]), subtitle, cs)).sort((a, b) => a.title.localeCompare(b.title));
  };
  out.push(...group(c => c.material.id, c => c.material.title, "document", "doc", "Document"));
  out.push(...group(c => c.topic, c => c.topic!, "topic", "topic", "Topic"));
  out.push(...group(c => c.competency?.id ?? null, c => c.competency!.title, "competency", "comp", "Competency"));
  const marked = cards.filter(c => c.bookmarked);
  if (marked.length) out.push(summarise("bookmarked", "bookmarked", null, "Bookmarked cards", null, marked));
  return out;
}

/** Pure. The cards of the decks named (a 730 deck id, or a deck key from buildDecks), in deck order, each once. */
export function cardsOfDecks(decks: readonly DeckSummary[], ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const d = decks.find(x => x.key === id || (x.id !== null && x.id === id));
    for (const c of d?.cardIds ?? []) if (!out.includes(c)) out.push(c);
  }
  return out;
}

// ── SEARCH, FILTER, AND A SELECTION (for study and for export) ──

export type CardFilter = { q?: string | null; state?: ReviewState | "all" | null; bookmarked?: boolean; origin?: CardOrigin | null; deck?: string | null };

/** Pure. Cards matching a search (front, back, topic, document, note) and the filters chosen. */
export function filterCards(cards: readonly FlashcardView[], decks: readonly DeckSummary[], f: CardFilter): FlashcardView[] {
  const words = flat(f.q ?? "").split(" ").filter(Boolean);
  const inDeck = f.deck ? new Set(cardsOfDecks(decks, [f.deck])) : null;
  return cards.filter(c => (!inDeck || inDeck.has(c.id)) && (!f.state || f.state === "all" || c.review.state === f.state) && (!f.bookmarked || c.bookmarked)
    && (!f.origin || c.origin === f.origin)
    && (!words.length || words.every(w => flat([c.front, c.back, c.topic ?? "", c.material.title, c.note ?? "", c.competency?.title ?? ""].join(" ")).includes(w))));
}

export type CardSelection = { deckIds?: readonly string[]; cardIds?: readonly string[]; topic?: string | null; competencyId?: string | null; materialId?: string | null };

/**
 * Pure. The learner's own cards a selection names: the cards of the decks named, and the cards named, in that order;
 * then narrowed by topic, competency and document where given. Naming no deck and no card selects every card, narrowed
 * the same way. A card id that is not one of the learner's own is simply not there.
 */
export function selectCards(cards: readonly FlashcardView[], decks: readonly DeckSummary[], sel: CardSelection): FlashcardView[] {
  const byId = new Map(cards.map(c => [c.id, c]));
  const named = [...cardsOfDecks(decks, sel.deckIds ?? []), ...(sel.cardIds ?? [])];
  const base = named.length || (sel.deckIds?.length ?? 0) || (sel.cardIds?.length ?? 0)
    ? [...new Set(named)].map(id => byId.get(id)).filter((c): c is FlashcardView => !!c) : [...cards];
  const topic = sel.topic ? flat(sel.topic) : null;
  return base.filter(c => (!topic || flat(c.topic ?? "") === topic) && (!sel.competencyId || c.competency?.id === sel.competencyId) && (!sel.materialId || c.material.id === sel.materialId));
}

/** Pure. The spaced-repetition views: due today, needing practice, remembered, new, and the next review coming. */
export function spacedViews(cards: readonly FlashcardView[], today: string) {
  const by = (s: ReviewState) => cards.filter(c => c.review.state === s);
  const upcoming = cards.filter(c => c.review.nextReviewAt && c.review.nextReviewAt > today && c.review.status === "active")
    .sort((a, b) => a.review.nextReviewAt!.localeCompare(b.review.nextReviewAt!));
  const history = cards.flatMap(c => c.review.history.map(h => ({ cardId: c.id, front: c.front, ...h }))).sort((a, b) => b.at.localeCompare(a.at));
  return { due: by("due"), needsPractice: by("needs_practice"), remembered: by("remembered"), fresh: by("new"), nextReview: upcoming[0]?.review.nextReviewAt ?? null, upcoming: upcoming.slice(0, 10), history: history.slice(0, 30) };
}

// ── LEARNING GAPS: what was missed, and what to make cards on ──

export type TopicGap = { label: string; chunkIds: string[]; materialId: string; missed: number; keyPoints: string[]; misconceptions: string[] };

/**
 * Pure. Topic-level gaps from the learner's own answers and recall ratings: every question or card answered wrongly
 * (or rated "Didn't remember") at least once, grouped by its section's topic (else its document), most missed first,
 * with the key points and misconceptions its rubric records (else its prompt, as the thing to recall).
 */
export function topicGaps(items: readonly { q: QuestionRow; misses: number }[], topics: ReadonlyMap<string, readonly string[]>, limit = 6): TopicGap[] {
  const by = new Map<string, TopicGap>();
  for (const { q, misses } of items) {
    if (misses <= 0) continue;
    const label = topics.get(q.chunkId)?.[0] ?? q.materialTitle;
    const g = by.get(label) ?? { label, chunkIds: [], materialId: q.materialId, missed: 0, keyPoints: [], misconceptions: [] };
    g.missed += misses;
    if (!g.chunkIds.includes(q.chunkId)) g.chunkIds.push(q.chunkId);
    const r = rubricOf(q.answer);
    g.keyPoints = [...new Set([...g.keyPoints, ...(r?.keyPoints.length ? r.keyPoints : [q.stem])])].slice(0, 6);
    g.misconceptions = [...new Set([...g.misconceptions, ...(r?.misconceptions ?? [])])].slice(0, 4);
    by.set(label, g);
  }
  return [...by.values()].sort((a, b) => b.missed - a.missed || a.label.localeCompare(b.label)).slice(0, limit);
}

/** Pure. Where to write cards for the gaps, and what each section's cards should focus on (generation CONCEPTS). */
export function gapFocus(gaps: readonly TopicGap[], maxSections = 6): { chunkIds: string[]; concepts: Map<string, string[]> } {
  const concepts = new Map<string, string[]>();
  for (const g of gaps) for (const c of g.chunkIds) concepts.set(c, [...new Set([...(concepts.get(c) ?? []), ...g.keyPoints, ...g.misconceptions.map(m => `correct the misconception: ${m}`)])].slice(0, 8));
  return { chunkIds: [...concepts.keys()].slice(0, maxSections), concepts };
}

/**
 * Pure. A deck's name and how it is organised, from a request: a title of 1 to 120 characters (required when making
 * one), organised by personal, module, topic, document or competency, with what it is organised by (1 to 200
 * characters) unless personal. Nothing may identify a patient.
 */
export function parseDeckFields(raw: unknown, requireTitle: boolean):
  { ok: true; title?: string; organiseBy?: PersonalDeck["organiseBy"]; organiseRef?: string | null } | { ok: false; message: string; identifier?: boolean } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: { ok: true; title?: string; organiseBy?: PersonalDeck["organiseBy"]; organiseRef?: string | null } = { ok: true };
  if (r.title !== undefined || requireTitle) {
    const title = typeof r.title === "string" ? r.title.replace(/\s+/g, " ").trim() : "";
    if (title.length < 1 || title.length > 120) return { ok: false, message: "Name the deck in up to 120 characters." };
    out.title = title;
  }
  if (r.organiseBy !== undefined) {
    if (!(DECK_ORGANISE as readonly unknown[]).includes(r.organiseBy)) return { ok: false, message: "Choose how the deck is organised." };
    out.organiseBy = r.organiseBy as PersonalDeck["organiseBy"];
    const ref = typeof r.organiseRef === "string" ? r.organiseRef.replace(/\s+/g, " ").trim() : "";
    if (out.organiseBy !== "personal" && (ref.length < 1 || ref.length > 200)) return { ok: false, message: `Say which ${out.organiseBy} the deck is for, in up to 200 characters.` };
    out.organiseRef = out.organiseBy === "personal" ? null : ref;
  }
  if (findPatientIdentifiers(`${out.title ?? ""}\n${out.organiseRef ?? ""}`).length) return { ok: false, message: "That looks like it identifies a patient. Choose another name.", identifier: true };
  return out;
}
