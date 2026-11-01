import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PositionSync, SYNC_INTERVAL_MS, decidePositionWrite, mergeResume, nextSeq, parsePositionPut, type PositionDraft, type PositionPut, type ServerPosition, type SyncResult } from "./learn-position";

// SCHOLAR-CONTINUITY-01 item 1: the stale-write rule (mirrored by migration 790's write function), where the workspace
// opens, and when the page writes. The SQL function itself is exercised on staging (VERIFY-790, same scenarios).

const stored = (over: Partial<ServerPosition> = {}): ServerPosition => ({
  step: 5, furthestStep: 6, cardId: "lesson-5", sectionChunkId: null, offsetHint: null, lastCompletedActivity: "read:5", lastCompletedAt: "2026-10-31T10:00:00.000Z",
  unfinished: null, deviceId: "deviceAAAA", clientSeq: 100, clientUpdatedAt: "2026-10-31T10:00:00.000Z", revision: 10, updatedAt: "2026-10-31T10:00:01.000Z", ...over,
});
const put = (over: Partial<PositionPut> = {}): PositionPut => ({
  step: 2, furthestStep: 2, cardId: "lesson-2", sectionChunkId: null, offsetHint: null, lastCompletedActivity: null, lastCompletedAt: null,
  unfinished: null, deviceId: "deviceBBBB", clientSeq: 1, baseRevision: null, clientUpdatedAt: "2026-10-31T11:00:00.000Z", ...over,
});

describe("the stale-write rule (790)", () => {
  it("the first write is taken", () => {
    const r = decidePositionWrite(null, put());
    expect(r).toMatchObject({ accepted: true, reason: "first" });
    expect(r.next.revision).toBe(1);
  });
  it("the same device, in order: a deliberate jump back is recorded", () => {
    const r = decidePositionWrite(stored(), put({ deviceId: "deviceAAAA", clientSeq: 101, step: 1 }));
    expect(r).toMatchObject({ accepted: true, reason: "same_device" });
    expect(r.next.step).toBe(1);
    expect(r.next.furthestStep).toBe(6); // the furthest lesson reached never shrinks
    expect(r.next.revision).toBe(11);
  });
  it("the same device, out of order (a late retry or a duplicate): refused", () => {
    expect(decidePositionWrite(stored(), put({ deviceId: "deviceAAAA", clientSeq: 100, step: 9 })).accepted).toBe(false);
    expect(decidePositionWrite(stored(), put({ deviceId: "deviceAAAA", clientSeq: 99, step: 9 })).accepted).toBe(false);
  });
  it("another device that has seen the latest position may move back", () => {
    const r = decidePositionWrite(stored(), put({ baseRevision: 10, step: 1, clientUpdatedAt: "2026-10-31T09:00:00.000Z" }));
    expect(r).toMatchObject({ accepted: true, reason: "informed" });
    expect(r.next.step).toBe(1);
  });
  it("a STALE device cannot regress the step, even with a later clock", () => {
    const r = decidePositionWrite(stored(), put({ baseRevision: 9, step: 2 }));
    expect(r).toMatchObject({ accepted: false, reason: "stale" });
    expect(r.next).toEqual(stored());
  });
  it("a stale device with older completion and a lower step cannot erase the later completion", () => {
    const r = decidePositionWrite(stored(), put({ step: 3, lastCompletedActivity: "read:3", lastCompletedAt: "2026-10-31T09:00:00.000Z" }));
    expect(r.accepted).toBe(false);
  });
  it("a stale device may still record PROGRESS: a further step, later in time", () => {
    const r = decidePositionWrite(stored(), put({ step: 7, furthestStep: 7 }));
    expect(r).toMatchObject({ accepted: true, reason: "progress" });
    expect(r.next).toMatchObject({ step: 7, furthestStep: 7, lastCompletedActivity: "read:5", revision: 11 });
  });
  it("... or a newer completion, later in time", () => {
    const r = decidePositionWrite(stored(), put({ step: 4, lastCompletedActivity: "practised:4", lastCompletedAt: "2026-10-31T10:30:00.000Z" }));
    expect(r).toMatchObject({ accepted: true, reason: "progress" });
    expect(r.next.lastCompletedActivity).toBe("practised:4");
  });
  it("progress with an EARLIER device time is refused (a queued old write)", () => {
    expect(decidePositionWrite(stored(), put({ step: 9, clientUpdatedAt: "2026-10-31T09:59:00.000Z" })).accepted).toBe(false);
  });
  it("a refused write still grows furthest_step (a grow-only maximum), and nothing else", () => {
    const r = decidePositionWrite(stored(), put({ step: 2, furthestStep: 9 }));
    expect(r.accepted).toBe(false);
    expect(r.next).toEqual({ ...stored(), furthestStep: 9, revision: 11 });
  });
  it("the SQL function decides in the same order, on the same fields", () => {
    const sql = readFileSync("supabase/migrations/790-individual-scholar-learning-position.sql", "utf8").replace(/\r\n/g, "\n");
    const fn = sql.slice(sql.indexOf("create or replace function public.individual_scholar_learning_position_put"));
    const order = ["if p_device_id = cur.device_id then", "ok := p_client_seq > cur.client_seq", "elsif p_base_revision is not null and p_base_revision = cur.revision then",
      "elsif p_client_updated_at > cur.client_updated_at and (p_step > cur.step or newer_completion) then", "why := 'stale'"];
    let at = -1;
    for (const o of order) { const i = fn.indexOf(o); expect(i, o).toBeGreaterThan(at); at = i; }
    expect(fn).toContain("security invoker");
  });
});

