import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDecks, cardLinksOf, mergeGaps, osceGapTopics, recentOsceAttempts, selectCards, flashcardView,
  type CardRowExtras, type FlashcardView, type OsceGapAttempt, type PersonalDeck, type TopicGap,
} from "./flashcards";
import { copyPlan, groupByOrganise, mergePlan, needsRevisionOf, scheduleAfterRating, searchDecks, sortDecks, type CardSchedule } from "./flashcard-decks";
import { copyDeck, mergeDecks } from "./flashcard-service";
import { flashcardDecks, resetDeckArchiveSchema, setDeckArchived } from "./store";
import type { QuestionRow } from "./store";

// SCHOLAR-FLASHCARDS follow-up (owner GO, 1 Nov 2026): bookmarked selection, deck archive / copy / merge, deck discovery,
// card <-> lesson links, and OSCE gaps as gap focus. Pure rules first; then the store paths with a recording fake database,
// proving a copy or a merge writes only deck and deck-card rows (never a card, a schedule or a review).

const U = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "bbbbbbbb-0000-4000-8000-00000000000b";
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deckId = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-11-01";

const q = (n: number, over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: id(n), materialId: "m1", chunkId: `chunk${n}`, kind: "flashcard", stem: `What is thing ${n}?`, options: [], correctIndex: null, rationale: "", sourceQuote: "",
  model: "claude", promptVersion: "v", createdAt: "2026-10-20T10:00:00Z", answer: { back: `Thing ${n}` }, difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1,
  unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, library: null, ...over,
});
const x = (over: Partial<CardRowExtras> = {}): CardRowExtras => ({ card: null, history: [], topics: ["Renal"], competencyTitle: null, mark: null, deckIds: [], contentVersion: 1, updatedAt: null, ...over });
const view = (n: number, bookmarked = false): FlashcardView => flashcardView(q(n), x({ mark: bookmarked ? { bookmarked: true, note: null, issue: null } : null }), TODAY);
const deck = (n: number, title: string, cardIds: string[], over: Partial<PersonalDeck> = {}): PersonalDeck => ({
  id: deckId(n), title, organiseBy: "personal", organiseRef: null, createdAt: "2026-10-01", updatedAt: "2026-10-02", lastStudiedAt: null, cardIds, ...over,
});

describe("bookmarked cards: an entry in the deck list, and a selection", () => {
  const views = [view(1, true), view(2), view(3, true)];
  it("narrows a selection to the learner's own bookmarks", () => {
    const decks = buildDecks(views, []);
    expect(selectCards(views, decks, { bookmarked: true }).map(c => c.id)).toEqual([id(1), id(3)]);
    expect(selectCards(views, decks, { deckIds: ["all"], bookmarked: true }).map(c => c.id)).toEqual([id(1), id(3)]);
    expect(selectCards(views, decks, {}).map(c => c.id)).toEqual([id(1), id(2), id(3)]);
  });
  it("lists a Bookmarked entry even before anything is bookmarked, where marks exist", () => {
    const plain = [view(1), view(2)];
    expect(buildDecks(plain, []).some(d => d.key === "bookmarked")).toBe(false);
    const entry = buildDecks(plain, [], { alwaysBookmarked: true }).find(d => d.key === "bookmarked");
    expect(entry).toMatchObject({ kind: "bookmarked", total: 0 });
    expect(buildDecks(views, [], { alwaysBookmarked: true }).find(d => d.key === "bookmarked")?.cardIds).toEqual([id(1), id(3)]);
  });
});

describe("deck copy: same cards by reference, never a duplicated card", () => {
  it("names the copy, keeps the organisation and the card order, and fits 120 characters", () => {
    const p = copyPlan(deck(1, "Renal", [id(1), id(2)], { organiseBy: "topic", organiseRef: "Renal physiology" }), 500);
    expect(p).toEqual({ ok: true, title: "Renal (copy)", organiseBy: "topic", organiseRef: "Renal physiology", cardIds: [id(1), id(2)] });
    const long = copyPlan(deck(1, "x".repeat(120), []), 500);
    expect(long.ok && long.title.length).toBe(120);
    expect(long.ok && long.title.endsWith(" (copy)")).toBe(true);
  });
  it("refuses a deck bigger than the policy allows", () => {
    expect(copyPlan(deck(1, "Big", [id(1), id(2), id(3)]), 2)).toMatchObject({ ok: false });
  });
});

