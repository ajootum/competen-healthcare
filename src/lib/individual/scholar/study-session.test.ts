/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from "vitest";
import { STUDY_LINK_KINDS, STUDY_SPACES, isStudyLinkKind, isStudySpace, studyFields } from "./study-session";
import {
  addStudyLink, createLearningSession, getConnectedSession, latestConnectedSession, listStudyLinks, resetStudySessionSchema, setLastSpace, studySessionSchema,
} from "./store";

const U = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const MISSING_COL = { code: "42703", message: "column individual_scholar_learning_session.connected does not exist" };
const MISSING_TABLE = { code: "PGRST205", message: "Could not find the table individual_scholar_study_link" };

type Call = { table: string; op: string; payload?: any; filters: [string, string, unknown][] };
/** A PostgREST-shaped fake: every chain resolves to answer(call), and every call is recorded with its filters. */
function fakeAdmin(answer: (c: Call) => { data: any; error: any }) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, op: "select", filters: [] };
    calls.push(c);
    const q: any = {};
    for (const m of ["select", "limit", "order", "maybeSingle", "single", "in"]) q[m] = () => q;
    for (const op of ["insert", "update", "upsert", "delete"]) q[op] = (payload?: any) => { c.op = op; c.payload = payload; return q; };
    q.eq = (k: string, v: unknown) => { c.filters.push(["eq", k, v]); return q; };
    q.then = (res: any, rej: any) => Promise.resolve(answer(c)).then(res, rej);
    return q;
  };
  return { from, calls };
}
const ok = (data: any = []) => ({ data, error: null });
const row = { id: S, scope_kind: "topic", title: "Renal", topic: "renal", competency_id: null, current_step: 0, status: "active", created_at: "t", last_active_at: "t", connected: true, last_space: "revise", objective_outcome: null, objective_text: "Explain concentration" };

describe("study session vocabulary (pure)", () => {
  it("four spaces and six link kinds, matching the 740 CHECKs", () => {
    expect(STUDY_SPACES).toEqual(["learn", "revise", "apply", "evaluate"]);
    expect(STUDY_LINK_KINDS).toEqual(["revision_session", "osce_attempt", "flashcard_deck", "case_session", "evaluation", "exam_paper"]);
    expect(["learn", "home", "", null].map(isStudySpace)).toEqual([true, false, false, false]);
    expect(["exam_paper", "quiz_attempt", 3].map(isStudyLinkKind)).toEqual([true, false, false]);
  });
  it("no study field asked for: null, so a plain Learn session names no 740 column", () => {
    expect(studyFields({}, null)).toBeNull();
  });
  it("an outcome is kept only with a competency (D2), trimmed and capped; blank text is null", () => {
    expect(studyFields({ connected: true, objectiveOutcome: "  Assess   fluid balance ", objectiveText: "   " }, "c1"))
      .toEqual({ connected: true, objective_outcome: "Assess fluid balance", objective_text: null });
    expect(studyFields({ connected: true, objectiveOutcome: "Assess fluid balance" }, null))
      .toEqual({ connected: true, objective_outcome: null, objective_text: null });
    const f = studyFields({ objectiveOutcome: "x".repeat(900), objectiveText: "y".repeat(900) }, "c1")!;
    expect([f.connected, f.objective_outcome!.length, f.objective_text!.length]).toEqual([false, 500, 300]);
  });
});