describe("the PUT body", () => {
  const now = Date.parse("2026-10-31T11:00:00.000Z");
  const ok = { deviceId: "deviceBBBB", clientSeq: 5, baseRevision: 3, clientUpdatedAt: "2026-10-31T10:59:00.000Z", step: 2, furthestStep: 4, cardId: "lesson-2:practice", sectionChunkId: null, offsetHint: 40, lastCompletedActivity: null, lastCompletedAt: null, unfinished: { practiceOpen: 2, text: "never kept" } };
  it("a sound one is read, and practice state keeps only known numbers (no text)", () => {
    const r = parsePositionPut(ok, now);
    expect(r.ok && r.value).toMatchObject({ step: 2, furthestStep: 4, cardId: "lesson-2:practice", unfinished: { v: 1, practiceOpen: 2 } });
    expect(JSON.stringify(r.ok && r.value.unfinished)).not.toContain("never kept");
  });
  it.each([
    ["device", { deviceId: "x" }], ["step", { step: -1 }], ["card", { cardId: "Lesson 2" }], ["offset", { offsetHint: 101 }],
    ["time", { clientUpdatedAt: "2026-10-31T12:00:00.000Z" }], ["completion", { lastCompletedActivity: "read:2" }], ["section", { sectionChunkId: "nope" }],
  ])("refuses a bad %s", (field, over) => {
    expect(parsePositionPut({ ...ok, ...over }, now)).toEqual({ ok: false, error: field });
  });
});

describe("where the workspace opens", () => {
  const steps = [0, 1, 2, 3, 4, 5, 6, 7];
  it("the server wins when its device time is later than this device's copy", () => {
    const r = mergeResume({ steps, fallback: 0, local: { anchor: 2, revealedUpTo: 3, updatedAt: "2026-10-31T09:00:00.000Z" }, server: stored({ unfinished: { v: 1, practiceOpen: 5 } }) });
    expect(r).toEqual({ anchor: 5, revealedUpTo: 6, from: "server", practiceOpen: 5 });
  });
  it("this device wins when its copy is later, and still reveals as far as the server knows", () => {
    const r = mergeResume({ steps, fallback: 0, local: { anchor: 2, revealedUpTo: 3, updatedAt: "2026-10-31T12:00:00.000Z" }, server: stored() });
    expect(r).toEqual({ anchor: 2, revealedUpTo: 6, from: "device", practiceOpen: null });
  });
  it("no server position (790 absent): the device copy, else the session's step", () => {
    expect(mergeResume({ steps, fallback: 4, local: null, server: null })).toMatchObject({ anchor: 4, from: "session" });
    expect(mergeResume({ steps, fallback: 4, local: { anchor: 1, revealedUpTo: 1, updatedAt: "x" }, server: null })).toMatchObject({ anchor: 1, from: "device" });
  });
  it("a server step no longer in the session is ignored", () => {
    expect(mergeResume({ steps: [0, 1], fallback: 0, local: null, server: stored() })).toMatchObject({ anchor: 0, from: "session" });
  });
});