describe("deck merge: skip duplicates, then the other deck goes", () => {
  it("adds only the cards the target lacks", () => {
    const a = deck(1, "A", [id(1), id(2)]), b = deck(2, "B", [id(2), id(3)]);
    expect(mergePlan(a, b, 500)).toEqual({ ok: true, add: [id(3)], skipped: 1, total: 3 });
  });
  it("refuses merging a deck into itself, and a result over the limit", () => {
    const a = deck(1, "A", [id(1)]);
    expect(mergePlan(a, a, 500)).toMatchObject({ ok: false });
    expect(mergePlan(a, deck(2, "B", [id(2), id(3)]), 2)).toMatchObject({ ok: false });
  });
});

describe("deck discovery: search by title, sort, group by how a deck is organised", () => {
  const ds = [
    { title: "Renal system", due: 1, fresh: 0, lastStudiedAt: "2026-10-30T10:00:00Z", updatedAt: "2026-10-01", organiseBy: "topic" as const },
    { title: "Cardiac output", due: 5, fresh: 2, lastStudiedAt: null, updatedAt: "2026-10-31T10:00:00Z", organiseBy: "document" as const },
    { title: "Anatomy basics", due: 0, fresh: 0, lastStudiedAt: null, updatedAt: "2026-09-01", organiseBy: "personal" as const },
    { title: "Pharmacology", due: 0, fresh: 0, lastStudiedAt: null, updatedAt: "2026-09-02", organiseBy: "competency" as const },
  ];
  it("searches deck titles by every word, ignoring case", () => {
    expect(searchDecks(ds, "RENAL sys").map(d => d.title)).toEqual(["Renal system"]);
    expect(searchDecks(ds, "  ").length).toBe(4);
    expect(searchDecks(ds, "zzz")).toEqual([]);
  });
  it("sorts by recent, due and name without changing the input", () => {
    const before = ds.map(d => d.title);
    expect(sortDecks(ds, "name").map(d => d.title)).toEqual(["Anatomy basics", "Cardiac output", "Pharmacology", "Renal system"]);
    expect(sortDecks(ds, "due")[0].title).toBe("Cardiac output");
    expect(sortDecks(ds, "recent").map(d => d.title).slice(0, 2)).toEqual(["Cardiac output", "Renal system"]);
    expect(ds.map(d => d.title)).toEqual(before);
  });
  it("groups the learner's own decks by organise_by, empty groups left out", () => {
    expect(groupByOrganise(ds).map(g => [g.by, g.decks.length])).toEqual([["topic", 1], ["document", 1], ["competency", 1], ["personal", 1]]);
    expect(groupByOrganise(ds.slice(0, 1)).map(g => g.by)).toEqual(["topic"]);
  });
  it("carries archived and organisation onto the deck summary", () => {
    const d = buildDecks([view(1)], [deck(1, "Old", [id(1)], { archivedAt: "2026-10-31T00:00:00Z", organiseBy: "topic", organiseRef: "Renal" })]).find(s => s.key === `deck:${deckId(1)}`)!;
    expect(d).toMatchObject({ archived: true, organiseBy: "topic", updatedAt: "2026-10-02" });
    expect(buildDecks([view(1)], [deck(2, "New", [])]).find(s => s.kind === "personal")?.archived).toBe(false);
  });
});

describe("card to lesson and study-session links: exact only", () => {
  const lessons = [
    { sessionId: "s-old", title: "Renal basics", step: 1, lastActiveAt: "2026-10-01T00:00:00Z", chunkIds: ["chunk1"] },
    { sessionId: "s-new", title: "Renal revisited", step: 2, lastActiveAt: "2026-10-20T00:00:00Z", chunkIds: ["chunk1", "chunk9"] },
  ];
  it("names the lesson whose step holds the card's own section, newest session first", () => {
    const m = cardLinksOf([{ id: "k1", chunkId: "chunk1", deckIds: [] }, { id: "k2", chunkId: "chunk2", deckIds: [] }], lessons, new Map());
    expect(m.get("k1")).toEqual({ lesson: { sessionId: "s-new", title: "Renal revisited", step: 2 }, study: null });
    expect(m.has("k2")).toBe(false);
  });
  it("names a study session only through a deck that is linked to it", () => {
    const m = cardLinksOf([{ id: "k2", chunkId: "chunk2", deckIds: ["d1", "d2"] }], lessons, new Map([["d2", { sessionId: "st1", title: "Week 3" }]]));
    expect(m.get("k2")).toEqual({ lesson: null, study: { sessionId: "st1", title: "Week 3" } });
  });
});

