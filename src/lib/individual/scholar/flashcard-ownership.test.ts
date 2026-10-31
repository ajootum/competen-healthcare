import { beforeEach, describe, expect, it, vi } from "vitest";
import { POLICY_SCOPE } from "../policy";
import { resetFlashcardSchema } from "./store";

// SCHOLAR-FLASHCARDS-QA-01 D1 (staging acceptance): learner B bookmarking learner A's card, or putting A's cards in B's
// own deck, must be a plain 404 with nothing written. The fake database below refuses a mark or a deck place whose
// card belongs to someone else, exactly as the 730 foreign keys (question_id, user_id) do -- so a route that writes
// first would surface that refusal as a 500. The routes must check ownership before they write.

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const A_CARD = "aaaaaaaa-0000-4000-8000-0000000000c1";
const B_CARD = "bbbbbbbb-0000-4000-8000-0000000000c1";
const B_DECK = "bbbbbbbb-0000-4000-8000-0000000000d1";
const B_DECK2 = "bbbbbbbb-0000-4000-8000-0000000000d2";

vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
const db = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, writes: [] as { table: string; op: string; rows: unknown }[] }));
vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: fakeAdmin(), userId: B, profile: { fullName: "Learner B" } }),
  isGuardRefusal: (x: unknown) => x instanceof Response,
}));

const FK_TABLES = new Set(["individual_scholar_flashcard_mark", "individual_scholar_flashcard_deck_card"]);
/** The 730 composite foreign key: a mark or a deck place may only name a question of the same user. */
const fkFails = (table: string, rows: Record<string, unknown>[]) =>
  FK_TABLES.has(table) && rows.some(r => !(db.tables.individual_scholar_question ?? []).some(q => q.id === r.question_id && q.user_id === r.user_id));

function fakeAdmin() {
  const from = (table: string) => {
    let rows = [...(db.tables[table] ?? [])];
    let write: { op: string; rows: Record<string, unknown>[] } | null = null;
    const q: Record<string, unknown> = {};
    const result = () => {
      if (write) {
        if (fkFails(table, write.rows)) return { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
        db.writes.push({ table, op: write.op, rows: write.rows });
        if (write.op === "insert") { const made = write.rows.map((r, i) => ({ id: `${B_DECK.slice(0, -2)}9${i}`, ...r })); db.tables[table] = [...(db.tables[table] ?? []), ...made]; return { data: made[0], error: null }; }
        return { data: null, error: null };
      }
      return { data: rows, error: null };
    };
    const self = () => q;
    q.select = self; q.order = self; q.limit = self;
    q.eq = (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[c])); return q; };
    q.insert = (r: unknown) => { write = { op: "insert", rows: [r as Record<string, unknown>].flat() }; return q; };
    q.upsert = (r: unknown) => { write = { op: "upsert", rows: [r as Record<string, unknown>].flat() }; return q; };
    q.update = (r: unknown) => { write = { op: "update", rows: [] }; void r; return q; };
    q.delete = () => { write = { op: "delete", rows: [] }; return q; };
    q.maybeSingle = () => Promise.resolve((() => { const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; })());
    q.single = q.maybeSingle;
    q.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}

function seed() {
  db.writes = [];
  db.tables = {
    individual_scholar_question: [{ id: A_CARD, user_id: A, kind: "flashcard", stem: "A's card?" }, { id: B_CARD, user_id: B, kind: "flashcard", stem: "B's card?" }],
    individual_scholar_flashcard_deck: [
      { id: B_DECK, user_id: B, title: "B deck", organise_by: "personal", organise_ref: null, created_at: "2026-10-30", updated_at: "2026-10-30", last_studied_at: null },
      { id: B_DECK2, user_id: B, title: "B deck 2", organise_by: "personal", organise_ref: null, created_at: "2026-10-30", updated_at: "2026-10-30", last_studied_at: null },
    ],
    individual_scholar_flashcard_deck_card: [],
    individual_scholar_flashcard_mark: [],
    workspace_config_overrides: [{ scope_type: POLICY_SCOPE.scopeType, scope_ref: POLICY_SCOPE.scopeRef, config_path: "unused", published: {} }],
  };
}
const json = (body: unknown, method = "PATCH") => new Request("http://x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const cardRoute = () => import("@/app/api/individual/scholar/flashcards/[id]/route");
const deckRoute = () => import("@/app/api/individual/scholar/flashcards/decks/[id]/route");
const decksRoute = () => import("@/app/api/individual/scholar/flashcards/decks/route");
const markOrDeckWrites = () => db.writes.filter(w => FK_TABLES.has(w.table) || (w.table === "individual_scholar_flashcard_deck" && w.op !== "update"));

describe("D1: another learner's card is not found (404), and nothing is written", () => {
  beforeEach(() => { resetFlashcardSchema(); seed(); });
  it("bookmarking, noting or reporting another learner's card: 404, no mark written", async () => {
    for (const body of [{ bookmarked: true }, { note: "mine now" }, { issue: null }]) {
      const r = await (await cardRoute()).PATCH(json(body), params(A_CARD));
      expect(r.status, JSON.stringify(body)).toBe(404);
    }
    expect(markOrDeckWrites()).toEqual([]);
    // The caller's own card still works.
    expect((await (await cardRoute()).PATCH(json({ bookmarked: true }), params(B_CARD))).status).toBe(200);
    expect(markOrDeckWrites().map(w => w.table)).toEqual(["individual_scholar_flashcard_mark"]);
  });
  it("adding another learner's cards to one's own deck: 404, no deck place written (even alongside one's own)", async () => {
    const r = await (await deckRoute()).PATCH(json({ add: [B_CARD, A_CARD] }), params(B_DECK));
    expect(r.status).toBe(404);
    expect(markOrDeckWrites()).toEqual([]);
    expect((await (await deckRoute()).PATCH(json({ add: [B_CARD] }), params(B_DECK))).status).toBe(200);
    expect(markOrDeckWrites().map(w => w.table)).toEqual(["individual_scholar_flashcard_deck_card"]);
  });
  it("making a deck that names another learner's card: 404, no deck made", async () => {
    const r = await (await decksRoute()).POST(json({ title: "Stolen", cardIds: [A_CARD] }, "POST"));
    expect(r.status).toBe(404);
    expect(markOrDeckWrites()).toEqual([]);
  });
  it("control: without the ownership check, the foreign key refusal surfaces as a 500 (the defect this fixes)", async () => {
    const { setFlashcardMark, addDeckCards } = await import("./store");
    expect(await setFlashcardMark(fakeAdmin(), B, A_CARD, { bookmarked: true })).toBe(false);
    expect(await addDeckCards(fakeAdmin(), B, B_DECK, [A_CARD])).toBe(false);
  });
});
