import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_DELAY_MS, DRAFT_DELAY_MS, NoteSaver, RETRY_BACKOFF_MS, statusWords, type SendReply, type SendRequest } from "./note-saver";
import { FREE_CONTEXT, draftKeyOf } from "./personal-notebook";

const KEY = "11111111-1111-4111-8111-111111111111", USER = "u1";
type Pending = { req: SendRequest; resolve: (r: SendReply) => void };

function rig(start: Partial<ConstructorParameters<typeof NoteSaver>[1]> = {}, storageOn = true) {
  const sent: Pending[] = [];
  const store = new Map<string, string>();
  const saver = new NoteSaver({
    send: req => new Promise<SendReply>(resolve => { sent.push({ req, resolve }); }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    storage: storageOn ? { get: k => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: k => void store.delete(k) } : null,
  }, { userId: USER, clientKey: KEY, context: FREE_CONTEXT, ...start });
  return { saver, sent, store, draft: () => store.get(draftKeyOf(USER, KEY)) ?? null };
}
const ok = (revision: number): SendReply => ({ kind: "ok", id: "note-1", revision });
const settle = async () => { await vi.advanceTimersByTimeAsync(0); };

describe("NoteSaver: autosave", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("waits for typing to pause, then saves once, as a first save carrying its client key", async () => {
    const { saver, sent } = rig();
    saver.setBody("An i");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    saver.setBody("An idea");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(sent).toHaveLength(0);
    expect(saver.getSnapshot().status).toBe("typing");
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].req).toMatchObject({ op: "create", clientKey: KEY, body: "An idea" });
    expect(saver.getSnapshot().status).toBe("saving");
    sent[0].resolve(ok(1)); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "saved", id: "note-1", revision: 1, dirty: false });
  });

  it("never saves a blank note, and never replaces saved words with nothing", async () => {
    const { saver, sent } = rig();
    saver.setBody("   ");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(sent).toHaveLength(0);
    saver.setBody("Words");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve(ok(1)); await settle();
    saver.setBody("");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it("sends one save at a time, and the newest words win: typing during a save is sent after it, from its revision", async () => {
    const { saver, sent } = rig();
    saver.setBody("one");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.setBody("one two");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(sent).toHaveLength(1);
    sent[0].resolve(ok(1)); await settle();
    expect(saver.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[1].req).toMatchObject({ op: "update", id: "note-1", expectedRevision: 1, body: "one two" });
    sent[1].resolve(ok(2)); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "saved", revision: 2, dirty: false });
  });

  it("sends only what changed on an update", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 4, body: "same", title: "T", tags: ["a"] });
    saver.setTitle("New title");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[0].req).toEqual({ op: "update", id: "note-1", expectedRevision: 4, keepalive: false, title: "New title" });
  });

  it("keeps a pin in the same queue as the words, against the same revision, and follows a first save with it", async () => {
    const { saver, sent } = rig();
    saver.setBody("words");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.patch({ pinned: true });
    await settle();
    expect(sent).toHaveLength(1);
    sent[0].resolve(ok(1)); await settle();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[1].req).toMatchObject({ op: "update", expectedRevision: 1, pinned: true });
  });
});

