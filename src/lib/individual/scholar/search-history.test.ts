import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ASK_NOT_KEPT, HISTORY_ACTIVITIES, HISTORY_EMPTY, QUERY_MAX, REQUEST_KEY, SHOW_ACTIVITIES, entryLinks, entryTitle, hasHistoryFilters, historyParams, markKey, mergeHistoryPages, newRequestKey, normaliseQuery,
  panelFilterCount, parseEntryKey, parseHistoryQuery, repeatsLatest, saveTarget, splitEntryLinks, validateCapture, type HistoryEntry,
} from "./search-history";
import { clearSearchHistory, historySchema, listSearchHistory, recordSearchCapture, resetSearchHistorySchema } from "./store";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const KEY = "c:0123456789abcdef0123";

describe("SCHOLAR-SEARCH-HISTORY-01: what is kept", () => {
  it("keeps only a meaningful submission: never empty, one character, punctuation or control characters", () => {
    expect(normaliseQuery("  preload   and\tafterload ")).toBe("preload and afterload");
    expect(normaliseQuery("")).toBeNull();
    expect(normaliseQuery("   ")).toBeNull();
    expect(normaliseQuery("a")).toBeNull();
    expect(normaliseQuery("??")).toBeNull();
    expect(normaliseQuery(42)).toBeNull();
    expect(normaliseQuery("two\nlines")).toBe("two lines");
  });
  it("shortens a long question to at most 300 characters on a word boundary", () => {
    const long = "why ".repeat(120);
    const kept = normaliseQuery(long)!;
    expect(kept.length).toBeLessThanOrEqual(QUERY_MAX);
    expect(kept.endsWith("…")).toBe(true);
    expect(kept).not.toMatch(/wh…$/);
  });
  it("a capture is one of the three submitted activities, with a client key; references are dropped when malformed", () => {
    const ok = validateCapture({ activity: "ask", query: "Why does preload rise?", requestKey: KEY, sessionId: A, step: 2, materialId: "nope", resultCount: 5, topic: "x" });
    expect(ok).toEqual({ ok: true, entry: { activity: "ask", query: "Why does preload rise?", requestKey: KEY, materialId: null, chunkId: null, artefactId: null, sessionId: A, step: 2, topic: null, resultCount: null } });
    expect(validateCapture({ activity: "teaching", query: "x y", requestKey: KEY })).toEqual({ ok: false, problem: "activity" });
    expect(validateCapture({ activity: "keystroke", query: "x y", requestKey: KEY })).toEqual({ ok: false, problem: "activity" });
    expect(validateCapture({ activity: "material_search", query: " ", requestKey: KEY })).toEqual({ ok: false, problem: "query" });
    expect(validateCapture({ activity: "material_search", query: "sepsis", requestKey: "short" })).toEqual({ ok: false, problem: "key" });
    expect(validateCapture({ activity: "material_search", query: "sepsis", requestKey: KEY, step: 3 })).toMatchObject({ ok: true, entry: { step: null, sessionId: null } });
    expect(validateCapture({ activity: "material_search", query: "sepsis", requestKey: KEY, resultCount: 7 })).toMatchObject({ ok: true, entry: { resultCount: 7 } });
  });
  it("a fresh key per submission matches the 992 key CHECK", () => {
    const k = newRequestKey();
    expect(k).toMatch(REQUEST_KEY);
    expect(newRequestKey()).not.toBe(k);
    expect(newRequestKey(() => "aaaa-bbbb-cccc-dddd-eeee")).toBe("c:aaaabbbbccccddddeeee");
  });
  it("the same words again within two minutes are one entry; later, or other words, are a new one", () => {
    const latest = { activity: "ask", query: "Why does Preload rise?", createdAt: "2026-11-04T10:00:00.000Z" };
    expect(repeatsLatest(latest, { activity: "ask", query: "why does preload rise?" }, "2026-11-04T10:01:30.000Z")).toBe(true);
    expect(repeatsLatest(latest, { activity: "ask", query: "why does preload rise?" }, "2026-11-04T10:02:01.000Z")).toBe(false);
    expect(repeatsLatest(latest, { activity: "material_search", query: "why does preload rise?" }, "2026-11-04T10:00:10.000Z")).toBe(false);
    expect(repeatsLatest(latest, { activity: "ask", query: "and afterload?" }, "2026-11-04T10:00:10.000Z")).toBe(false);
    expect(repeatsLatest(null, { activity: "ask", query: "x" }, "2026-11-04T10:00:10.000Z")).toBe(false);
  });
});

