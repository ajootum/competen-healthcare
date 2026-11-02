/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, satisfactoryResponse, STANDARD_CHECKLIST_LAYOUT } from "@/lib/assessment/core";
import { RESP_ASSESS, RESP_RULES, RA } from "@/lib/assessment/core/fixtures";
import { grantState, guardMessage, isMissingRelation } from "./common";
import { assembleDefinition, pickLayouts } from "./definition";
import { cleanAnswer, patchResponse, responsesFromRows, splitKey } from "./instances";
import { evidenceRecord, targetRefs, validUntil } from "./progression";
import { outcomePayload } from "./submit";
import { withRecordedOutcome } from "./report";
import { PatchQueue, readPending, type SendResult, type StorageLike } from "./autosave";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("grant state", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const base = { accepted_at: "2026-11-01T00:00:00Z", ended_at: null, valid_from: "2026-11-01T00:00:00Z", valid_until: null };
  it("is live only when accepted, not ended and inside its dates", () => {
    expect(grantState(base, now)).toBe("live");
    expect(grantState({ ...base, accepted_at: null }, now)).toBe("pending");
    expect(grantState({ ...base, ended_at: "2026-11-02T00:00:00Z" }, now)).toBe("ended");
    expect(grantState({ ...base, valid_until: "2026-11-02T00:00:00Z" }, now)).toBe("expired");
    expect(grantState({ ...base, valid_from: "2026-12-01T00:00:00Z" }, now)).toBe("not_yet");
  });
  it("an ended grant stays ended even if it would otherwise be live", () => {
    expect(grantState({ ...base, ended_at: "2026-11-03T00:00:00Z", valid_until: "2027-01-01T00:00:00Z" }, now)).toBe("ended");
  });
});

describe("database messages", () => {
  it("shows a guard message without the table prefix and hides anything else", () => {
    expect(guardMessage({ message: "asmt_respondent_grant: not independent. Nobody grants themselves authority" })).toBe("not independent. Nobody grants themselves authority");
    expect(guardMessage({ message: "duplicate key value violates unique constraint x" })).toBe("The database refused that change.");
  });
  it("recognises a missing table or function", () => {
    expect(isMissingRelation({ code: "42P01" })).toBe(true);
    expect(isMissingRelation({ message: 'relation "asmt_instance" does not exist' })).toBe(true);
    expect(isMissingRelation({ message: "permission denied" })).toBe(false);
  });
});

describe("answers", () => {
  it("keeps exactly one of level, state, value and drops nulls", () => {
    expect(cleanAnswer({ level_code: "L3", state: null, reason: " " })).toEqual({ level_code: "L3" });
    expect(cleanAnswer({ state: "not_applicable", reason: " not on this ward " })).toEqual({ state: "not_applicable", reason: "not on this ward" });
    expect(cleanAnswer({ value: 12 })).toEqual({ value: 12 });
    expect(cleanAnswer({ level_code: null, state: null })).toBeNull();
    expect(cleanAnswer(null)).toBeNull();
    expect(cleanAnswer([1])).toBeNull();
  });
  it("splits a response key", () => {
    expect(splitKey("abc")).toEqual({ itemKey: "abc", fieldKey: "primary" });
    expect(splitKey("abc#note")).toEqual({ itemKey: "abc", fieldKey: "note" });
  });
  it("maps answer rows to the engine map with revisions", () => {
    const r = responsesFromRows([{ item_id: "i1", field_key: "primary", value: { level_code: "L4" }, revision: 3 }, { item_id: "i1", field_key: "note", value: { value: "x" }, revision: 1 }, { item_id: "gone", field_key: "primary", value: { level_code: "L1" }, revision: 1 }], { i1: "KEY" });
    expect(r.responses).toEqual({ KEY: { level_code: "L4" }, "KEY#note": { value: "x" } });
    expect(r.revisions).toEqual({ KEY: 3, "KEY#note": 1 });
  });
});