describe("OSCE gaps as gap focus: mapped to the learner's own sections, or skipped and said", () => {
  const station = { title: "Sepsis recognition", topic: "Sepsis", materialId: "mat1", chunkId: null, competencyId: "comp1" };
  const attempt = (over: Partial<OsceGapAttempt> = {}): OsceGapAttempt => ({
    id: "a1", finishedAt: "2026-10-30T10:00:00Z", status: "finished", itemChunks: new Map([["i1", "chunkA"]]), station,
    gaps: [
      { itemId: "i1", text: "Check capillary refill", critical: true, mark: "missed" },
      { itemId: "i2", text: "Escalate using the early warning score", critical: false, mark: "partly" },
      { itemId: "i3", text: "Introduced self", critical: false, mark: "done" },
    ],
    revisionSuggestions: [{ label: "Learn: Check capillary refill", segment: "learn", query: { section: "chunkA", action: "teach" } }, { label: "Revise this material", segment: "revise", query: { material: "mat1" } }],
    ...over,
  });
  const comp = new Map([["comp1", [{ chunkId: "chunkZ", materialId: "other" }, { chunkId: "chunkB", materialId: "mat1" }]]]);

  it("uses the item's own section first, then the station's competency sections in its material", () => {
    const r = osceGapTopics([attempt()], comp);
    expect(r.skipped).toBe(0);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ label: "Sepsis", source: "osce", materialId: "mat1", missed: 2 });
    expect(r.gaps[0].chunkIds).toEqual(["chunkA", "chunkB"]);
    expect(r.gaps[0].keyPoints).toEqual(["Check capillary refill", "Escalate using the early warning score"]);
  });
  it("counts the same gap once whether it came from the gaps or from the suggestions", () => {
    expect(osceGapTopics([attempt()], comp).gaps[0].keyPoints.filter(k => /capillary/.test(k))).toHaveLength(1);
  });
  it("uses the station's own section when it has one", () => {
    const r = osceGapTopics([attempt({ itemChunks: new Map(), revisionSuggestions: [], station: { ...station, chunkId: "chunkS" } })], new Map());
    expect(r.gaps[0].chunkIds).toEqual(["chunkS"]);
  });
  it("skips a gap that maps to none of the learner's sections, and counts it", () => {
    const r = osceGapTopics([attempt({ itemChunks: new Map(), revisionSuggestions: [], station: { ...station, competencyId: null } })], new Map());
    expect(r.gaps).toEqual([]);
    expect(r.skipped).toBe(2);
    // a competency whose sections are all in other materials maps to nothing for a station that has a material
    expect(osceGapTopics([attempt({ itemChunks: new Map(), revisionSuggestions: [] })], new Map([["comp1", [{ chunkId: "chunkZ", materialId: "other" }]]])).skipped).toBe(2);
  });
  it("never passes on text that identifies a patient, and ignores 'done' items", () => {
    const r = osceGapTopics([attempt({ gaps: [{ itemId: "i1", text: "Ask Mr John Smith, NHS number 943 476 5919, about pain", mark: "missed" }, { itemId: "i3", text: "Fine", mark: "done" }], revisionSuggestions: [] })], comp);
    expect(r).toEqual({ gaps: [], skipped: 0 });
  });
  it("takes only finished runs of the last 90 days that recorded something, newest five", () => {
    const runs = Array.from({ length: 7 }, (_, i) => ({ status: "finished", finishedAt: `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00Z`, gaps: [{}], revisionSuggestions: null, n: i }));
    const picked = recentOsceAttempts([
      ...runs, { status: "in_progress", finishedAt: null, gaps: [{}], revisionSuggestions: null, n: 90 },
      { status: "finished", finishedAt: "2026-06-01T00:00:00Z", gaps: [{}], revisionSuggestions: null, n: 91 }, { status: "finished", finishedAt: "2026-10-30T00:00:00Z", gaps: [], revisionSuggestions: [], n: 92 },
    ], "2026-11-01T00:00:00Z");
    expect(picked.map(r => r.n)).toEqual([6, 5, 4, 3, 2]);
  });
  it("merges with question gaps by label, most missed first", () => {
    const fromQuestions: TopicGap[] = [{ label: "sepsis", chunkIds: ["c1"], materialId: "m", missed: 3, keyPoints: ["a"], misconceptions: ["x"] }, { label: "Renal", chunkIds: ["c2"], materialId: "m", missed: 1, keyPoints: [], misconceptions: [] }];
    const merged = mergeGaps(fromQuestions, osceGapTopics([attempt()], comp).gaps);
    expect(merged.map(g => [g.label, g.missed])).toEqual([["sepsis", 5], ["Renal", 1]]);
    expect(merged[0].chunkIds).toEqual(["c1", "chunkA", "chunkB"]);
  });
});

