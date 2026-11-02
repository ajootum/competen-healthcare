import { beforeEach, describe, expect, it } from "vitest";
import { artefactIdsForSession, resetLibrarySchema, sessionsWithSavedItems } from "./store";
import { resolveFilterScope } from "./library-scope";
import { itemAllowed } from "./library-organise";

// SCHOLAR-CE-2026 CE-02: the new store reads and the filter scope are keyed on the caller. Learner B naming learner A's material or
// session gets nothing of A's; A's saved lessons and notes never reach B's session list or filter sets.

const A = "aaaaaaaa-0000-4000-8000-00000000000a", B = "bbbbbbbb-0000-4000-8000-00000000000b";
const A_SES = "aaaaaaaa-0000-4000-8000-0000000000e1", B_SES = "bbbbbbbb-0000-4000-8000-0000000000e1", B_SES2 = "bbbbbbbb-0000-4000-8000-0000000000e2";
const A_MAT = "aaaaaaaa-0000-4000-8000-0000000000f1", B_MAT = "bbbbbbbb-0000-4000-8000-0000000000f1";
const A_CH = "aaaaaaaa-0000-4000-8000-0000000000c1", B_CH1 = "bbbbbbbb-0000-4000-8000-0000000000c1", B_CH2 = "bbbbbbbb-0000-4000-8000-0000000000c2", B_CH3 = "bbbbbbbb-0000-4000-8000-0000000000c3";
const A_ART = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B_ART_DIRECT = "bbbbbbbb-0000-4000-8000-0000000000a1", B_ART_LEGACY = "bbbbbbbb-0000-4000-8000-0000000000a2", B_ART_PARTIAL = "bbbbbbbb-0000-4000-8000-0000000000a3", B_ART_OTHER = "bbbbbbbb-0000-4000-8000-0000000000a4";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

function fakeAdmin() {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: Record<string, unknown> = {};
      const self = () => q;
      q.select = self; q.order = self; q.limit = self; q.or = self;
      q.eq = (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return q; };
      q.is = (c: string, v: unknown) => { rows = rows.filter(r => (r[c] ?? null) === v); return q; };
      q.not = (c: string, _op: string, v: unknown) => { rows = rows.filter(r => (r[c] ?? null) !== v); return q; };
      q.in = (c: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[c])); return q; };
      q.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej);
      return q;
    },
  };
}

beforeEach(() => {
  resetLibrarySchema();
  tables = {
    individual_scholar_note: [
      { id: "n1", user_id: A, session_id: A_SES }, { id: "n2", user_id: B, session_id: B_SES2 }, { id: "n3", user_id: B, session_id: null },
    ],
    individual_scholar_artefact: [
      { id: A_ART, user_id: A, session_id: A_SES, superseded_at: null, material_id: A_MAT },
      { id: B_ART_DIRECT, user_id: B, session_id: B_SES, superseded_at: null, material_id: B_MAT },
      { id: B_ART_LEGACY, user_id: B, session_id: null, superseded_at: null, material_id: B_MAT },
      { id: B_ART_PARTIAL, user_id: B, session_id: null, superseded_at: null, material_id: B_MAT },
      { id: B_ART_OTHER, user_id: B, session_id: B_SES2, superseded_at: null, material_id: B_MAT },
    ],
    individual_scholar_artefact_source: [
      { user_id: A, artefact_id: A_ART, ordinal: 0, chunk_id: A_CH },
      { user_id: B, artefact_id: B_ART_DIRECT, ordinal: 0, chunk_id: B_CH1 },
      { user_id: B, artefact_id: B_ART_LEGACY, ordinal: 0, chunk_id: B_CH1 }, { user_id: B, artefact_id: B_ART_LEGACY, ordinal: 1, chunk_id: B_CH2 },
      { user_id: B, artefact_id: B_ART_PARTIAL, ordinal: 0, chunk_id: B_CH1 }, { user_id: B, artefact_id: B_ART_PARTIAL, ordinal: 1, chunk_id: B_CH3 },
      { user_id: B, artefact_id: B_ART_OTHER, ordinal: 0, chunk_id: B_CH2 },
    ],
    individual_scholar_learning_session: [
      { id: A_SES, user_id: A, scope_kind: "document", title: "A session", topic: null, competency_id: null, current_step: 0, status: "active", created_at: "2026-11-01T10:00:00Z", last_active_at: "2026-11-01T10:00:00Z" },
      { id: B_SES, user_id: B, scope_kind: "document", title: "B session one", topic: null, competency_id: null, current_step: 0, status: "active", created_at: "2026-11-01T10:00:00Z", last_active_at: "2026-11-01T10:00:00Z" },
      { id: B_SES2, user_id: B, scope_kind: "document", title: "B session two", topic: null, competency_id: null, current_step: 0, status: "active", created_at: "2026-11-02T10:00:00Z", last_active_at: "2026-11-02T10:00:00Z" },
    ],
    individual_scholar_learning_step: [
      { user_id: A, session_id: A_SES, step: 0, chunk_id: A_CH, material_id: A_MAT },
      { user_id: B, session_id: B_SES, step: 0, chunk_id: B_CH1, material_id: B_MAT }, { user_id: B, session_id: B_SES, step: 0, chunk_id: B_CH2, material_id: B_MAT },
    ],
  };
});

