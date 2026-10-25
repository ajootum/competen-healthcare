/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningReference } from "@/lib/learning/products";
import { LEARNING_UNMATCH_ACTION, countedOnce, cpdYearsWithLearning, matchCpdToLearning, normaliseForMatch, pairKey, type ProfessionalLearning } from "./learning";
import { cpdHoursByYear } from "./progress";
import { policyPath, resolvePolicy } from "../policy";

// Owner, double-counted CPD hours: "automatic removal is best" -- of the duplicate HOURS, on read. A true duplicate is
// counted once (from the Learning record), a non-match counts twice, "This is a different activity" restores both, and
// the person's own row is never deleted.

const USER = "00000000-0000-4000-8000-0000000000aa";
const CPD_A = "00000000-0000-4000-8000-00000000c0a1", CPD_B = "00000000-0000-4000-8000-00000000c0b2";
const REC = "00000000-0000-4000-8000-00000000e001";

const ref = (over: Partial<LearningReference> = {}): LearningReference => ({
  recordId: REC, offeringId: "o1", code: "LRN-ECG-01", title: "ECG Interpretation", versionNo: 1, delivery: "hosted", provider: "Competen Holdings",
  completedOn: "2026-03-10", completionKind: "course_completion", outcomeLabel: "Course completion", evidenceClass: "platform_recorded",
  evidenceLabel: "Recorded by Competen Learning", hours: 1.5, cpdNote: "", certificates: [], competencies: [], ...over,
});
const entry = (over: Record<string, any> = {}) => ({ id: CPD_A, goal_id: null, title: "ECG interpretation.", provider: null, activity_type: "course", activity_date: "2026-03-12", hours: 2, evidence_class: "self_declared", ...over });
const on = (refs: LearningReference[], unmatched: ReadonlySet<string> | null = new Set()): ProfessionalLearning => ({ enabled: true, refs, unmatched });
const OTHER = { id: "00000000-0000-4000-8000-00000000c0ff", goal_id: null, title: "Sepsis study day", provider: null, activity_type: "conference", activity_date: "2026-04-01", hours: 3, evidence_class: "self_declared" };

/** The year totals the CPD log and Progress show, through the same two functions they call. */
const totals = (cpd: any[], learning: ProfessionalLearning, window = 7) => {
  const once = countedOnce(cpd, learning, window);
  return { once, year: cpdYearsWithLearning(cpdHoursByYear(once.counted), learning.refs ?? [])[0] };
};

describe("a true duplicate is counted once, from the Learning record", () => {
  it("same course (case, punctuation and whitespace ignored), within the window: hours counted once", () => {
    expect(normaliseForMatch("  ECG   Interpretation! ")).toBe(normaliseForMatch("ecg-interpretation"));
    const { once, year } = totals([entry(), OTHER], on([ref()]));
    expect([...once.matches.keys()]).toEqual([CPD_A]);
    expect(once.matches.get(CPD_A)).toMatchObject({ recordId: REC, title: "ECG Interpretation" });
    expect(year).toMatchObject({ hours: 4.5, fromLearning: 1.5 });          // 3 (conference) + 1.5 (Learning), not + 2 more
  });

  it("a workshop counts as a course; the window edge is inclusive; a matching provider the person recorded is fine", () => {
    expect(totals([entry({ activity_type: "workshop", activity_date: "2026-03-17", provider: "competen holdings" })], on([ref()])).once.matches.size).toBe(1);
  });

  it("one to one: two entries for the same course, only the nearer date is absorbed", () => {
    const m = matchCpdToLearning([entry({ id: CPD_B, activity_date: "2026-03-15" }), entry()], [ref()], 7, new Set());
    expect([...m.keys()]).toEqual([CPD_A]);
  });
});

describe("a non-match is counted twice (a false match must never hide real hours)", () => {
  const cases: [string, Record<string, any>, Partial<LearningReference>?, number?][] = [
    ["a different title", { title: "ECG interpretation 2" }],
    ["outside the window", { activity_date: "2026-03-18" }],
    ["window 0 is the same day only", { activity_date: "2026-03-11" }, {}, 0],
    ["a conference is not a course", { activity_type: "conference" }],
    ["the provider the person recorded differs", { provider: "St Elsewhere Trust" }],
    ["the course gave no hours, so it cannot absorb the entry's", {}, { hours: null }],
  ];
  for (const [name, over, refOver, window] of cases) {
    it(name, () => {
      const { once, year } = totals([entry(over)], on([ref(refOver)]), window ?? 7);
      expect(once.matches.size).toBe(0);
      expect(year.hours).toBe(2 + (refOver?.hours === null ? 0 : 1.5));
    });
  }

  it("Learning off, or no learning records: every entry counts, as before Learning existed", () => {
    expect(countedOnce([entry()], { enabled: false, refs: [], unmatched: new Set() }, 7).counted).toHaveLength(1);
    expect(countedOnce([entry()], on([]), 7).counted).toHaveLength(1);
  });

  it("the person's decisions cannot be read: nothing is de-duplicated, and the page is told", () => {
    const { once, year } = totals([entry()], on([ref()], null));
    expect(once).toMatchObject({ checkUnavailable: true });
    expect(once.matches.size).toBe(0);
    expect(year.hours).toBe(3.5);
  });
});