// ── the store paths, against a recording fake database ──

type Row = Record<string, unknown>;
function fakeDb(opts: { archiveColumn: boolean }) {
  const tables: Record<string, Row[]> = {
    individual_scholar_question: [{ id: id(1), user_id: U }, { id: id(2), user_id: U }, { id: id(3), user_id: U }],
    individual_scholar_card: [{ id: "card1", question_id: id(1), user_id: U, reviews: 4, ease_factor: 2.5 }],
    individual_scholar_review: [{ id: "rv1", card_id: "card1", user_id: U, quality: 4 }],
    individual_scholar_flashcard_deck: [
      { id: deckId(1), user_id: U, title: "A", organise_by: "topic", organise_ref: "Renal", created_at: "2026-10-01", updated_at: "2026-10-02", last_studied_at: null, ...(opts.archiveColumn ? { archived_at: null } : {}) },
      { id: deckId(2), user_id: U, title: "B", organise_by: "personal", organise_ref: null, created_at: "2026-10-01", updated_at: "2026-10-03", last_studied_at: null, ...(opts.archiveColumn ? { archived_at: null } : {}) },
      { id: deckId(9), user_id: OTHER, title: "Theirs", organise_by: "personal", organise_ref: null, created_at: "2026-10-01", updated_at: "2026-10-03", last_studied_at: null, ...(opts.archiveColumn ? { archived_at: null } : {}) },
    ],
    individual_scholar_flashcard_deck_card: [
      { deck_id: deckId(1), user_id: U, question_id: id(1), position: 1 }, { deck_id: deckId(1), user_id: U, question_id: id(2), position: 2 },
      { deck_id: deckId(2), user_id: U, question_id: id(2), position: 1 }, { deck_id: deckId(2), user_id: U, question_id: id(3), position: 2 },
    ],
  };
  const writes: { table: string; op: string }[] = [];
  let seq = 100;
  const from = (table: string) => {
    let op = "select", payload: Row[] | Row = [], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}, cols = "";
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    const b: Record<string, unknown> = {};
    const run = () => {
      const missing = opts.archiveColumn ? false : /archived_at/.test(cols) || (op === "update" && "archived_at" in (payload as Row));
      if (missing && table === "individual_scholar_flashcard_deck") return { data: null, error: { code: "42703", message: "column archived_at does not exist" } };
      const rows = tables[table] ?? [];
      const hit = rows.filter(r => filters.every(f => f(r)));
      if (op === "select") return { data: hit.slice(0, limit), error: null };
      writes.push({ table, op });
      if (op === "insert") { const made = (payload as Row[]).map(r => ({ id: deckId(++seq), ...r })); tables[table] = [...rows, ...made]; return { data: made, error: null }; }
      if (op === "upsert") {
        const keys = (options.onConflict ?? "").split(",");
        const fresh = (payload as Row[]).filter(r => !rows.some(e => keys.every(k => e[k] === r[k])));
        tables[table] = [...rows, ...fresh];
        return { data: fresh, error: null };
      }
      if (op === "update") { hit.forEach(r => Object.assign(r, payload)); return { data: hit, error: null }; }
      // delete (with the FK cascade a deck has)
      tables[table] = rows.filter(r => !hit.includes(r));
      if (table === "individual_scholar_flashcard_deck") {
        const gone = new Set(hit.map(r => r.id));
        const before = tables.individual_scholar_flashcard_deck_card.length;
        tables.individual_scholar_flashcard_deck_card = tables.individual_scholar_flashcard_deck_card.filter(r => !gone.has(r.deck_id));
        if (tables.individual_scholar_flashcard_deck_card.length !== before) writes.push({ table: "individual_scholar_flashcard_deck_card", op: "cascade" });
      }
      return { data: hit, error: null };
    };
    b.select = (c?: string) => { if (c) cols = c; return b; };
    b.order = () => b; b.limit = (n: number) => { limit = n; return b; };
    b.eq = (c: string, v: unknown) => { filters.push(r => r[c] === v); return b; };
    b.in = (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return b; };
    b.insert = (r: Row | Row[]) => { op = "insert"; payload = [r].flat(); return b; };
    b.upsert = (r: Row | Row[], o: typeof options) => { op = "upsert"; payload = [r].flat(); options = o; return b; };
    b.update = (r: Row) => { op = "update"; payload = r; return b; };
    b.delete = () => { op = "delete"; return b; };
    b.maybeSingle = () => Promise.resolve((() => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; })());
    b.single = b.maybeSingle;
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej);
    return b;
  };
  return { admin: { from }, tables, writes };
}
const members = (db: ReturnType<typeof fakeDb>, deck: string) => db.tables.individual_scholar_flashcard_deck_card.filter(r => r.deck_id === deck).map(r => r.question_id);
const LEARNING_TABLES = ["individual_scholar_question", "individual_scholar_card", "individual_scholar_review", "individual_scholar_flashcard_mark"];