describe("740 detection and safe degradation (store.ts)", () => {
  beforeEach(() => resetStudySessionSchema());

  it("missing column or table: remembered absent, and every function answers null / [] / unavailable without throwing", async () => {
    const a = fakeAdmin(c => c.table === "individual_scholar_learning_session" && c.op === "select" ? { data: null, error: MISSING_COL } : ok());
    expect(await studySessionSchema(a, U)).toBe(false);
    expect(await getConnectedSession(a, U, S)).toBeNull();
    expect(await latestConnectedSession(a, U)).toBeNull();
    expect(await setLastSpace(a, U, S, "apply")).toBe("unavailable");
    expect(await addStudyLink(a, U, { sessionId: S, kind: "evaluation", refId: R })).toBe("unavailable");
    expect(await listStudyLinks(a, U, S)).toBeNull();
    resetStudySessionSchema();
    const b = fakeAdmin(c => c.table === "individual_scholar_study_link" ? { data: null, error: MISSING_TABLE } : ok());
    expect(await studySessionSchema(b, U)).toBe(false);
  });

  it("a transient error is only 'no for now', and is asked again", async () => {
    expect(await studySessionSchema(fakeAdmin(() => ({ data: null, error: { code: "57014" } })), U)).toBe(false);
    expect(await studySessionSchema(fakeAdmin(() => ok()), U)).toBe(true);
  });

  it("a thrown client never reaches the page", async () => {
    const boom = { from: () => { throw new Error("network"); } };
    expect(await studySessionSchema(boom, U)).toBe(false);
    expect(await getConnectedSession(boom, U, S)).toBeNull();
  });

  it("a plain Learn session is written with no 740 column, so Learn works where 740 is absent", async () => {
    const a = fakeAdmin(c => c.op === "insert" && c.table === "individual_scholar_learning_session" ? ok({ id: S }) : c.op === "select" ? { data: null, error: MISSING_COL } : ok());
    const r = await createLearningSession(a, U, { scopeKind: "topic", title: "Renal", topic: "renal", competencyId: null, steps: [] });
    expect(r).toEqual({ ok: true, id: S });
    const ins = a.calls.find(c => c.op === "insert")!;
    expect(Object.keys(ins.payload).sort()).toEqual(["competency_id", "scope_kind", "title", "topic", "user_id"]);
    expect(a.calls.some(c => c.op === "select")).toBe(false); // the 740 probe is not even asked
  });

  it("a study session asked for where 740 is absent: study_not_provisioned, nothing written", async () => {
    const a = fakeAdmin(c => c.op === "select" ? { data: null, error: MISSING_COL } : ok({ id: S }));
    const r = await createLearningSession(a, U, { scopeKind: "topic", title: "Renal", topic: "renal", competencyId: null, steps: [], connected: true, objectiveText: "Explain" });
    expect(r).toEqual({ ok: false, error: "study_not_provisioned" });
    expect(a.calls.some(c => c.op === "insert")).toBe(false);
  });

  it("with 740: the study columns are written, keyed on the caller", async () => {
    const a = fakeAdmin(c => c.op === "insert" ? ok({ id: S }) : ok());
    const r = await createLearningSession(a, U, { scopeKind: "competency", title: "Fluids", topic: null, competencyId: "c1", steps: [], connected: true, objectiveOutcome: "Assess fluid balance" });
    expect(r).toEqual({ ok: true, id: S });
    expect(a.calls.find(c => c.op === "insert")!.payload).toMatchObject({ user_id: U, connected: true, objective_outcome: "Assess fluid balance", objective_text: null, competency_id: "c1" });
  });
});