describe("SCHOLAR-SEARCH-HISTORY-01: the page", () => {
  it("reads its filters and drops anything unknown", () => {
    expect(parseHistoryQuery({ q: "  fluid   balance ", show: "ask", material: A.toUpperCase(), topic: "Fluids", from: "2026-11-05", to: "2026-11-01", pinned: "1", page: "3" }))
      .toEqual({ q: "fluid balance", show: "ask", material: A, topic: "Fluids", from: "2026-11-01", to: "2026-11-05", pinned: true, page: 3 });
    expect(parseHistoryQuery({ show: "keystrokes", material: "x", topic: "a", from: "yesterday", page: "0", pinned: "yes" }))
      .toEqual({ q: "", show: null, material: null, topic: null, from: null, to: null, pinned: false, page: 1 });
    expect(hasHistoryFilters(parseHistoryQuery({}))).toBe(false);
    expect(historyParams(parseHistoryQuery({ q: "a b", show: "lessons", page: "2" }), { page: "3" })).toBe("?q=a+b&show=lessons&page=3");
    expect(panelFilterCount(parseHistoryQuery({ q: "a b", show: "ask" }))).toBe(0);
    expect(panelFilterCount(parseHistoryQuery({ material: A, from: "2026-11-01", to: "2026-11-02", pinned: "1" }))).toBe(3);
  });
  it("every activity sits under exactly one chip", () => {
    const placed = Object.values(SHOW_ACTIVITIES).flat();
    expect([...placed].sort()).toEqual([...HISTORY_ACTIVITIES].sort());
  });
  it("a chip across two activities is one newest-first page, with no row lost or repeated between pages", () => {
    const row = (key: string, createdAt: string) => ({ key, createdAt }) as HistoryEntry;
    const lessons = [row("lesson:b", "2026-11-04T10:00:03.000Z"), row("lesson:a", "2026-11-04T10:00:01.000Z")];
    const teaching = [row("artefact:c", "2026-11-04T10:00:04.000Z"), row("artefact:d", "2026-11-04T10:00:02.000Z"), row("artefact:e", "2026-11-04T10:00:01.000Z")];
    const page = (o: number) => mergeHistoryPages([lessons, teaching], o, 2).map(e => e.key);
    expect(page(0)).toEqual(["artefact:c", "lesson:b"]);
    expect(page(2)).toEqual(["artefact:d", "artefact:e"]);
    expect(page(4)).toEqual(["lesson:a"]);
  });
  it("the chevron is the first open link, never Continue the lesson; the rest go in the row's menu", () => {
    const open = { kind: "open" as const, label: "Open" }, cont = { kind: "continue" as const, label: "Continue" };
    expect(splitEntryLinks([open, cont])).toEqual({ primary: open, rest: [cont] });
    expect(splitEntryLinks([cont])).toEqual({ primary: null, rest: [cont] });
    expect(splitEntryLinks([])).toEqual({ primary: null, rest: [] });
  });
  it("the empty state never implies earlier searches exist", () => {
    expect(HISTORY_EMPTY).toMatch(/were not kept/);
  });
  it("entry keys are exactly h:, artefact: or lesson: and a uuid", () => {
    expect(parseEntryKey(`h:${A}`)).toEqual({ kind: "captured", id: A });
    expect(parseEntryKey(`artefact:${B.toUpperCase()}`)).toEqual({ kind: "artefact", id: B });
    expect(parseEntryKey(`lesson:${C}`)).toEqual({ kind: "lesson", id: C });
    expect(parseEntryKey(`note:${C}`)).toBeNull();
    expect(parseEntryKey(`lesson:${C}x`)).toBeNull();
    expect(markKey({ kind: "artefact", id: B })).toBe(`artefact:${B}`);
  });
  it("open links open what is kept, never a new AI answer; continuing Learn is a separate, last link", () => {
    const base = { query: null, materialId: null, chunkId: null, artefactId: null, sessionId: null, step: null };
    expect(entryLinks({ ...base, activity: "teaching", artefactId: A, sessionId: B, step: 1 })).toEqual([
      { label: "Open the saved answer", path: `study/saved?version=${A}`, kind: "open" }, { label: "Continue the lesson", path: `study/learn?session=${B}#lesson-1`, kind: "continue" }]);
    expect(entryLinks({ ...base, activity: "lesson", sessionId: B })).toEqual([
      { label: "Open its saved lessons", path: `study/saved?session=${B}`, kind: "open" }, { label: "Continue the lesson", path: `study/learn?session=${B}`, kind: "continue" }]);
    expect(entryLinks({ ...base, activity: "ask", materialId: A, chunkId: C })).toEqual([{ label: "Open the section", path: `study/${A}#c-${C}`, kind: "open" }]);
    expect(entryLinks({ ...base, activity: "material_search", query: "preload & afterload" })).toEqual([{ label: "Search again", path: "study/learn?q=preload%20%26%20afterload", kind: "open" }]);
    expect(entryLinks({ ...base, activity: "library_search", query: "sepsis" })).toEqual([{ label: "Search again", path: "study/saved?q=sepsis", kind: "open" }]);
    // every "open" link stays on the pages that cannot call a model, and no link starts a Learn action or an Ask
    const all = (["ask", "teaching", "research", "lesson", "material_search", "library_search"] as const).flatMap(activity => entryLinks({ query: "why?", materialId: A, chunkId: C, artefactId: B, sessionId: C, step: 0, activity }));
    for (const l of all) expect(l.path).not.toMatch(/teach=|action=|panel=ask|fresh|study=new|[?&]s=/);
    for (const l of all.filter(x => x.kind === "open")) expect(l.path).not.toMatch(/study\/learn\?session=/);
    expect(ASK_NOT_KEPT).toMatch(/does not keep Ask answers/);
  });
  it("save is the 820 bookmark on the saved teaching or the one lesson, and nothing else", () => {
    expect(saveTarget({ artefactId: A, sessionId: B, step: 0 })).toEqual({ targetKind: "artefact", artefactId: A });
    expect(saveTarget({ artefactId: null, sessionId: B, step: 2 })).toEqual({ targetKind: "lesson", sessionId: B, step: 2 });
    expect(saveTarget({ artefactId: null, sessionId: B, step: null })).toBeNull();
  });
  it("titles: the learner's words, else the action label or the lesson title", () => {
    const lbl = (a: string) => ({ teach: "Teach me" } as Record<string, string>)[a];
    expect(entryTitle({ activity: "ask", query: "Why?", label: "Why?" }, lbl)).toBe("Why?");
    expect(entryTitle({ activity: "teaching", query: null, label: "teach" }, lbl)).toBe("Teach me");
    expect(entryTitle({ activity: "research", query: null, label: "odd" }, lbl)).toBe("Saved teaching");
    expect(entryTitle({ activity: "lesson", query: null, label: "Cardiac output" }, lbl)).toBe("Cardiac output");
  });
});