describe("NoteSaver: nothing is lost", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps a draft while unconfirmed, and removes it when the server confirms the same words", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("Not yet saved");
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(JSON.parse(draft()!)).toMatchObject({ clientKey: KEY, body: "Not yet saved", noteId: null });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve(ok(1)); await settle();
    expect(draft()).toBeNull();
  });

  it("network loss: says so, keeps the draft, backs off, retries with the SAME client key, and saves", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("Offline thought");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "retry" }); await settle();
    expect(saver.getSnapshot().status).toBe("retrying");
    expect(saver.getSnapshot().message).toMatch(/kept on this device/);
    expect(draft()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0] - 1);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent[1].req).toMatchObject({ op: "create", clientKey: KEY, body: "Offline thought" });
    sent[1].resolve({ kind: "retry" }); await settle();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[1]);
    expect(sent).toHaveLength(3);
    sent[2].resolve(ok(1)); await settle();
    expect(saver.getSnapshot().status).toBe("saved");
    expect(draft()).toBeNull();
  });

  it("the connection returning tries at once, whatever the backoff said", async () => {
    const { saver, sent } = rig();
    saver.setBody("x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "retry" }); await settle();
    saver.online();
    await settle();
    expect(sent).toHaveLength(2);
  });

  it("a send that throws is a retry, never an unhandled failure", async () => {
    const saver = new NoteSaver({ send: () => Promise.reject(new Error("boom")), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>), now: () => 0, storage: null }, { userId: USER, clientKey: KEY, context: FREE_CONTEXT });
    saver.setBody("x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.getSnapshot().status).toBe("retrying");
  });

  it("a retried first save that finds our own earlier words (revision 1) sends the newer words as an update", async () => {
    const { saver, sent } = rig();
    saver.setBody("newer words");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "ok", id: "note-1", revision: 1, stored: { body: "older", title: null, tags: [] } }); await settle();
    expect(saver.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[1].req).toMatchObject({ op: "update", expectedRevision: 1, body: "newer words" });
  });

  it("a restored draft that finds the note edited since (above revision 1) asks: old words never overwrite newer ones", async () => {
    const { saver, sent } = rig();
    saver.setBody("words from before");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "ok", id: "note-1", revision: 3, stored: { body: "edited on my phone", title: null, tags: [] } }); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "conflict", id: "note-1", revision: 3, other: { body: "edited on my phone", revision: 3 } });
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[4]);
    expect(sent).toHaveLength(1);
  });

  it("a refusal (a patient identifier) stops, says why and keeps the words here. Changing them sends again", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("MRN 1234567");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "refused", message: "That looks like it could identify a patient." }); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "refused", dirty: true });
    expect(draft()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[4]);
    expect(sent).toHaveLength(1);
    saver.setBody("A safe thought");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent).toHaveLength(2);
  });

  it("signed out: says so, keeps nothing on the device, does not hammer the server", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "signed_out" }); await settle();
    expect(saver.getSnapshot().status).toBe("signed_out");
    expect(saver.getSnapshot().message).toContain("on this screen only");
    expect(draft()).toBeNull();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[4]);
    expect(sent).toHaveLength(1);
  });

  it("signed out: writing on keeps no draft, and a save the server takes starts keeping them again", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "signed_out" }); await settle();
    saver.setBody("xy");
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(draft()).toBeNull();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[sent.length - 1].resolve(ok(1)); await settle();
    saver.setBody("xyz");
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(draft()).not.toBeNull();
  });

  it("sendAndWait sends what is waiting and waits for the answer", async () => {
    const { saver, sent } = rig();
    saver.setBody("words");
    let done = false;
    const s = saver.sendAndWait().then(() => { done = true; });
    await settle();
    expect(sent).toHaveLength(1);
    expect(done).toBe(false);
    sent[0].resolve(ok(1)); await s;
    expect(saver.getSnapshot().status).toBe("saved");
  });

  it("a note removed elsewhere keeps the words and saves them as a new note on the next change", async () => {
    const { saver, sent, draft } = rig({ id: "note-1", revision: 2, body: "old" });
    saver.setBody("still mine");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "gone" }); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "failed", id: null });
    expect(draft()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[4]);
    expect(sent).toHaveLength(1); // not recreated by itself, only if they write on
    saver.setBody("still mine, more");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[1].req).toMatchObject({ op: "create", body: "still mine, more" });
  });

  it("works with no device storage at all", async () => {
    const { saver, sent } = rig({}, false);
    saver.setBody("x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve(ok(1)); await settle();
    expect(saver.getSnapshot().status).toBe("saved");
  });

  it("restoring a draft sends its words without another keystroke", async () => {
    const { sent } = rig({ body: "recovered", dirtyFromDraft: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[0].req).toMatchObject({ op: "create", body: "recovered" });
  });
});

describe("NoteSaver: a copy changed elsewhere", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const other = { body: "from my phone", title: null, tags: [], revision: 9 };

  it("is never overwritten: it stops and asks", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "old" });
    saver.setBody("from my laptop");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "conflict", current: other }); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "conflict", other, body: "from my laptop" });
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[4]);
    expect(sent).toHaveLength(1);
  });

  it("a refusal whose stored words equal ours is our own lost reply: saved, not a conflict", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "old" });
    saver.setBody("landed");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "conflict", current: { body: "landed", title: "", tags: [], revision: 3 } }); await settle();
    expect(saver.getSnapshot()).toMatchObject({ status: "saved", revision: 3, dirty: false, other: null });
  });

  it("keep mine saves over it from its revision. Use the other takes it and drops the draft", async () => {
    const a = rig({ id: "note-1", revision: 2, body: "old" });
    a.saver.setBody("mine");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    a.sent[0].resolve({ kind: "conflict", current: other }); await settle();
    a.saver.keepMine();
    await settle();
    expect(a.sent[1].req).toMatchObject({ op: "update", expectedRevision: 9, body: "mine" });

    const b = rig({ id: "note-1", revision: 2, body: "old" });
    b.saver.setBody("mine");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    b.sent[0].resolve({ kind: "conflict", current: other }); await settle();
    b.saver.useOther();
    expect(b.saver.getSnapshot()).toMatchObject({ status: "saved", body: "from my phone", revision: 9, dirty: false });
    expect(b.draft()).toBeNull();
  });
});