describe("ownership (store.ts, every statement keyed on the caller)", () => {
  beforeEach(() => resetStudySessionSchema());

  it("getConnectedSession reads only the caller's connected row", async () => {
    const a = fakeAdmin(c => c.filters.some(f => f[1] === "id") ? ok(row) : ok());
    const s = await getConnectedSession(a, U, S);
    expect(s).toMatchObject({ id: S, connected: true, lastSpace: "revise", objectiveText: "Explain concentration" });
    const read = a.calls.filter(c => c.filters.some(f => f[1] === "id")).at(-1)!;
    expect(read.filters).toEqual(expect.arrayContaining([["eq", "user_id", U], ["eq", "id", S], ["eq", "connected", true]]));
    expect(await getConnectedSession(a, U, "not-a-uuid")).toBeNull();
  });

  it("not the caller's (no row): null, and a link to it is refused without disclosure", async () => {
    const a = fakeAdmin(() => ok(null));
    expect(await getConnectedSession(a, U, S)).toBeNull();
    expect(await addStudyLink(a, U, { sessionId: S, kind: "evaluation", refId: R })).toBe("not_found");
    expect(a.calls.some(c => c.op === "upsert")).toBe(false);
  });

  it("a ref that is not the caller's own activity is refused; the caller's own is linked idempotently", async () => {
    const theirs = fakeAdmin(c => c.table === "individual_scholar_learning_session" && c.filters.some(f => f[1] === "id") ? ok(row) : c.table === "individual_scholar_evaluation" ? ok(null) : ok());
    expect(await addStudyLink(theirs, U, { sessionId: S, kind: "evaluation", refId: R })).toBe("not_found");
    expect(theirs.calls.some(c => c.op === "upsert")).toBe(false);
    const own = fakeAdmin(c => c.table === "individual_scholar_learning_session" && c.filters.some(f => f[1] === "id") ? ok(row) : c.table === "individual_scholar_exam_paper" ? ok({ material_id: R }) : ok());
    expect(await addStudyLink(own, U, { sessionId: S, kind: "exam_paper", refId: R })).toBe("ok");
    const check = own.calls.find(c => c.table === "individual_scholar_exam_paper")!;
    expect(check.filters).toEqual([["eq", "user_id", U], ["eq", "material_id", R]]);
    expect(own.calls.find(c => c.op === "upsert")!.payload).toEqual({ session_id: S, user_id: U, kind: "exam_paper", ref_id: R });
  });

  it("an unknown kind, or a bad id, is not_found before any read", async () => {
    const a = fakeAdmin(() => ok());
    expect(await addStudyLink(a, U, { sessionId: S, kind: "quiz_attempt" as any, refId: R })).toBe("not_found");
    expect(await addStudyLink(a, U, { sessionId: "x", kind: "evaluation", refId: R })).toBe("not_found");
    expect(a.calls.length).toBe(0);
  });

  it("setLastSpace updates only the caller's connected session; an unknown space is refused", async () => {
    const a = fakeAdmin(c => c.op === "update" ? ok([{ id: S }]) : ok());
    expect(await setLastSpace(a, U, S, "evaluate")).toBe("ok");
    const up = a.calls.find(c => c.op === "update")!;
    expect(up.payload.last_space).toBe("evaluate");
    expect(up.filters).toEqual(expect.arrayContaining([["eq", "user_id", U], ["eq", "id", S], ["eq", "connected", true]]));
    expect(await setLastSpace(a, U, S, "home" as any)).toBe("not_found");
    expect(await setLastSpace(fakeAdmin(c => c.op === "update" ? ok([]) : ok()), U, S, "learn")).toBe("not_found");
  });

  it("listStudyLinks and latestConnectedSession are keyed on the caller", async () => {
    const a = fakeAdmin(c => c.table === "individual_scholar_study_link" && c.filters.some(f => f[1] === "session_id")
      ? ok([{ kind: "osce_attempt", ref_id: R, created_at: "t" }, { kind: "bogus", ref_id: R, created_at: "t" }])
      : c.filters.some(f => f[1] === "status") ? ok(row) : ok());
    expect(await listStudyLinks(a, U, S)).toEqual([{ kind: "osce_attempt", refId: R, createdAt: "t" }]);
    expect((await latestConnectedSession(a, U))?.id).toBe(S);
    for (const c of a.calls) expect(c.filters[0]).toEqual(["eq", "user_id", U]);
  });
});

describe("cleanObjectiveText", () => {
  it("folds spaces (including the letter s untouched), trims and cuts to the 740 limit; nothing left is null", async () => {
    const { cleanObjectiveText, OBJECTIVE_TEXT_MAX } = await import("./study-session");
    expect(cleanObjectiveText("  Explain   respiratory\n distress  ")).toBe("Explain respiratory distress");
    expect(cleanObjectiveText("x".repeat(OBJECTIVE_TEXT_MAX + 50))).toHaveLength(OBJECTIVE_TEXT_MAX);
    expect(cleanObjectiveText("   ")).toBeNull();
    expect(cleanObjectiveText(42)).toBeNull();
    expect(cleanObjectiveText(undefined)).toBeNull();
  });
});