describe("copy and merge write only deck and deck-card rows", () => {
  beforeEach(() => resetDeckArchiveSchema());

  it("a copy holds the same memberships under a new name, and touches no card, schedule or review", async () => {
    const db = fakeDb({ archiveColumn: true });
    const r = await copyDeck({ admin: db.admin, userId: U }, deckId(1), 500);
    expect(r).toMatchObject({ ok: true, title: "A (copy)", cards: 2 });
    if (!r.ok) return;
    expect(members(db, r.id)).toEqual([id(1), id(2)]);
    expect(members(db, deckId(1))).toEqual([id(1), id(2)]);
    expect(db.tables.individual_scholar_flashcard_deck.find(d => d.id === r.id)).toMatchObject({ title: "A (copy)", organise_by: "topic", organise_ref: "Renal", user_id: U });
    expect(db.writes.filter(w => LEARNING_TABLES.includes(w.table))).toEqual([]);
    expect(db.tables.individual_scholar_card).toHaveLength(1);
    expect(db.tables.individual_scholar_review).toHaveLength(1);
  });

  it("another learner's deck is not found, and nothing is written", async () => {
    const db = fakeDb({ archiveColumn: true });
    expect(await copyDeck({ admin: db.admin, userId: U }, deckId(9), 500)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await mergeDecks({ admin: db.admin, userId: U }, deckId(1), deckId(9), 500)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await mergeDecks({ admin: db.admin, userId: U }, deckId(9), deckId(1), 500)).toMatchObject({ ok: false, reason: "not_found" });
    expect(db.writes).toEqual([]);
  });

  it("a merge adds the missing cards once, removes the other deck, and touches no card, schedule or review", async () => {
    const db = fakeDb({ archiveColumn: true });
    const r = await mergeDecks({ admin: db.admin, userId: U }, deckId(1), deckId(2), 500);
    expect(r).toEqual({ ok: true, added: 1, skipped: 1, total: 3 });
    expect(members(db, deckId(1))).toEqual([id(1), id(2), id(3)]);
    expect(db.tables.individual_scholar_flashcard_deck.some(d => d.id === deckId(2))).toBe(false);
    expect(members(db, deckId(2))).toEqual([]);
    expect(db.writes.filter(w => LEARNING_TABLES.includes(w.table))).toEqual([]);
    expect(db.tables.individual_scholar_question).toHaveLength(3);
    expect(db.tables.individual_scholar_card).toHaveLength(1);
    expect(db.tables.individual_scholar_review).toHaveLength(1);
  });

  it("a merge over the limit changes nothing", async () => {
    const db = fakeDb({ archiveColumn: true });
    expect(await mergeDecks({ admin: db.admin, userId: U }, deckId(1), deckId(2), 2)).toMatchObject({ ok: false, reason: "invalid" });
    expect(db.writes).toEqual([]);
    expect(members(db, deckId(2))).toEqual([id(2), id(3)]);
  });
});

