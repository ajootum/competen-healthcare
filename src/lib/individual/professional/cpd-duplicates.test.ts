/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEARNING_UNMATCH_ACTION } from "./learning";
import { DUPLICATE_NOTICE_ACTION, scanLearningDuplicateNotices } from "./cpd-duplicates";

// Owner, CPD duplicates: "we don't post this and send a notification to the user". A matching save is refused and the
// person notified (email only if they opted in); "This is a different activity" saves it with their decision in the
// audit trail; a non-match saves normally; a Learning completion that arrives later counts once and notifies; and no
// row the person wrote is ever deleted.

const USER = "00000000-0000-4000-8000-0000000000aa";
const REC = "00000000-0000-4000-8000-00000000e001";
const CPD = "00000000-0000-4000-8000-00000000c0a1";

type Call = { table: string; op: string; args: any[] };
const S: { calls: Call[]; rows: Record<string, any[]>; flags: Record<string, boolean>; auditInsertFails: boolean; sent: any[] } =
  { calls: [], rows: {}, flags: {}, auditInsertFails: false, sent: [] };

function fake() {
  const from = (table: string) => {
    const filters: [string, any][] = [];
    const q: any = {};
    const rec = (op: string, args: any[]) => { S.calls.push({ table, op, args }); };
    for (const op of ["select", "in", "order", "limit", "like", "not", "lte", "or", "update", "upsert", "delete"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); filters.push([a[0], a[1]]); return q; };
    const data = () => {
      if (table === "practice_platform_flags") { const f = filters.find(([k]) => k === "flag")?.[1]; return S.flags[f] ? [{ enabled: true }] : []; }
      return (S.rows[table] ?? []).filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v));
    };
    let inserted: any = null;
    q.insert = (row: any) => {
      rec("insert", [row]);
      inserted = row;
      if (table === "audit_log") {
        if (S.auditInsertFails) return Object.assign(Promise.resolve({ data: null, error: { message: "down" } }), q);
        (S.rows.audit_log ??= []).push(row);
      }
      return q;
    };
    q.maybeSingle = async () => ({ data: data()[0] ?? null, error: null });
    q.single = async () => ({ data: inserted ? { id: inserted.id ?? "x", evidence_class: "self_declared" } : data()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => Promise.resolve({ data: data(), error: null }).then(ok, ko);
    return q;
  };
  return { from };
}

vi.mock("@/lib/individual/guard", () => ({ requireIndividualContext: async () => ({ admin: fake(), userId: USER }), isGuardRefusal: () => false }));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
vi.mock("@/lib/notifications/dispatch", () => ({
  dispatch: async (_admin: any, ids: string[], message: any, channels: string[]) => { S.sent.push({ ids, message, channels }); return { deliveries: [{ channel: "email", status: "sent" }] }; },
}));

const RECORD = {
  id: REC, offering_id: "o1", version_id: "v1", delivery: "hosted", completed_at: "2026-03-10T09:00:00Z", completion_kind: "course_completion",
  evidence_class: "platform_recorded", external_completed_on: null, external_hours: null, user_id: USER, status: "completed",
  learning_offering: { code: "LRN-ECG-01", title: "ECG Interpretation" }, learning_offering_version: { version_no: 1, content: { cpd: { hours: 1.5 } }, delivery_provider_id: null },
};
const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ title: "ECG interpretation", activityType: "course", activityDate: "2026-03-12", hours: "2", ...over })) fd.set(k, v);
  return fd;
};
const writes = () => S.calls.filter(c => ["insert", "update", "upsert", "delete"].includes(c.op));
const route = () => import("@/app/api/individual/professional/cpd/route");
const post = async (fd: FormData) => (await route()).POST(new Request("http://x/api/individual/professional/cpd", { method: "POST", body: fd }));
const put = async (id: string, fd: FormData) => (await route()).PUT(new Request(`http://x/api/individual/professional/cpd?id=${id}`, { method: "PUT", body: fd }));

beforeEach(() => {
  S.calls = []; S.sent = []; S.auditInsertFails = false;
  S.flags = { learning_app: true, individual_app: true };
  S.rows = { learning_record: [RECORD], audit_log: [], individual_professional_cpd: [], individual_professional_profile: [{ user_id: USER, reminder_in_app: true, reminder_email: true }] };
});

