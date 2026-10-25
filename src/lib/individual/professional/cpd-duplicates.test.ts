/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEARNING_UNMATCH_ACTION } from "./learning";
import { NOTICE_KIND, scanLearningDuplicateNotices } from "./cpd-duplicates";
import { loadNotices, markNoticeRead, NOTIFICATION_TABLE, postNotice } from "../notifications";

// Owner, CPD duplicates: "we don't post this and send a notification to the user", then "Use notifications in the
// user account, not Email". A matching save is refused and ONE in-account notice is posted; "This is a different
// activity" saves it with the person's decision audited; a non-match saves normally; a Learning completion that arrives
// later counts once and posts ONE notice; there is never an email and never an estate notifications row; notices are
// the person's own; and no row the person wrote is ever deleted.

const USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const REC = "00000000-0000-4000-8000-00000000e001";
const CPD = "00000000-0000-4000-8000-00000000c0a1";

type Call = { table: string; op: string; args: any[] };
const S: { calls: Call[]; rows: Record<string, any[]>; flags: Record<string, boolean>; auditInsertFails: boolean; noticeTableMissing: boolean; sent: any[] } =
  { calls: [], rows: {}, flags: {}, auditInsertFails: false, noticeTableMissing: false, sent: [] };

function fake() {
  const from = (table: string) => {
    const filters: [string, any][] = [];
    const nulls: string[] = [];
    const q: any = {};
    let patch: any = null;
    const rec = (op: string, args: any[]) => { S.calls.push({ table, op, args }); };
    for (const op of ["select", "in", "order", "limit", "like", "not", "lte", "or", "upsert", "delete"]) q[op] = (...a: any[]) => { rec(op, a); return q; };
    q.eq = (...a: any[]) => { rec("eq", a); filters.push([a[0], a[1]]); return q; };
    q.is = (...a: any[]) => { rec("is", a); if (a[1] === null) nulls.push(a[0]); return q; };
    q.update = (...a: any[]) => { rec("update", a); patch = a[0]; return q; };
    const data = () => {
      if (table === "practice_platform_flags") { const f = filters.find(([k]) => k === "flag")?.[1]; return S.flags[f] ? [{ enabled: true }] : []; }
      return (S.rows[table] ?? []).filter(r => filters.every(([k, v]) => !(k in r) || r[k] === v) && nulls.every(k => r[k] == null));
    };
    let inserted: any = null;
    q.insert = (row: any) => {
      rec("insert", [row]);
      inserted = row;
      if (table === "audit_log") {
        if (S.auditInsertFails) return Object.assign(Promise.resolve({ data: null, error: { message: "down" } }), q);
        (S.rows.audit_log ??= []).push(row);
      }
      if (table === NOTIFICATION_TABLE) {
        // 437: a missing table, or its unique (user_id, kind, dedupe_key).
        if (S.noticeTableMissing) return Promise.resolve({ data: null, error: { message: 'relation "individual_notification" does not exist' } });
        const rows = (S.rows[NOTIFICATION_TABLE] ??= []);
        if (rows.some(r => r.user_id === row.user_id && r.kind === row.kind && r.dedupe_key === row.dedupe_key)) return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
        rows.push({ id: `n${rows.length + 1}`, created_at: "2026-10-25T12:00:00Z", read_at: null, ...row });
        return Promise.resolve({ data: null, error: null });
      }
      return q;
    };
    q.maybeSingle = async () => ({ data: data()[0] ?? null, error: null });
    q.single = async () => ({ data: inserted ? { id: inserted.id ?? "x", evidence_class: "self_declared" } : data()[0] ?? null, error: null });
    q.then = (ok: any, ko: any) => {
      if (patch) { const hit = data(); for (const r of hit) Object.assign(r, patch); return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null }).then(ok, ko); }
      if (table === NOTIFICATION_TABLE && S.noticeTableMissing) return Promise.resolve({ data: null, error: { message: 'relation "individual_notification" does not exist' } }).then(ok, ko);
      return Promise.resolve({ data: data(), error: null }).then(ok, ko);
    };
    return q;
  };
  return { from };
}