describe("CE-02 sessions that have saved items", () => {
  it("lists only the caller's own, most recently active first", async () => {
    const rows = await sessionsWithSavedItems(fakeAdmin(), B);
    expect(rows.map(r => r.id)).toEqual([B_SES2, B_SES]);
    expect(rows.some(r => r.id === A_SES)).toBe(false);
    expect((await sessionsWithSavedItems(fakeAdmin(), A)).map(r => r.id)).toEqual([A_SES]);
  });
  it("is empty for a learner with nothing saved", async () => {
    expect(await sessionsWithSavedItems(fakeAdmin(), "cccccccc-0000-4000-8000-00000000000c")).toEqual([]);
  });
});

describe("CE-02 saved lessons of one session", () => {
  it("returns the ones recorded against it and older ones wholly inside its steps, not other sessions' or partial overlaps", async () => {
    const ids = (await artefactIdsForSession(fakeAdmin(), B, B_SES)) ?? [];
    expect([...ids].sort()).toEqual([B_ART_DIRECT, B_ART_LEGACY].sort());
    expect(ids).not.toContain(B_ART_PARTIAL);
    expect(ids).not.toContain(B_ART_OTHER);
  });
  it("gives a learner nothing for another learner's session", async () => {
    expect(await artefactIdsForSession(fakeAdmin(), B, A_SES)).toEqual([]);
    expect(await artefactIdsForSession(fakeAdmin(), A, B_SES)).toEqual([]);
    expect(await artefactIdsForSession(fakeAdmin(), B, "not-an-id")).toEqual([]);
  });
});

describe("CE-02 the resolved filter scope", () => {
  const none = { material: null, topic: null, session: null, competency: null };
  it("is the open scope when no filter is on", async () => {
    const s = await resolveFilterScope(fakeAdmin(), B, none, []);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: null, chunkId: null }, s)).toBe(true);
  });
  it("a session filter passes that session's items and sections only, and nothing for a foreign session", async () => {
    const mine = await resolveFilterScope(fakeAdmin(), B, { ...none, session: B_SES }, []);
    expect(itemAllowed({ materialId: null, sessionId: B_SES, artefactId: null, chunkId: null }, mine)).toBe(true);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: B_ART_LEGACY, chunkId: null }, mine)).toBe(true);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: B_ART_OTHER, chunkId: null }, mine)).toBe(false);
    const foreign = await resolveFilterScope(fakeAdmin(), B, { ...none, session: A_SES }, []);
    expect(foreign.sessionChunks?.size).toBe(0);
    expect(foreign.sessionArtefacts?.size).toBe(0);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: B_ART_DIRECT, chunkId: B_CH1 }, foreign)).toBe(false);
  });
  it("a topic filter passes only sections carrying it, and the lessons built on them", async () => {
    const topics = [{ chunkId: B_CH1, topics: ["Preload"] }, { chunkId: B_CH2, topics: ["Afterload"] }, { chunkId: A_CH, topics: ["Preload"] }];
    const s = await resolveFilterScope(fakeAdmin(), B, { ...none, topic: "preload" }, topics);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: null, chunkId: B_CH1 }, s)).toBe(true);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: null, chunkId: B_CH2 }, s)).toBe(false);
    // The lesson built on B's section passes; a lesson built on A's section (same topic name) is not B's and never appears.
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: B_ART_DIRECT, chunkId: null }, s)).toBe(true);
    expect(itemAllowed({ materialId: null, sessionId: null, artefactId: A_ART, chunkId: null }, s)).toBe(false);
  });
  it("a material filter finds a lesson's material through the caller's own lessons only", async () => {
    const items = [{ materialId: null, sessionId: null, artefactId: B_ART_DIRECT, chunkId: null }, { materialId: null, sessionId: null, artefactId: A_ART, chunkId: null }];
    const s = await resolveFilterScope(fakeAdmin(), B, { ...none, material: B_MAT }, [], items);
    expect(itemAllowed(items[0], s)).toBe(true);
    expect(itemAllowed(items[1], s)).toBe(false);
    const foreign = await resolveFilterScope(fakeAdmin(), B, { ...none, material: A_MAT }, [], items);
    expect(items.some(i => itemAllowed(i, foreign))).toBe(false);
  });
});