describe("'This is a different activity' restores both counts", () => {
  it("with the person's decision recorded, the same pair never matches again", () => {
    const { once, year } = totals([entry()], on([ref()], new Set([pairKey(CPD_A, REC)])));
    expect(once.matches.size).toBe(0);
    expect(year.hours).toBe(3.5);
  });

  it("the decision is for that pair only: another of the person's entries for the same course can still match", () => {
    const m = matchCpdToLearning([entry(), entry({ id: CPD_B, activity_date: "2026-03-11" })], [ref()], 7, new Set([pairKey(CPD_B, REC)]));
    expect([...m.keys()]).toEqual([CPD_A]);
  });
});

describe("nothing is deleted", () => {
  it("countedOnce leaves the person's list as it was: the matched entry is still there to show", () => {
    const cpd = [entry(), OTHER];
    const once = countedOnce(cpd, on([ref()]), 7);
    expect(cpd).toHaveLength(2);
    expect(once.counted.map(c => c.id)).toEqual([OTHER.id]);
  });
});

describe("the match window is policy, default 7", () => {
  it("unpublished is 7, and a published value is clamped to 0..30", () => {
    expect(resolvePolicy([]).professionalLearningMatchDays).toBe(7);
    const at = (v: unknown) => resolvePolicy([{ config_path: policyPath("professional_learning_match_days"), published: { value: v } }]).professionalLearningMatchDays;
    expect([at(14), at(0)]).toEqual([14, 0]);
    expect(at(99)).toBe(30);
    expect(at(-5)).toBe(0);
  });
});

// ── The route: the decision is the person's, ids only, and changes no record ───────────────────────────────────────

const state: { calls: { table: string; op: string; args: any[] }[]; rows: Record<string, any[]>; insertError: boolean } = { calls: [], rows: {}, insertError: false };
function fake() {
  const from = (table: string) => {
    const data = table === "practice_platform_flags" ? [{ enabled: true }] : (state.rows[table] ?? []);
    const q: any = {};
    let filters: [string, any][] = [];
    for (const op of ["select", "in", "order", "limit", "update", "upsert", "delete"]) q[op] = (...args: any[]) => { state.calls.push({ table, op, args }); return q; };
    q.eq = (...args: any[]) => { state.calls.push({ table, op: "eq", args }); filters.push([args[0], args[1]]); return q; };
    q.insert = (...args: any[]) => { state.calls.push({ table, op: "insert", args }); return Promise.resolve({ data: null, error: state.insertError ? { message: "down" } : null }); };
    const hit = () => data.filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v));
    q.maybeSingle = async () => ({ data: hit()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve({ data: hit(), error: null }).then(ok, ko);
    filters = [];
    return q;
  };
  return { from };
}

vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: fake(), userId: USER }),
  isGuardRefusal: () => false,
}));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));

const RECORD = {
  id: REC, offering_id: "o1", version_id: "v1", delivery: "hosted", completed_at: "2026-03-10T09:00:00Z", completion_kind: "course_completion", evidence_class: "platform_recorded",
  external_completed_on: null, external_hours: null, user_id: USER, status: "completed",
  learning_offering: { code: "LRN-ECG-01", title: "ECG Interpretation" }, learning_offering_version: { version_no: 1, content: {}, delivery_provider_id: null },
};

describe("PATCH /api/individual/professional/cpd/learning-match", () => {
  beforeEach(() => {
    state.calls = []; state.insertError = false;
    state.rows = { individual_professional_cpd: [{ id: CPD_A, user_id: USER }], learning_record: [RECORD], audit_log: [] };
  });
  const call = async (body: any) => {
    const { PATCH } = await import("@/app/api/individual/professional/cpd/learning-match/route");
    return PATCH(new Request("http://x/api/individual/professional/cpd/learning-match", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  };

  it("records the person's decision as one ids-only row, and never touches the CPD row or the learning record", async () => {
    const res = await call({ cpdId: CPD_A, recordId: REC });
    expect(res.status).toBe(200);
    const writes = state.calls.filter(c => ["insert", "update", "upsert", "delete"].includes(c.op));
    expect(writes.map(w => w.table)).toEqual(["audit_log"]);
    expect(writes[0].args[0]).toMatchObject({ actor_id: USER, action: LEARNING_UNMATCH_ACTION, entity_type: "individual_professional_cpd", entity_id: CPD_A, new_value: { learning_record_id: REC } });
    expect(JSON.stringify(writes[0].args[0])).not.toMatch(/ECG/);   // ids only: audit_log is read by estate consoles
  });

  it("refuses an entry that is not the person's, or a course that is not in their completed learning, and writes nothing", async () => {
    state.rows.individual_professional_cpd = [];
    expect((await call({ cpdId: CPD_A, recordId: REC })).status).toBe(404);
    state.rows.individual_professional_cpd = [{ id: CPD_A, user_id: USER }];
    state.rows.learning_record = [];
    expect((await call({ cpdId: CPD_A, recordId: REC })).status).toBe(404);
    expect(state.calls.some(c => c.op === "insert")).toBe(false);
  });

  it("a decision that cannot be saved is a failure, not a silent success", async () => {
    state.insertError = true;
    expect((await call({ cpdId: CPD_A, recordId: REC })).status).toBe(500);
  });
});