vi.mock("@/lib/individual/guard", () => ({ requireIndividualContext: async () => ({ admin: fake(), userId: USER }), isGuardRefusal: () => false }));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
// Never called: any email the rule tried to send would land here and fail the "never an email" checks.
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
const notices = () => S.rows[NOTIFICATION_TABLE] ?? [];
const route = () => import("@/app/api/individual/professional/cpd/route");
const post = async (fd: FormData) => (await route()).POST(new Request("http://x/api/individual/professional/cpd", { method: "POST", body: fd }));
const put = async (id: string, fd: FormData) => (await route()).PUT(new Request(`http://x/api/individual/professional/cpd?id=${id}`, { method: "PUT", body: fd }));
const neverEmailNorEstate = () => {
  expect(S.sent).toEqual([]);
  expect(S.calls.some(c => c.table === "notifications" || c.table === "notif_deliveries")).toBe(false);
};

beforeEach(() => {
  S.calls = []; S.sent = []; S.auditInsertFails = false; S.noticeTableMissing = false;
  S.flags = { learning_app: true, individual_app: true };
  S.rows = { learning_record: [RECORD], audit_log: [], individual_professional_cpd: [], [NOTIFICATION_TABLE]: [] };
});

describe("at entry: a course already in the record through Competen Learning is not posted", () => {
  it("a matching save is REFUSED, with the course, its date and a link, and ONE in-account notice is posted", async () => {
    const res = await post(form());
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error).toMatch(/already in your record through Competen Learning: ECG Interpretation, 2026-03-10/);
    expect(j.link.href).toBe(`/individual/learning/record/${REC}`);
    expect(j.override.field).toBe("differentActivity");
    expect(writes().some(w => w.table === "individual_professional_cpd")).toBe(false);       // never posted
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({ user_id: USER, kind: NOTICE_KIND.refused, dedupe_key: `learning_record:${REC}`, href: `/individual/learning/record/${REC}` });
    expect(notices()[0].body).not.toMatch(/ECG/i);                                           // the text names no course
    neverEmailNorEstate();
  });

  it("one notice per course: a second refused try is refused again, with no second notice", async () => {
    await post(form());
    expect((await post(form())).status).toBe(409);
    expect(notices()).toHaveLength(1);
  });

  it("437 absent: the save is still refused, and nothing fails", async () => {
    S.noticeTableMissing = true;
    expect((await post(form())).status).toBe(409);
    neverEmailNorEstate();
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
    expect(notices()).toHaveLength(0);
  });

  it("an override whose decision cannot be saved saves nothing", async () => {
    S.auditInsertFails = true;
    expect((await post(form({ differentActivity: "yes" }))).status).toBe(500);
    expect(writes().some(w => w.table === "individual_professional_cpd")).toBe(false);
  });

  it("a non-match saves normally, with no notice: a different title, outside the window, a conference, a different provider", async () => {
    for (const over of [{ title: "ECG interpretation 2" }, { activityDate: "2026-03-25" }, { activityType: "conference" }] as Record<string, string>[]) {
      S.calls = [];
      expect([over, (await post(form(over))).status]).toEqual([over, 201]);
      expect(writes().some(w => w.table === "audit_log" && w.args[0].action === LEARNING_UNMATCH_ACTION)).toBe(false);
    }
    S.rows.learning_record = [{ ...RECORD, learning_offering_version: { ...RECORD.learning_offering_version, delivery_provider_id: "p1" } }];
    S.rows.learning_provider = [{ id: "p1", name: "Competen Holdings" }];
    expect((await post(form({ provider: "St Elsewhere Trust" }))).status).toBe(201);
    expect(notices()).toHaveLength(0);
    expect((await post(form({ provider: "competen holdings" }))).status).toBe(409);
    expect(notices()).toHaveLength(1);
    neverEmailNorEstate();
  });

  it("Learning off: Professional saves exactly as before", async () => {
    S.flags.learning_app = false;
    expect((await post(form())).status).toBe(201);
    expect(notices()).toHaveLength(0);
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

  it("counts once (on read, elsewhere) and posts ONE in-account notice; the entry is not touched", async () => {
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ posted: 1, failed: 0 });
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({ user_id: USER, kind: NOTICE_KIND.counted_once, dedupe_key: `cpd:${CPD}:${REC}` });
    expect(notices()[0].body).toMatch(/now counted once/);
    expect(notices()[0].body).not.toMatch(/ECG/i);
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ posted: 0, already: 1 });
    expect(notices()).toHaveLength(1);
    expect(writes().filter(w => w.table !== NOTIFICATION_TABLE)).toEqual([]);
    neverEmailNorEstate();
  });

  it("after 'different activity', the pair is no duplicate and no notice is posted", async () => {
    S.rows.audit_log = [{ actor_id: USER, action: LEARNING_UNMATCH_ACTION, entity_type: "individual_professional_cpd", entity_id: CPD, new_value: { learning_record_id: REC } }];
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ posted: 0 });
    expect(notices()).toHaveLength(0);
  });

  it("no email opt-in is consulted, and Learning off posts nothing", async () => {
    await scanLearningDuplicateNotices(fake());
    expect(S.calls.some(c => c.table === "individual_professional_profile")).toBe(false);
    S.flags.learning_app = false;
    S.rows[NOTIFICATION_TABLE] = [];
    expect(await scanLearningDuplicateNotices(fake())).toMatchObject({ disabled: true });
    expect(notices()).toHaveLength(0);
  });
});