describe("archive fails closed while migration 820 is absent", () => {
  beforeEach(() => resetDeckArchiveSchema());

  it("without archived_at: decks still read (not archived), and archiving is unavailable with nothing written", async () => {
    const db = fakeDb({ archiveColumn: false });
    const decks = await flashcardDecks(db.admin, U);
    expect(decks.map(d => d.title)).toEqual(["A", "B"]);
    expect(decks.every(d => d.archivedAt === null)).toBe(true);
    expect(await setDeckArchived(db.admin, U, deckId(1), true)).toBe("unavailable");
    expect(db.writes).toEqual([]);
  });

  it("with archived_at: archives and unarchives only the deck's own flag, for the owner only", async () => {
    const db = fakeDb({ archiveColumn: true });
    expect(await setDeckArchived(db.admin, U, deckId(1), true)).toBe("ok");
    expect((await flashcardDecks(db.admin, U)).find(d => d.id === deckId(1))?.archivedAt).toBeTruthy();
    expect(members(db, deckId(1))).toEqual([id(1), id(2)]);
    expect(await setDeckArchived(db.admin, U, deckId(1), false)).toBe("ok");
    expect((await flashcardDecks(db.admin, U)).find(d => d.id === deckId(1))?.archivedAt).toBeNull();
    expect(await setDeckArchived(db.admin, U, deckId(9), true)).toBe("not_found");
    expect(db.tables.individual_scholar_flashcard_deck.find(d => d.id === deckId(9))?.archived_at).toBeNull();
    expect(db.writes.filter(w => LEARNING_TABLES.includes(w.table))).toEqual([]);
  });
});

describe("Needs revision: read from the card's schedule row on every path", () => {
  const T = "2026-11-01";
  const row = (over: Partial<CardSchedule> = {}): CardSchedule => ({ lastQuality: 4, nextReviewAt: "2026-11-06", status: "active", reviews: 2, ...over });
  it("a last rating of Didn't remember (quality 1) shows it, even with the next review tomorrow", () => {
    expect(needsRevisionOf(row({ lastQuality: 1, nextReviewAt: "2026-11-02" }), T)).toBe(true);
    expect(needsRevisionOf(row({ lastQuality: 2 }), T)).toBe(true);
  });
  it("due or overdue shows it; remembered and not yet due does not", () => {
    expect(needsRevisionOf(row({ nextReviewAt: T }), T)).toBe(true);
    expect(needsRevisionOf(row({ nextReviewAt: "2026-10-20" }), T)).toBe(true);
    expect(needsRevisionOf(row(), T)).toBe(false);
    expect(needsRevisionOf(row({ lastQuality: 3 }), T)).toBe(false);
  });
  it("a card never reviewed, or with no schedule row, is not one to revise; a mastered card is not due", () => {
    expect(needsRevisionOf(row({ reviews: 0, lastQuality: null, nextReviewAt: T }), T)).toBe(false);
    expect(needsRevisionOf(null, T)).toBe(false);
    expect(needsRevisionOf(undefined, T)).toBe(false);
    expect(needsRevisionOf(row({ status: "mastered", nextReviewAt: "2026-10-01" }), T)).toBe(false);
  });
  it("updates straight after a rating: Didn't remember turns it on, Remembered turns it off unless still due", () => {
    const fresh = row({ lastQuality: null, nextReviewAt: T, reviews: 0 });
    const again = scheduleAfterRating(fresh, "again", "2026-11-02");
    expect(again).toMatchObject({ lastQuality: 1, nextReviewAt: "2026-11-02", reviews: 1 });
    expect(needsRevisionOf(again, T)).toBe(true);
    const ok = scheduleAfterRating(again, "remembered", "2026-11-02");
    expect(ok.lastQuality).toBe(4);
    expect(needsRevisionOf(ok, T)).toBe(false);
    expect(needsRevisionOf(scheduleAfterRating(again, "remembered", T), T)).toBe(true);
    expect(needsRevisionOf(scheduleAfterRating(null, "again", null), T)).toBe(true);
  });
});