describe("definition assembly", () => {
  const rows = {
    version: { id: "v1", version_no: 2, purpose_code: "p", method_codes: ["m"] },
    groups: [{ code: "g", label: "G", weight: "1", position: 0 }],
    sections: [{ id: "s1", stable_key: U(1), parent_section_id: null, title: "S", weight: 1, position: 0 }],
    items: [
      { id: "i1", stable_key: U(11), section_id: "s1", code: "A1", prompt: "Rate", response_type: "rating_scale", scale_version_id: "sv", config: {}, group_code: "g", method_codes: [], mandatory: true, critical: true, critical_requirements: ["must_be_satisfactory"], evidence_requirement: {}, weight: 1, position: 1 },
      { id: "i2", stable_key: U(12), section_id: null, code: "A2", prompt: "Loose", response_type: "yes_no", config: {}, evidence_requirement: { required: true }, weight: "2", position: 2 },
    ],
    fields: [{ item_id: "i2", field_key: "note", label: "Note", response_type: "free_text", config: {}, required: false, position: 0 }],
    scaleVersions: [{ id: "sv", scale_kind: "rating" }],
    levels: [{ version_id: "sv", code: "L3", label: "Three", ordinal: 3, numeric_value: "3", satisfactory: true }, { version_id: "sv", code: "L1", label: "One", ordinal: 1, satisfactory: false }],
    states: [{ version_id: "sv", state: "not_observed", label: "Not observed" }],
  };
  it("builds the engine definition, with scales embedded and ordered", () => {
    const a = assembleDefinition(rows);
    expect(a.def.items).toHaveLength(2);
    expect(a.def.items[0].scale?.levels.map(l => l.code)).toEqual(["L1", "L3"]);
    expect(a.def.items[0].scale?.levels[1].numeric_value).toBe(3);
    expect(a.def.items[0].evidence_requirement).toBeNull();
    expect(a.def.items[1].evidence_requirement).toEqual({ required: true });
    expect(a.def.items[1].weight).toBe(2);
    expect(a.def.items[1].fields?.[0].field_key).toBe("note");
    expect(a.itemIdByKey[U(11)]).toBe("i1");
    expect(a.itemKeyById.i2).toBe(U(12));
  });
  it("gives an item with no section a section of its own so the engine can draw it", () => {
    const a = assembleDefinition(rows);
    expect(a.def.items[1].section_key).toBe(a.def.sections[a.def.sections.length - 1].stable_key);
    expect(a.def.sections).toHaveLength(2);
  });
  it("picks standard and guided layouts from the pinned versions", () => {
    const guided = { ...STANDARD_CHECKLIST_LAYOUT, presentation: "guided_assessment" as const };
    const r = pickLayouts([{ presentation: "guided_assessment", layout: guided, is_primary: false }, { presentation: "standard_checklist", layout: STANDARD_CHECKLIST_LAYOUT, is_primary: true }]);
    expect(r.standard).toBe(STANDARD_CHECKLIST_LAYOUT);
    expect(r.guided).toBe(guided);
    expect(pickLayouts([])).toEqual({ standard: null, guided: null });
  });
});

describe("submit payload and recorded outcome", () => {
  const responses: any = Object.fromEntries(RESP_ASSESS.items.map(i => [i.stable_key, satisfactoryResponse(i)]));
  it("carries the engine outcome, group outcomes, aggregates, trace and trace hash", () => {
    const ev = evaluate(RESP_ASSESS, RESP_RULES, responses);
    const p = outcomePayload(ev);
    expect(p.outcomeCode).toBe(ev.outcome.code);
    expect(p.outcomeClass).toBe(ev.class);
    expect(p.traceHash).toBe(ev.traceHash);
    expect(Array.isArray(p.trace.steps)).toBe(true);
    expect(p.trace.gates.criticalFail).toBeDefined();
  });
  it("shows the recorded outcome when the database safeguard replaced the engine's", () => {
    const ev = evaluate(RESP_ASSESS, RESP_RULES, responses);
    const neg = RESP_RULES.outcomes.find(o => o.class === "negative")!;
    const over = withRecordedOutcome(ev, { outcome_code: neg.code, outcome_class: "negative", backstop_applied: true }, c => RESP_RULES.outcomes.find(o => o.code === c)?.label ?? null);
    expect(over.class).toBe("negative");
    expect(over.outcome.label).toBe(neg.label);
    expect(over.decided_by).toBe("gate:criticalFail");
    expect(withRecordedOutcome(ev, { outcome_code: ev.outcome.code, outcome_class: ev.class, backstop_applied: false }, () => null)).toBe(ev);
  });
});