describe("NoteSaver: removing a note", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("words waiting to save are never sent after Remove, and the draft goes", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("Do not keep this");
    await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
    expect(draft()).not.toBeNull();
    expect(await saver.discard()).toBeNull();
    saver.flush();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[4]);
    expect(sent).toHaveLength(0);
    expect(draft()).toBeNull();
  });

  it("a save already on its way is waited for, and its id returned so it can be removed too, with no draft left", async () => {
    const { saver, sent, draft } = rig();
    saver.setBody("On its way");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    const out = saver.discard();
    sent[0].resolve(ok(1)); await settle();
    expect(await out).toBe("note-1");
    expect(draft()).toBeNull();
  });

  it("a failed removal resumes saving", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "old" });
    saver.setBody("new words");
    await saver.discard();
    saver.resume();
    await settle();
    expect(sent[0].req).toMatchObject({ op: "update", body: "new words" });
  });
});

describe("NoteSaver: the corners a review found", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a lost reply and more typing is not a conflict: the stored words are an earlier send of ours", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "old" });
    saver.setBody("first");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve({ kind: "retry" }); await settle();
    saver.setBody("first and second");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[1].resolve({ kind: "conflict", current: { body: "first", title: "", tags: [], revision: 3 } }); await settle();
    expect(saver.getSnapshot().status).toBe("typing");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[2].req).toMatchObject({ op: "update", expectedRevision: 3, body: "first and second" });
  });

  it("a pin refused for an old revision, with the same words, goes again and is not lost", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "same" });
    saver.patch({ pinned: true });
    await settle();
    sent[0].resolve({ kind: "conflict", current: { body: "same", title: "", tags: [], revision: 5 } }); await settle();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[1].req).toMatchObject({ op: "update", expectedRevision: 5, pinned: true });
  });

  it("a highlight with no comment can still be pinned, and its comment can be emptied", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "", allowBlank: true });
    saver.patch({ pinned: true });
    await settle();
    expect(sent[0].req).toMatchObject({ op: "update", pinned: true });
    sent[0].resolve(ok(3)); await settle();
    const b = rig({ id: "note-2", revision: 2, body: "a comment", allowBlank: true });
    b.saver.setBody("");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(b.sent[0].req).toMatchObject({ op: "update", body: null });
  });

  it("a note emptied by mistake is never saved blank, and a pin does not stick on Saving", async () => {
    const { saver, sent } = rig({ id: "note-1", revision: 2, body: "words" });
    saver.setBody("");
    saver.patch({ pinned: true });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent).toHaveLength(0);
    expect(saver.getSnapshot().status).toBe("idle");
  });

  it("unlinked while the first save was on its way: the note follows the screen", async () => {
    const lesson = { ...FREE_CONTEXT, link: { targetKind: "lesson" as const, sessionId: "s", step: 0, materialId: null, chunkId: null } };
    const { saver, sent } = rig({ context: lesson });
    saver.setBody("x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.setContext(FREE_CONTEXT);
    sent[0].resolve(ok(1)); await settle();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(sent[1].req).toMatchObject({ op: "update", expectedRevision: 1, link: { targetKind: "free" } });
  });
});

describe("NoteSaver: a refused link can be corrected", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a new link after a refusal is sent, not left waiting for the words to change", async () => {
    const { saver, sent } = rig();
    saver.setBody("A thought");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    sent[0].resolve(ok(1)); await settle();
    saver.patch({ link: { targetKind: "topic", topic: "MRN 1234567" } });
    await vi.advanceTimersByTimeAsync(0);
    sent[1].resolve({ kind: "refused", message: "That looks like it could identify a patient." }); await settle();
    expect(saver.getSnapshot().status).toBe("refused");
    saver.patch({ link: { targetKind: "topic", topic: "Motor milestones" } });
    expect(saver.getSnapshot()).toMatchObject({ status: "typing", message: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(3);
    expect(JSON.stringify(sent[2].req)).toContain("Motor milestones");
    expect(JSON.stringify(sent[2].req)).not.toContain("MRN");
    sent[2].resolve(ok(2)); await settle();
    expect(saver.getSnapshot().status).toBe("saved");
  });
});

describe("statusWords", () => {
  it("says each state in words", () => {
    const s = (status: Parameters<typeof statusWords>[0]["status"], message: string | null = null) => statusWords({ status, message, dirty: false });
    expect(s("saving")).toBe("Saving…");
    expect(s("saved")).toBe("Saved");
    expect(s("retrying", "Not saved yet.")).toBe("Not saved yet.");
    expect(s("idle")).toBe("");
  });
});
