/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from "vitest";
import { createNotebookNote, lessonNotes, notebookSchema, resetNotebookSchema, updateNotebookNote } from "./store";
import { savedLearningRows } from "./store";
import { savedHitPath } from "./global-search";
import { FREE_CONTEXT } from "./personal-notebook";

const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", K = "11111111-1111-4111-8111-111111111111", N = "22222222-2222-4222-8222-222222222222", M = "33333333-3333-4333-8333-333333333333", C = "44444444-4444-4444-8444-444444444444", S = "55555555-5555-4555-8555-555555555555";

/** A query builder that records its filters and answers from `reply`. */
function fakeAdmin(reply: (table: string, op: string, filters: Record<string, unknown>, row?: any) => { data?: any; error?: any; count?: number }, rpc?: (name: string) => { data?: any; error?: any }) {
  const log: { table: string; op: string; filters: Record<string, unknown>; row?: any; orFilter?: string }[] = [];
  const admin = {
    log,
    rpc: async (name: string) => (rpc ? rpc(name) : { data: true, error: null }),
    from(table: string) {
      const entry: (typeof log)[number] = { table, op: "select", filters: {} };
      log.push(entry);
      const b: any = {
        select: () => b, order: () => b, limit: () => b, range: () => b,
        insert: (row: any) => { entry.op = "insert"; entry.row = row; return b; },
        update: (row: any) => { entry.op = "update"; entry.row = row; return b; },
        eq: (k: string, v: unknown) => { entry.filters[k] = v; return b; },
        neq: (k: string, v: unknown) => { entry.filters[`neq:${k}`] = v; return b; },
        in: (k: string, v: unknown) => { entry.filters[`in:${k}`] = v; return b; },
        is: (k: string, v: unknown) => { entry.filters[`is:${k}`] = v; return b; },
        or: (f: string) => { entry.orFilter = f; return b; },
        single: async () => reply(table, entry.op, entry.filters, entry.row),
        maybeSingle: async () => reply(table, entry.op, entry.filters, entry.row),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(reply(table, entry.op, entry.filters, entry.row)).then(ok, bad),
      };
      return b;
    },
  };
  return admin;
}

beforeEach(() => resetNotebookSchema());

describe("notebookSchema", () => {
  it("is on only when the marker answers, and a missing function is remembered as absent", async () => {
    expect(await notebookSchema(fakeAdmin(() => ({})) as any)).toBe(true);
    resetNotebookSchema();
    let asks = 0;
    const absent = fakeAdmin(() => ({}), () => { asks++; return { error: { code: "42883" } }; });
    expect(await notebookSchema(absent as any)).toBe(false);
    expect(await notebookSchema(absent as any)).toBe(false);
    expect(asks).toBe(1);
  });
  it("a transient error is no for now, and asked again", async () => {
    let asks = 0;
    const flaky = fakeAdmin(() => ({}), () => { asks++; return asks === 1 ? { error: { code: "08006" } } : { data: true }; });
    expect(await notebookSchema(flaky as any)).toBe(false);
    expect(await notebookSchema(flaky as any)).toBe(true);
  });
});

describe("createNotebookNote", () => {
  const input = { clientKey: K, body: "An idea", title: null, tags: [], context: FREE_CONTEXT };
  it("writes a free note for the caller, with no target column set", async () => {
    const a = fakeAdmin((t, op) => (op === "insert" ? { data: { id: N, revision: 1 } } : { count: 0 }));
    expect(await createNotebookNote(a as any, U, input)).toEqual({ ok: true, id: N, revision: 1, existing: false });
    const row = a.log.find(l => l.op === "insert")!.row;
    expect(row).toMatchObject({ user_id: U, kind: "note", target_kind: "free", client_key: K, material_id: null, chunk_id: null, session_id: null, step: null, artefact_id: null });
  });
  it("a repeated key returns the note it made, and what it holds, never a second note", async () => {
    const a = fakeAdmin((t, op) => (op === "insert" ? { error: { code: "23505" } } : op === "select" && t === "individual_scholar_note" ? { data: { id: N, revision: 4, body: "older", title: null, tags: [] }, count: 0 } : {}));
    expect(await createNotebookNote(a as any, U, input)).toMatchObject({ ok: true, id: N, revision: 4, existing: true, stored: { body: "older" } });
  });
  it("a section that is not the caller's is not found, and nothing is written", async () => {
    const a = fakeAdmin(t => (t === "individual_scholar_chunk" ? { data: null } : { count: 0 }));
    const r = await createNotebookNote(a as any, U, { ...input, context: { ...FREE_CONTEXT, link: { targetKind: "lesson", sessionId: S, step: 0, materialId: M, chunkId: C } } });
    expect(r).toEqual({ ok: false, error: "not_found" });
    expect(a.log.some(l => l.op === "insert")).toBe(false);
  });
  it("stops at the 820 limit", async () => {
    const a = fakeAdmin(() => ({ count: 5000 }));
    expect(await createNotebookNote(a as any, U, input)).toEqual({ ok: false, error: "limit" });
  });
});