// FAILS CLOSED WITHOUT 992: the list function is missing, so nothing is read, kept, changed or cleared, and no table is touched.
describe("SCHOLAR-SEARCH-HISTORY-01: without migration 992", () => {
  const missing = (code: string) => {
    const touched: string[] = [];
    const admin = { rpc: async () => ({ data: null, error: { code } }), from: (t: string) => { touched.push(t); throw new Error(`no table may be touched: ${t}`); } };
    return { admin, touched };
  };
  const entry = { activity: "ask" as const, query: "why?", requestKey: KEY, materialId: null, chunkId: null, artefactId: null, sessionId: null, step: null, topic: null, resultCount: null };
  const q = parseHistoryQuery({});
  afterEach(() => resetSearchHistorySchema(null));
  for (const code of ["42883", "PGRST202", "42P01"]) {
    it(`error ${code}: reads say not provisioned and a capture keeps nothing`, async () => {
      resetSearchHistorySchema(null);
      const { admin, touched } = missing(code);
      expect(await historySchema(admin)).toBe(false);
      expect(await listSearchHistory(admin, A, q)).toEqual({ ok: false, notProvisioned: true });
      expect(await recordSearchCapture(admin, A, entry, "2026-11-04T10:00:00.000Z")).toBe("not_provisioned");
      expect(await clearSearchHistory(admin, A)).toEqual({ ok: false });
      expect(touched).toEqual([]);
    });
  }
  it("a transient error is 'no' for now and is asked again, never remembered as absent", async () => {
    resetSearchHistorySchema(null);
    let calls = 0;
    const admin = { rpc: async () => { calls++; return calls === 1 ? { data: null, error: { code: "57014" } } : { data: [], error: null }; } };
    expect(await historySchema(admin)).toBe(false);
    expect(await historySchema(admin)).toBe(true);
  });
});

// PHASE 4: the history is never Personal AI memory and never leaves the learner's plane. Only these files may name the table
// or its functions: the model, the Scholar store (the one Scholar read and write site), and the HQ plane-boundary scan that REFUSES it.
describe("SCHOLAR-SEARCH-HISTORY-01: who may read the history", () => {
  it("nothing outside the history's own files names the 992 table or functions", () => {
    const root = join(__dirname, "../../../..");
    const allowed = new Set([
      "src/lib/individual/scholar/search-history.ts",
      "src/lib/individual/scholar/store.ts",
      "src/lib/individual/scholar/search-history.test.ts",
      "src/lib/access/plane-boundary-scan.ts",
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "node_modules" && !name.startsWith(".")) walk(p); continue; }
        if (!/\.(ts|tsx|mts|js|mjs)$/.test(name)) continue;
        if (/individual_scholar_search_history/.test(readFileSync(p, "utf8"))) hits.push(relative(root, p).replace(/\\/g, "/"));
      }
    };
    walk(join(root, "src"));
    expect(hits.filter(h => !allowed.has(h))).toEqual([]);
    expect(hits).toContain("src/lib/individual/scholar/store.ts");
  }, 60_000);
});