describe("progression evidence", () => {
  it("targets a version by what its mappings point at, ids inside the frozen snapshots, and the instrument", () => {
    const refs = targetRefs(U(1), [{ ref_id: U(2), ref_snapshot: { wording: "w", parent_id: U(3), note: "x_id" } }, { ref_id: null, ref_snapshot: { other_id: U(4) } }]);
    expect(refs.sort()).toEqual([U(1), U(2), U(3), U(4)].sort());
  });
  it("builds an evidence record and reads the critical failure from the stored trace", () => {
    const e = evidenceRecord({ outcomeId: "o1", attestation: "assessor_evaluated", methods: ["m"], assessorId: "a", submittedAt: "2026-11-01T00:00:00Z", outcomeClass: "negative", outcomeCode: "NOT", groupMin: { g: 2 },
      trace: { steps: [{ kind: "gate", gate: "criticalFail", triggered: true }] }, backstopDetail: {} });
    expect(e.critical_failed).toBe(true);
    expect(e.group_min_ordinal).toEqual({ g: 2 });
    const ok = evidenceRecord({ outcomeId: "o2", attestation: "assessor_evaluated", methods: [], assessorId: null, submittedAt: "2026-11-01T00:00:00Z", outcomeClass: "positive", outcomeCode: "ACH", groupMin: {}, trace: {}, backstopDetail: {} });
    expect(ok.critical_failed).toBe(false);
    expect(evidenceRecord({ ...{ outcomeId: "o3", attestation: "assessor_evaluated", methods: [], assessorId: null, submittedAt: "2026-11-01T00:00:00Z", outcomeClass: "negative", outcomeCode: "NOT", groupMin: {}, trace: {} }, backstopDetail: { criticalFailed: ["k"] } }).critical_failed).toBe(true);
  });
  it("a decision is valid for the window counted from the oldest qualifying evidence", () => {
    const ev: any = [{ submitted_at: "2026-01-01T00:00:00Z" }, { submitted_at: "2026-03-01T00:00:00Z" }];
    expect(validUntil({ evidence: { attestation: ["assessor_evaluated"], withinDays: 10 } } as any, ev)).toBe("2026-01-11T00:00:00.000Z");
    expect(validUntil({ evidence: { attestation: ["assessor_evaluated"] } } as any, ev)).toBeNull();
    expect(validUntil({ evidence: { attestation: ["assessor_evaluated"], withinDays: 10 } } as any, [])).toBeNull();
  });
});

