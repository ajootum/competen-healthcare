import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DRAFT_PREFIX, guardDrafts, hasDrafts, saveOpenNotes, sweepDrafts, trackOpenNote } from "./note-drafts";

const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002";
const K1 = `${DRAFT_PREFIX}${A}:k1`, K2 = `${DRAFT_PREFIX}${A}:k2`, K3 = `${DRAFT_PREFIX}${B}:k3`, OTHER = "sb-collapsed";

function store(keys: string[] = [K1, K2, K3, OTHER]) {
  const m = new Map(keys.map(k => [k, "x"]));
  return { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, removeItem: (k: string) => void m.delete(k), keys: () => [...m.keys()] };
}

describe("sweepDrafts", () => {
  it("nobody signed in: every draft goes, including words the server refused, and nothing else on the device", () => {
    const s = store();
    expect(sweepDrafts(s, null)).toBe(3);
    expect(s.keys()).toEqual([OTHER]);
  });
  it("one learner signed in: their drafts stay, another's go, however many there are", () => {
    const s = store();
    expect(sweepDrafts(s, A)).toBe(1);
    expect(s.keys()).toEqual([K1, K2, OTHER]);
  });
  it("an id that merely starts with the learner's does not stay", () => {
    const s = store([`${DRAFT_PREFIX}${A}x:k`]);
    sweepDrafts(s, A);
    expect(s.keys()).toEqual([]);
  });
});

describe("guardDrafts", () => {
  it("no draft on the device: does not ask who is signed in", async () => {
    const ask = vi.fn();
    const s = store([OTHER]);
    expect(hasDrafts(s)).toBe(false);
    await guardDrafts(s, ask);
    expect(ask).not.toHaveBeenCalled();
  });
  it("a session that has ended takes them all", async () => {
    const s = store();
    await guardDrafts(s, async () => ({ userId: null, failed: false }));
    expect(s.keys()).toEqual([OTHER]);
  });
  it("another account takes the last learner's", async () => {
    const s = store();
    await guardDrafts(s, async () => ({ userId: B, failed: false }));
    expect(s.keys()).toEqual([K3, OTHER]);
  });
  it("the same learner keeps theirs", async () => {
    const s = store([K1, K2]);
    await guardDrafts(s, async () => ({ userId: A, failed: false }));
    expect(s.keys()).toEqual([K1, K2]);
  });
  it("no answer, as on a lost connection: nothing changes", async () => {
    const s = store();
    await guardDrafts(s, async () => ({ userId: null, failed: true }));
    expect(s.keys()).toEqual([K1, K2, K3, OTHER]);
  });
});

describe("saveOpenNotes", () => {
  it("waits for an open note, and a stuck one cannot hold the sign-out up", async () => {
    vi.useFakeTimers();
    const untrack = trackOpenNote({ sendAndWait: () => new Promise(() => {}) });
    let done = false;
    const p = saveOpenNotes(2000).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
    untrack();
    vi.useRealTimers();
  });
});

describe("every way out is wired", () => {
  it("the Individual sign-out saves, then closes drafts, then signs out", () => {
    const code = readFileSync("src/app/individual/_components/ShellNav.tsx", "utf8");
    expect(code).toMatch(/await saveOpenNotes\(\); closeNoteDrafts\(\); await createClient\(\)\.auth\.signOut\(\)/);
  });
  it("the guard is on every page, in the root layout", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toMatch(/<NoteDraftGuard \/>/);
  });
});