describe("at entry: a course already in the record through Competen Learning is not posted", () => {
  it("a matching save is REFUSED, with the course, its date and a link, and a notification is queued", async () => {
    const res = await post(form());
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error).toMatch(/already in your record through Competen Learning: ECG Interpretation, 2026-03-10/);
    expect(j.link.href).toBe(`/individual/learning/record/${REC}`);
    expect(j.override.field).toBe("differentActivity");
    expect(writes().some(w => w.table === "individual_professional_cpd")).toBe(false);       // never posted
    expect(S.sent).toHaveLength(1);
    expect(S.sent[0]).toMatchObject({ ids: [USER], channels: ["email"] });
    expect(S.sent[0].message.title).not.toMatch(/ECG/);                                      // the subject names no course
    expect(S.rows.audit_log.some(r => r.action === DUPLICATE_NOTICE_ACTION && r.entity_id === REC)).toBe(true);
  });

  it("notified once per course: a second refused try is refused again but not emailed again", async () => {
    await post(form());
    expect((await post(form())).status).toBe(409);
    expect(S.sent).toHaveLength(1);
  });

  it("email is opt-in: not opted in, the save is still refused and nothing is emailed", async () => {
    S.rows.individual_professional_profile = [{ user_id: USER, reminder_in_app: true, reminder_email: false }];
    expect((await post(form())).status).toBe(409);
    expect(S.sent).toHaveLength(0);
  });

  it("'This is a different activity' saves it, with the person's decision audited FIRST", async () => {
    const res = await post(form({ differentActivity: "yes" }));
    expect(res.status).toBe(201);
    const w = writes();
    const decision = w.findIndex(c => c.table === "audit_log" && c.args[0].action === LEARNING_UNMATCH_ACTION);
    const row = w.findIndex(c => c.table === "individual_professional_cpd" && c.op === "insert");
    expect(decision).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThan(decision);
    expect(w[decision].args[0]).toMatchObject({ actor_id: USER, entity_type: "individual_professional_cpd", entity_id: w[row].args[0].id, new_value: { learning_record_id: REC } });
    expect(JSON.stringify(w[decision].args[0])).not.toMatch(/ECG/);
  });

  it("an override whose decision cannot be saved saves nothing", async () => {
    S.auditInsertFails = true;
    expect((await post(form({ differentActivity: "yes" }))).status).toBe(500);
    expect(writes().some(w => w.table === "individual_professional_cpd")).toBe(false);
  });

  it("a non-match saves normally: a different title, outside the window, a conference, or providers that differ", async () => {
    for (const over of [{ title: "ECG interpretation 2" }, { activityDate: "2026-03-25" }, { activityType: "conference" }] as Record<string, string>[]) {
      S.calls = [];
      expect([over, (await post(form(over))).status]).toEqual([over, 201]);
      expect(writes().some(w => w.table === "audit_log" && w.args[0].action === LEARNING_UNMATCH_ACTION)).toBe(false);
    }
    S.rows.learning_record = [{ ...RECORD, learning_offering_version: { ...RECORD.learning_offering_version, delivery_provider_id: "p1" } }];
    S.rows.learning_provider = [{ id: "p1", name: "Competen Holdings" }];
    expect((await post(form({ provider: "St Elsewhere Trust" }))).status).toBe(201);
    expect((await post(form({ provider: "competen holdings" }))).status).toBe(409);       // both recorded and equal
    expect(S.sent.length).toBe(1);
  });

  it("Learning off: Professional saves exactly as before", async () => {
    S.flags.learning_app = false;
    expect((await post(form())).status).toBe(201);
    expect(S.sent).toHaveLength(0);
  });

  it("editing an entry already counted once is allowed; editing another into a duplicate is refused", async () => {
    S.rows.individual_professional_cpd = [{ id: CPD, user_id: USER, document_path: null, title: "ECG interpretation", provider: null, activity_type: "course", activity_date: "2026-03-12" }];
    expect((await put(CPD, form({ hours: "3" }))).status).toBe(200);
    S.rows.individual_professional_cpd = [{ id: CPD, user_id: USER, document_path: null, title: "Sepsis study day", provider: null, activity_type: "course", activity_date: "2026-03-12" }];
    expect((await put(CPD, form())).status).toBe(409);
  });
});

describe("later: a Learning completion that matches an entry already logged", () => {
  beforeEach(() => {
    S.rows.individual_live_entitlement = [{ user_id: USER, experience_code: "professional" }];
    S.rows.individual_membership = [{ user_id: USER, status: "active" }];
    S.rows.individual_professional_cpd = [{ id: CPD, user_id: USER, title: "ECG interpretation", provider: null, activity_type: "course", activity_date: "2026-03-12" }];
  });

  it("counts once (on read, elsewhere) and notifies the person once; the entry is not touched", async () => {
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ sent: 1, failed: 0 });
    expect(S.sent[0].message.body).toMatch(/now counted once/);
    expect(S.rows.audit_log.some(r => r.action === DUPLICATE_NOTICE_ACTION && r.entity_id === CPD)).toBe(true);
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ sent: 0, already: 1 });
    expect(S.sent).toHaveLength(1);
    expect(writes().filter(w => w.table !== "audit_log")).toEqual([]);
  });

  it("after 'different activity', the pair is no duplicate and nobody is notified", async () => {
    S.rows.audit_log = [{ actor_id: USER, action: LEARNING_UNMATCH_ACTION, entity_type: "individual_professional_cpd", entity_id: CPD, new_value: { learning_record_id: REC } }];
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ sent: 0 });
  });

  it("not opted in to email, or Learning off: no notice", async () => {
    S.rows.individual_professional_profile = [{ user_id: USER, reminder_email: false }];
    expect((await scanLearningDuplicateNotices(fake())).sent).toBe(0);
    S.flags.learning_app = false;
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ disabled: true });
    expect(S.sent).toHaveLength(0);
  });
});

describe("no row is ever deleted", () => {
  it("across refusal, override, normal save, edit and the later scan, nothing is deleted and no CPD row is updated by the duplicate rule", async () => {
    await post(form());
    await post(form({ differentActivity: "yes" }));
    await post(form({ title: "Something else entirely" }));
    S.rows.individual_live_entitlement = [{ user_id: USER, experience_code: "professional" }];
    S.rows.individual_membership = [{ user_id: USER, status: "active" }];
    S.rows.individual_professional_cpd = [{ id: CPD, user_id: USER, title: "ECG interpretation", provider: null, activity_type: "course", activity_date: "2026-03-12" }];
    await scanLearningDuplicateNotices(fake());
    expect(S.calls.filter(c => c.op === "delete")).toEqual([]);
    expect(S.calls.filter(c => c.op === "update")).toEqual([]);
  });
});