// ── a small fake of the database client: enough to prove the revision rule in patchResponse ──────────────────────
function fakeAdmin(opts: { instance?: any; response?: { value: any; revision: number } | null; raceOnUpdate?: boolean }) {
  const store = { response: opts.response ?? null as { value: any; revision: number } | null, calls: [] as string[] };
  const chain = (table: string) => {
    const f: any = { table, filters: {} as Record<string, unknown>, op: "select", payload: null };
    const api: any = {
      select: () => api, insert: (p: any) => { f.op = "insert"; f.payload = p; return api; }, update: (p: any) => { f.op = "update"; f.payload = p; return api; }, delete: () => { f.op = "delete"; return api; },
      eq: (c: string, v: unknown) => { f.filters[c] = v; return api; }, in: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => {
        if (table === "asmt_instance") return { data: opts.instance && f.filters.respondent_id === opts.instance.respondent_id ? opts.instance : null, error: null };
        if (table === "asmt_response") return { data: store.response, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        store.calls.push("insert");
        store.response = { value: f.payload.value, revision: 1 };
        return { data: { revision: 1, value: f.payload.value, satisfactory: true }, error: null };
      },
      then: (res: any) => {
        if (table === "asmt_item") return res({ data: [{ id: "i1", stable_key: "K" }], error: null });
        if (table === "asmt_response" && f.op === "update") {
          store.calls.push("update");
          if (opts.raceOnUpdate || f.filters.revision !== store.response?.revision) return res({ data: [], error: null });
          store.response = { value: f.payload.value, revision: store.response!.revision + 1 };
          return res({ data: [{ revision: store.response.revision, value: store.response.value, satisfactory: true }], error: null });
        }
        if (table === "asmt_response" && f.op === "delete") { store.calls.push("delete"); store.response = null; return res({ data: null, error: null }); }
        return res({ data: [], error: null });
      },
    };
    return api;
  };
  return { admin: { from: chain } as any, store };
}

describe("patchResponse (optimistic concurrency)", () => {
  const actor = U(50);
  const inst = { id: U(60), instrument_version_id: U(70), respondent_id: actor, respondent_role: "assessor", status: "in_progress" };
  it("refuses an instance that is not the actor's", async () => {
    const { admin } = fakeAdmin({ instance: inst });
    const r = await patchResponse(admin, U(51), inst.id, "K", { level_code: "L3" }, 0);
    expect(r.ok).toBe(false);
    expect((r as any).status).toBe(404);
  });
  it("inserts the first answer at revision 0", async () => {
    const { admin, store } = fakeAdmin({ instance: inst });
    const r = await patchResponse(admin, actor, inst.id, "K", { level_code: "L3" }, 0);
    expect(r.ok).toBe(true);
    expect(store.calls).toEqual(["insert"]);
  });
  it("updates with the revision the caller saw", async () => {
    const { admin } = fakeAdmin({ instance: inst, response: { value: { level_code: "L1" }, revision: 2 } });
    const r = await patchResponse(admin, actor, inst.id, "K", { level_code: "L4" }, 2);
    expect(r.ok && r.revision).toBe(3);
  });
  it("answers 409 with the server row when the revision is stale, and writes nothing", async () => {
    const { admin, store } = fakeAdmin({ instance: inst, response: { value: { level_code: "L1" }, revision: 5 } });
    const r = await patchResponse(admin, actor, inst.id, "K", { level_code: "L4" }, 2);
    expect(r.ok).toBe(false);
    expect((r as any).status).toBe(409);
    expect((r as any).server).toEqual({ value: { level_code: "L1" }, revision: 5 });
    expect(store.calls).toEqual([]);
  });
  it("answers 409 when the row appears but the caller thought there was none", async () => {
    const { admin } = fakeAdmin({ instance: inst, response: { value: { level_code: "L1" }, revision: 1 } });
    const r = await patchResponse(admin, actor, inst.id, "K", { level_code: "L4" }, 0);
    expect((r as any).status).toBe(409);
  });
  it("loses a race cleanly: the update matches nothing and the server row comes back", async () => {
    const { admin } = fakeAdmin({ instance: inst, response: { value: { level_code: "L1" }, revision: 2 }, raceOnUpdate: true });
    const r = await patchResponse(admin, actor, inst.id, "K", { level_code: "L4" }, 2);
    expect((r as any).status).toBe(409);
  });
  it("clears an answer when the value is null, with the revision check", async () => {
    const { admin, store } = fakeAdmin({ instance: inst, response: { value: { level_code: "L1" }, revision: 2 } });
    const stale = await patchResponse(admin, actor, inst.id, "K", null, 1);
    expect((stale as any).status).toBe(409);
    const ok = await patchResponse(admin, actor, inst.id, "K", null, 2);
    expect(ok.ok).toBe(true);
    expect(store.calls).toEqual(["delete"]);
  });
  it("refuses a key that is not an item of the checklist, and a bad answer", async () => {
    const { admin } = fakeAdmin({ instance: inst });
    expect((await patchResponse(admin, actor, inst.id, "NOPE", { level_code: "L3" }, 0) as any).status).toBe(400);
    expect((await patchResponse(admin, actor, inst.id, "K", { level_code: null }, 0) as any).status).toBe(400);
    expect((await patchResponse(admin, actor, inst.id, "K", { level_code: "L3" }, -1) as any).status).toBe(400);
  });
  it("refuses a change to a submitted instance", async () => {
    const { admin } = fakeAdmin({ instance: { ...inst, status: "submitted" } });
    expect((await patchResponse(admin, actor, inst.id, "K", { level_code: "L3" }, 0) as any).status).toBe(409);
  });
});

// ── autosave ─────────────────────────────────────────────────────────────────────────────────────────────────────
class Mem implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe("autosave queue", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const mk = (send: (k: string, v: any, r: number) => Promise<SendResult>, storage: StorageLike | null = new Mem(), rev: Record<string, number> = {}) => {
    const statuses: string[] = []; const conflicts: any[] = [];
    const q = new PatchQueue({ instanceId: "I", send, storage, onStatus: s => statuses.push(s), onConflict: c => conflicts.push(c), retryMs: 5000 }, rev);
    return { q, statuses, conflicts, storage };
  };

  it("waits ~800 ms of quiet and sends only the last value of a key", async () => {
    const send = vi.fn(async () => ({ kind: "ok", revision: 1 }) as SendResult);
    const { q, statuses } = mk(send);
    q.enqueue("k", { level_code: "L1" });
    q.enqueue("k", { level_code: "L2" });
    await vi.advanceTimersByTimeAsync(799);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("k", { level_code: "L2" }, 0);
    expect(statuses).toEqual(["saving", "saved"]);
    expect(q.unsaved).toBe(0);
  });

  it("sends the revision it last saw and updates it", async () => {
    const send = vi.fn(async (_k: string, _v: any, r: number) => ({ kind: "ok", revision: r + 1 }) as SendResult);
    const { q } = mk(send, new Mem(), { k: 4 });
    q.enqueue("k", { level_code: "L1" }); await q.flush();
    q.enqueue("k", { level_code: "L2" }); await q.flush();
    expect(send.mock.calls.map(c => c[2])).toEqual([4, 5]);
    expect(q.revisionOf("k")).toBe(6);
  });

  it("keeps unsaved work in session storage, and a new session replays it", async () => {
    const mem = new Mem();
    const down = vi.fn(async () => ({ kind: "offline" }) as SendResult);
    const a = mk(down, mem);
    a.q.enqueue("k", { level_code: "L3" }); await a.q.flush();
    expect(a.q.status).toBe("offline");
    expect(readPending(mem, "I")).toEqual({ k: { level_code: "L3" } });
    a.q.dispose();
    const up = vi.fn(async () => ({ kind: "ok", revision: 1 }) as SendResult);
    const b = mk(up, mem);
    const left = b.q.replay();
    expect(left).toEqual({ k: { level_code: "L3" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(up).toHaveBeenCalledWith("k", { level_code: "L3" }, 0);
    expect(readPending(mem, "I")).toEqual({});
    expect(b.q.status).toBe("saved");
  });

  it("goes offline on a failed send, keeps everything, and retries on its own", async () => {
    let calls = 0;
    const send = vi.fn(async () => (++calls < 3 ? ({ kind: "offline" } as SendResult) : ({ kind: "ok", revision: 1 } as SendResult)));
    const { q, statuses } = mk(send);
    q.enqueue("k", { level_code: "L1" });
    await vi.advanceTimersByTimeAsync(900);
    expect(q.status).toBe("offline");
    expect(q.unsaved).toBe(1);
    await vi.advanceTimersByTimeAsync(5100);
    await vi.advanceTimersByTimeAsync(5100);
    expect(q.status).toBe("saved");
    expect(statuses).toContain("offline");
    expect(q.unsaved).toBe(0);
  });

  it("treats a thrown send as offline", async () => {
    const { q } = mk(async () => { throw new Error("network"); });
    q.enqueue("k", { level_code: "L1" }); await q.flush();
    expect(q.status).toBe("offline");
    expect(q.unsaved).toBe(1);
    q.dispose();
  });

  it("stops at a conflict, reports both versions, and resolves either way", async () => {
    const send = vi.fn(async (_k: string, _v: any, r: number) => (r === 0 ? ({ kind: "conflict", server: { value: { level_code: "L5" }, revision: 7 } } as SendResult) : ({ kind: "ok", revision: r + 1 } as SendResult)));
    const { q, conflicts } = mk(send);
    q.enqueue("k", { level_code: "L2" }); await q.flush();
    expect(q.status).toBe("conflict");
    expect(conflicts[0].mine).toEqual({ level_code: "L2" });
    expect(conflicts[0].server.revision).toBe(7);
    expect(q.unsaved).toBe(0);
    q.resolve("k", "mine"); await q.flush();
    expect(send).toHaveBeenLastCalledWith("k", { level_code: "L2" }, 7);
    expect(q.status).toBe("saved");
    // use theirs
    send.mockImplementationOnce(async () => ({ kind: "conflict", server: { value: { level_code: "L1" }, revision: 9 } }));
    q.enqueue("j", { level_code: "L6" }); await q.flush();
    expect(q.resolve("j", "theirs")).toEqual({ level_code: "L1" });
    expect(q.revisionOf("j")).toBe(9);
    expect(q.status).toBe("saved");
  });

  it("a rejected answer is dropped from the queue and reported, not retried for ever", async () => {
    const rejected: string[] = [];
    const q = new PatchQueue({ instanceId: "I", send: async () => ({ kind: "rejected", message: "bad" }), storage: new Mem(), onRejected: (k, m) => rejected.push(`${k}:${m}`) }, {});
    q.enqueue("k", { level_code: "L1" }); await q.flush();
    expect(rejected).toEqual(["k:bad"]);
    expect(q.unsaved).toBe(0);
  });

  it("survives a blocked or damaged store", async () => {
    const bad: StorageLike = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    const { q } = mk(async () => ({ kind: "ok", revision: 1 }), bad);
    expect(q.replay()).toEqual({});
    q.enqueue("k", { level_code: "L1" }); await q.flush();
    expect(q.status).toBe("saved");
    expect(readPending({ getItem: () => "{not json", setItem() {}, removeItem() {} }, "I")).toEqual({});
  });

  it("a change made while a send is in flight is not lost", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const send = vi.fn(async (_k: string, v: any) => { if (v.level_code === "L1") await gate; return { kind: "ok", revision: 1 } as SendResult; });
    const { q } = mk(send);
    q.enqueue("k", { level_code: "L1" });
    const first = q.flush();
    q.enqueue("k", { level_code: "L2" });
    release(); await first;
    await q.flush();
    expect(send.mock.calls.map(c => c[1].level_code)).toEqual(["L1", "L2"]);
    expect(q.unsaved).toBe(0);
  });
});

// keep the unused fixture import honest
void RA;