describe("notices are the person's own", () => {
  beforeEach(() => {
    S.rows[NOTIFICATION_TABLE] = [
      { id: "n1", user_id: USER, kind: "cpd_duplicate_refused", body: "Mine.", href: "/individual", dedupe_key: "a", created_at: "2026-10-25T12:00:00Z", read_at: null },
      { id: "n2", user_id: OTHER, kind: "cpd_duplicate_refused", body: "Theirs.", href: "/individual", dedupe_key: "a", created_at: "2026-10-25T12:00:00Z", read_at: null },
    ];
  });

  it("the person reads only their own notices", async () => {
    const r = await loadNotices(fake(), USER);
    expect(r?.items.map(i => i.id)).toEqual(["n1"]);
  });

  it("marking read touches only their own unread notice; another person's notice is unchanged", async () => {
    expect(await markNoticeRead(fake(), USER, "n2")).toBe(false);
    expect(S.rows[NOTIFICATION_TABLE].find(r => r.id === "n2").read_at).toBeNull();
    expect(await markNoticeRead(fake(), USER, "n1")).toBe(true);
    expect(await markNoticeRead(fake(), USER, "n1")).toBe(false);                            // set once
    const upd = S.calls.filter(c => c.table === NOTIFICATION_TABLE && c.op === "update");
    expect(upd.every(u => Object.keys(u.args[0]).join() === "read_at")).toBe(true);        // only read_at changes
  });

  it("the mark-as-read route acts for the signed-in person only", async () => {
    const THEIRS = "00000000-0000-4000-8000-00000000aaaa";
    S.rows[NOTIFICATION_TABLE].push({ id: THEIRS, user_id: OTHER, kind: "cpd_duplicate_refused", body: "Theirs.", href: null, dedupe_key: "b", created_at: "2026-10-25T12:00:00Z", read_at: null });
    const { PATCH } = await import("@/app/api/individual/notifications/route");
    // Whatever the body claims, the person is the signed-in one: another person's notice is not touched.
    const res = await PATCH(new Request("http://x/api/individual/notifications", { method: "PATCH", body: JSON.stringify({ id: THEIRS, userId: OTHER }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(false);
    expect(S.rows[NOTIFICATION_TABLE].find(r => r.id === THEIRS).read_at).toBeNull();
  });

  it("an off-site link is never stored or shown", async () => {
    expect(await postNotice(fake(), USER, { kind: "test_kind", body: "x", href: "//evil.example/x", dedupeKey: "z" })).toBe("posted");
    expect(notices().at(-1).href).toBeNull();
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
    neverEmailNorEstate();
  });
});