describe("updateNotebookNote", () => {
  it("changes only the revision it was made from, and only the caller's", async () => {
    const a = fakeAdmin(() => ({ data: [{ id: N, revision: 3 }] }));
    expect(await updateNotebookNote(a as any, U, N, { expectedRevision: 2, body: "x" })).toEqual({ ok: true, id: N, revision: 3 });
    expect(a.log[0].filters).toMatchObject({ user_id: U, id: N, revision: 2, "neq:kind": "bookmark" });
    expect(a.log[0].row).toEqual({ body: "x" });
  });
  it("an old copy changes nothing and returns the stored copy", async () => {
    const a = fakeAdmin((t, op) => (op === "update" ? { data: [] } : { data: { kind: "note", revision: 9, body: "other", title: null, tags: [] } }));
    expect(await updateNotebookNote(a as any, U, N, { expectedRevision: 2, body: "x" })).toEqual({ ok: false, error: "conflict", current: { body: "other", title: null, tags: [], revision: 9 } });
  });
  it("a note that is not there is not found", async () => {
    const a = fakeAdmin((t, op) => (op === "update" ? { data: [] } : { data: null }));
    expect(await updateNotebookNote(a as any, U, N, { expectedRevision: 2, body: "x" })).toEqual({ ok: false, error: "not_found" });
  });
  it("moving a link writes every target column and forgets what it was on", async () => {
    const a = fakeAdmin(() => ({ data: [{ id: N, revision: 3 }] }));
    await updateNotebookNote(a as any, U, N, { expectedRevision: 2, link: { targetKind: "free" }, sectionLabel: null, sectionAnchor: null });
    expect(a.log[0].row).toMatchObject({ target_kind: "free", material_id: null, chunk_id: null, session_id: null, step: null, section_label: null, section_anchor: null, was_on: null });
  });
  it("a database refusal is invalid, never a retry", async () => {
    const a = fakeAdmin(() => ({ error: { code: "23514" } }));
    expect(await updateNotebookNote(a as any, U, N, { expectedRevision: 2, link: { targetKind: "free" } })).toEqual({ ok: false, error: "invalid" });
  });
  it("nothing to change is invalid", async () => {
    expect(await updateNotebookNote(fakeAdmin(() => ({})) as any, U, N, { expectedRevision: 2 })).toEqual({ ok: false, error: "invalid" });
  });
});

describe("lessonNotes", () => {
  it("reads the lesson and its sections, keyed on the caller, and drops ids that are not ids", async () => {
    const a = fakeAdmin(() => ({ data: [] }));
    await lessonNotes(a as any, U, { sessionId: S, step: 2, chunkIds: [C, "x);drop"] });
    expect(a.log[0].filters).toMatchObject({ user_id: U });
    expect(a.log[0].orFilter).toBe(`and(session_id.eq.${S},step.eq.2),chunk_id.in.(${C})`);
  });
});

describe("the Ask saved-learning source never carries a note written through the Notebook", () => {
  const hits = [{ kind: "note", id: N, material_id: null, session_id: null, step: null, artefact_id: null, chunk_id: null, label: "note", headline: "x", rank: 1, created_at: "2026-11-06", total: 1 }];
  const run = (notebook: { data?: unknown; error?: unknown }) => {
    const a = fakeAdmin((t, _op, filters) => (t === "individual_scholar_note" ? { data: filters["is:client_key"] === null ? [] : [{ id: N, material_id: null, body: "My private idea", created_at: "2026-11-06" }] } : { data: [] }),
      name => (name === "individual_scholar_library_search" ? { data: hits } : name === "individual_scholar_notebook_1000" ? notebook : { data: null }));
    return { a, rows: savedLearningRows(a as any, U, "idea", 3) };
  };
  it("with 1000 applied: the read is filtered to client_key is null, so the note's text is not returned", async () => {
    const { a, rows } = run({ data: true });
    const r = await rows;
    expect(r).toEqual({ ok: true, data: [] });
    expect(a.log.find(l => l.table === "individual_scholar_note" && "in:id" in l.filters)!.filters["is:client_key"]).toBeNull();
  });
  it("a transient error asking for 1000 keeps the filter on", async () => {
    const { a, rows } = run({ error: { code: "08006" } });
    await rows;
    expect(a.log.find(l => l.table === "individual_scholar_note" && "in:id" in l.filters)!.filters["is:client_key"]).toBeNull();
  });
  it("without 1000: the column is never named, and the older notes behave as they did", async () => {
    const { a, rows } = run({ error: { code: "42883" } });
    const r = await rows;
    expect(a.log.find(l => l.table === "individual_scholar_note" && "in:id" in l.filters)!.filters).not.toHaveProperty("is:client_key");
    expect(r).toMatchObject({ ok: true, data: [{ id: N, kind: "note" }] });
  });
});

describe("search results", () => {
  it("a free-standing note opens in My Notebook, and an attached one where it is attached", () => {
    const h = { kind: "note" as const, id: N, label: "note", sessionId: null, step: null, materialId: null, chunkId: null, artefactId: null };
    expect(savedHitPath(h)).toBe(`study/notebook/${N}`);
    expect(savedHitPath({ ...h, materialId: M, chunkId: C })).toBe(`study/${M}#c-${C}`);
    expect(savedHitPath({ ...h, sessionId: S, step: 1 })).toContain(`session=${S}`);
    expect(savedHitPath({ ...h, kind: "artefact", artefactId: N })).toBe("study/saved");
  });
});