describe("when the page writes (PositionSync)", () => {
  const draft = (step = 3, offset: number | null = 0): PositionDraft => ({ step, furthestStep: step, cardId: `lesson-${step}`, sectionChunkId: null, offsetHint: offset, lastCompletedActivity: null, lastCompletedAt: null, unfinished: null });
  function rig(answer: (p: PositionPut) => SyncResult = () => ({ provisioned: true, accepted: true, position: null })) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T10:00:00.000Z"));
    let current = draft();
    const sent: { p: PositionPut; keepalive: boolean }[] = [];
    const s = new PositionSync({ deviceId: "deviceAAAA", read: () => current, send: async (p, o) => { sent.push({ p, keepalive: o.keepalive }); return answer(p); } });
    return { s, sent, set: (d: PositionDraft) => { current = d; } };
  }
  it("scrolling never writes by itself: many scrolls make at most one write per interval", async () => {
    const { s, sent, set } = rig();
    for (let i = 0; i < 200; i++) { set(draft(3, i % 100)); s.touch(); await vi.advanceTimersByTimeAsync(50); }
    // 10 s of scrolling, the first write at once (no write before), then none until 15 s after it.
    expect(sent.length).toBe(1);
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
    expect(sent.length).toBe(2);
    vi.useRealTimers();
  });
  it("nothing is written when nothing happened, not even on hide", async () => {
    const { s, sent } = rig();
    s.hide();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
    vi.useRealTimers();
  });
  it("a meaningful event writes at once (a burst coalesces), and an unchanged position is not written again", async () => {
    const { s, sent } = rig();
    s.event("lesson"); s.event("activity");
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.length).toBe(1);
    s.event("jump");
    await vi.advanceTimersByTimeAsync(400);
    expect(sent.length).toBe(1);
    vi.useRealTimers();
  });
  it("hiding the page flushes what is dirty, with keepalive", async () => {
    const { s, sent, set } = rig();
    s.event("lesson"); await vi.advanceTimersByTimeAsync(400);
    set(draft(4)); s.touch(); s.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map(x => x.keepalive)).toEqual([false, true]);
    expect(sent[1].p.step).toBe(4);
    vi.useRealTimers();
  });
  it("each write carries a rising sequence and the revision seen; a refused write is dropped, not retried", async () => {
    const pos = stored({ revision: 42 });
    const { s, sent, set } = rig(() => ({ provisioned: true, accepted: false, position: pos }));
    s.event("lesson"); await vi.advanceTimersByTimeAsync(400);
    expect(sent[0].p.baseRevision).toBeNull();
    s.hide(); await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.length).toBe(1); // refused as stale: not sent again by itself
    set(draft(1)); s.event("jump"); await vi.advanceTimersByTimeAsync(400);
    expect(sent[1].p).toMatchObject({ baseRevision: 42, step: 1 }); // the learner's next move is an informed one
    expect(sent[1].p.clientSeq).toBeGreaterThan(sent[0].p.clientSeq);
    vi.useRealTimers();
  });
  it("790 absent: the first answer turns writing off for good (device-only)", async () => {
    const { s, sent } = rig(() => ({ provisioned: false }));
    s.event("lesson"); await vi.advanceTimersByTimeAsync(400);
    s.event("jump"); s.touch(); s.hide(); await vi.advanceTimersByTimeAsync(30_000);
    expect(sent.length).toBe(1);
    expect(s.disabled).toBe(true);
    vi.useRealTimers();
  });
  it("the sequence needs no storage and never goes back", () => {
    expect(nextSeq(5, 3)).toBe(6);
    expect(nextSeq(5, 1000)).toBe(1000);
  });
  it("the Learn workspace writes only through PositionSync and listens for hide, not for every scroll write", () => {
    const s = readFileSync("src/app/individual/(app)/[experience]/(scholar)/study/_components/learn-client.tsx", "utf8");
    // SCHOLAR-LEARN-GAPS-02: a scroll only NOTES a place (debounced 2 s, at most one commit per 15 s: learn-place.ts); it never touches the writer itself.
    expect(s).toContain('const onScroll = () => { if (engaged.current && !pendingPlace.current) placer.note(); };');
    expect(s).not.toMatch(/onScroll = \(\) => \{[^}]*sync\.touch\(\)/);
    expect(s).toContain('const placer = new PlaceScheduler({ commit: keepalive =>');
    expect(s).toContain('document.addEventListener("visibilitychange", onVisibility);');
    expect(s).toContain('window.addEventListener("pagehide", onHide);');
    expect(s.match(/method: "PUT"/g)?.length).toBe(1);
  });
});
