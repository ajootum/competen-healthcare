import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BASIC_SEARCH_ROWS, EXPORT_SELECTED_MAX, HL_START, HL_STOP, NOTE_BODY_MAX, NOTE_QUOTE_MAX,
  baseKey, basicMatches, decodeCursor, encodeCursor, keysetFilter, lessonLinkOf, lessonTitleOf, orderVersions, pageOf, parseExportScope, parseLibraryQuery,
  provenanceOf, rangeBounds, snippetParts, supersededKey, validateNote, versionLabel,
} from "./saved-library";
import { coversLesson } from "./learn-journey";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const KEY = "a".repeat(64);

describe("SCHOLAR-LIBRARY-01 view selection and filters", () => {
  it("defaults to Recently studied, newest first, page 1, and drops anything unknown", () => {
    const q = parseLibraryQuery({ view: "everything", status: "secret", sort: "sideways", material: "not-an-id", competency: "x", topic: "a", page: "0" });
    expect(q).toMatchObject({ view: "recent", status: "any", sort: "newest", material: null, competency: null, topic: null, page: 1, cursor: null, q: "" });
  });
  it("reads every view, the filters and a reversed date range the right way round", () => {
    for (const v of ["recent", "continue", "completed", "revision"]) expect(parseLibraryQuery({ view: v }).view).toBe(v);
    const q = parseLibraryQuery({ material: A, competency: B, topic: "  Cardiac   output ", status: "earlier", sort: "oldest", from: "2026-11-02", to: "2026-10-01" });
    expect(q).toMatchObject({ material: A, competency: B, topic: "Cardiac output", status: "earlier", sort: "oldest", from: "2026-10-01", to: "2026-11-02" });
  });
  it("turns a day range into UTC bounds, the end exclusive", () => {
    expect(rangeBounds("2026-10-01", "2026-10-31")).toEqual({ fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-11-01T00:00:00.000Z" });
    expect(rangeBounds(null, null)).toEqual({ fromIso: null, toIso: null });
  });
  it("clips the search text and the page number", () => {
    expect(parseLibraryQuery({ q: "x".repeat(500) }).q).toHaveLength(200);
    expect(parseLibraryQuery({ page: "201" }).page).toBe(1);
    expect(parseLibraryQuery({ page: "3" }).page).toBe(3);
  });
});

describe("keyset pagination", () => {
  const at = "2026-11-01T10:20:30.123456+00:00";
  it("round-trips the database's own timestamp, microseconds and offset kept", () => {
    const enc = encodeCursor({ at, id: A });
    expect(enc).not.toMatch(/[:+ ]/);
    expect(decodeCursor(enc)).toEqual({ at, id: A });
    expect(decodeCursor(parseLibraryQuery({ after: enc }).cursor ? enc : "")).toEqual({ at, id: A });
  });
  it("refuses anything that is not exactly one cursor", () => {
    for (const bad of ["", "x", `${at}~nope`, `garbage~${A}`, `${encodeCursor({ at, id: A })}~${B}`, "9".repeat(90)]) expect(decodeCursor(bad)).toBeNull();
  });
  it("reads limit + 1 to know there is more, and points after the last item shown", () => {
    const rows = [1, 2, 3].map(i => ({ id: `id${i}`, t: `t${i}` }));
    expect(pageOf(rows, 2, r => r.t)).toEqual({ items: rows.slice(0, 2), next: { at: "t2", id: "id2" } });
    expect(pageOf(rows, 3, r => r.t)).toEqual({ items: rows, next: null });
  });
  it("builds the tie-breaking filter for both orders, quoting the timestamp", () => {
    expect(keysetFilter({ at, id: A }, "newest")).toBe(`created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${A})`);
    expect(keysetFilter({ at, id: A }, "oldest", "last_active_at")).toBe(`last_active_at.gt."${at}",and(last_active_at.eq."${at}",id.gt.${A})`);
  });
  it("pages through more than 500 rows with no row skipped or repeated (the >500 acceptance)", () => {
    const all = Array.from({ length: 1234 }, (_, i) => ({ id: `${String(i).padStart(4, "0")}`, at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00+00:00` }))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const seen: string[] = [];
    let cursor: { at: string; id: string } | null = null;
    do {
      const after: { at: string; id: string } | null = cursor;
      const rest: { id: string; at: string }[] = after ? all.filter(r => r.at < after.at || (r.at === after.at && r.id < after.id)) : all;
      const p: { items: { id: string; at: string }[]; next: { at: string; id: string } | null } = pageOf(rest.slice(0, 26), 25, (r: { id: string; at: string }) => r.at);
      seen.push(...p.items.map(r => r.id));
      cursor = p.next;
    } while (cursor);
    expect(seen).toHaveLength(1234);
    expect(new Set(seen).size).toBe(1234);
  });
});

describe("snippet rendering safety", () => {
  it("splits {{hl}} marks into text parts, never HTML", () => {
    expect(snippetParts(`The ${HL_START}preload${HL_STOP} is <b>stretch</b>`)).toEqual([
      { text: "The ", mark: false }, { text: "preload", mark: true }, { text: " is <b>stretch</b>", mark: false },
    ]);
  });
  it("never leaks a stray or unbalanced marker, and drops control characters", () => {
    const parts = snippetParts(`a ${HL_STOP} b ${HL_START}c\u0007 d`);
    expect(parts.map(p => p.text).join("")).toBe("a  b c d");
    expect(parts.some(p => /\{\{/.test(p.text))).toBe(false);
    expect(snippetParts(null)).toEqual([]);
  });
  it("clips a long snippet", () => {
    const parts = snippetParts("x".repeat(1000), 50);
    expect(parts[0].text.length).toBeLessThanOrEqual(51);
  });
  it("basic search: every word, case-insensitive, marked, and the stored text's own markers removed", () => {
    const rows = [{ id: "1", t: "Preload and afterload {{hl}}" }, { id: "2", t: "Only preload" }];
    const hits = basicMatches(rows, "AFTERLOAD preload!", r => r.t);
    expect(hits.map(h => h.row.id)).toEqual(["1"]);
    expect(snippetParts(hits[0].headline).filter(p => p.mark).map(p => p.text.toLowerCase())).toEqual(["preload", "afterload"]);
    expect(basicMatches(rows, "!!", r => r.t)).toEqual([]);
    expect(BASIC_SEARCH_ROWS).toBe(500);
  });
});

describe("export scope parsing", () => {
  const u = (s: string) => new URLSearchParams(s);
  it("keeps the three existing scopes", () => {
    expect(parseExportScope(u(`session=${A}&step=2`))).toEqual({ kind: "lesson", session: A, step: 2 });
    expect(parseExportScope(u(`material=${A}`))).toEqual({ kind: "material", material: A });
    expect(parseExportScope(u(`study=${A}`))).toEqual({ kind: "study", study: A });
  });
  it("adds selected (a list or ticked boxes), topic and a date range", () => {
    expect(parseExportScope(u(`selected=${A},${B},${A}`))).toEqual({ kind: "selected", ids: [A, B] });
    expect(parseExportScope(u(`selected=${A}&selected=${C}`))).toEqual({ kind: "selected", ids: [A, C] });
    expect(parseExportScope(u("topic=Heart%20failure"))).toEqual({ kind: "topic", topic: "Heart failure" });
    expect(parseExportScope(u("from=2026-10-31&to=2026-10-01"))).toEqual({ kind: "range", from: "2026-10-01", to: "2026-10-31" });
  });
  it("refuses no scope, two scopes, a bad id, too many, half a range and a bad date", () => {
    const many = Array.from({ length: EXPORT_SELECTED_MAX + 1 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`).join(",");
    for (const bad of ["", `material=${A}&topic=x1`, `selected=${A}&from=2026-01-01&to=2026-01-02`, "selected=nope", `selected=${many}`, "from=2026-01-01", "from=2026-13-45&to=2026-01-01", "topic=x", `session=${A}&step=-1`])
      expect(parseExportScope(u(bad))).toBeNull();
  });
});

describe("note validation", () => {
  it("accepts the three kinds in their shapes", () => {
    expect(validateNote({ kind: "note", targetKind: "artefact", artefactId: A, body: "  Remember Starling  " })).toEqual({ ok: true, note: { kind: "note", targetKind: "artefact", artefactId: A, body: "Remember Starling", quote: null } });
    expect(validateNote({ kind: "bookmark", targetKind: "lesson", sessionId: A, step: 3, body: "ignored", quote: "ignored" })).toMatchObject({ ok: true, note: { body: null, quote: null, step: 3 } });
    expect(validateNote({ kind: "highlight", targetKind: "section", materialId: A, chunkId: B, quote: "stroke volume" })).toMatchObject({ ok: true, note: { quote: "stroke volume", body: null } });
  });
  it("refuses a wrong kind, an incomplete target and wrong lengths", () => {
    expect(validateNote({ kind: "scribble", targetKind: "material", materialId: A, body: "x" })).toMatchObject({ ok: false, problem: "kind" });
    expect(validateNote({ kind: "note", targetKind: "lesson", sessionId: A, body: "x" })).toMatchObject({ ok: false, problem: "target" });
    expect(validateNote({ kind: "note", targetKind: "lesson", sessionId: A, step: 200, body: "x" })).toMatchObject({ ok: false, problem: "target" });
    expect(validateNote({ kind: "note", targetKind: "section", materialId: A, body: "x" })).toMatchObject({ ok: false, problem: "target" });
    expect(validateNote({ kind: "note", targetKind: "material", materialId: A, body: "   " })).toMatchObject({ ok: false, problem: "body" });
    expect(validateNote({ kind: "note", targetKind: "material", materialId: A, body: "x".repeat(NOTE_BODY_MAX + 1) })).toMatchObject({ ok: false, problem: "body" });
    expect(validateNote({ kind: "highlight", targetKind: "material", materialId: A })).toMatchObject({ ok: false, problem: "quote" });
    expect(validateNote({ kind: "highlight", targetKind: "material", materialId: A, quote: "q".repeat(NOTE_QUOTE_MAX + 1) })).toMatchObject({ ok: false, problem: "quote" });
    expect(validateNote(null)).toMatchObject({ ok: false });
  });
  it("never takes an owner from the request", () => {
    const v = validateNote({ kind: "note", targetKind: "material", materialId: A, body: "x", userId: B, user_id: B });
    expect(v.ok && JSON.stringify(v.note)).not.toContain(B);
  });
});

describe("kept versions (superseded logic)", () => {
  it("rewrites the key to key:superseded:id and reads the base key back", () => {
    expect(supersededKey(KEY, A)).toBe(`${KEY}:superseded:${A}`);
    expect(baseKey(supersededKey(KEY, A))).toBe(KEY);
    expect(supersededKey(supersededKey(KEY, A), B)).toBe(`${KEY}:superseded:${B}`);
    // The shape migration 820's CHECK accepts.
    expect(supersededKey(KEY, A)).toMatch(/^[0-9a-f]{64}(:superseded:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/);
  });
  it("orders the current version first, then the earlier ones newest first, and labels them", () => {
    const v = orderVersions([
      { id: "old", createdAt: "2026-10-01T00:00:00Z", supersededAt: "2026-10-05T00:00:00Z" },
      { id: "cur", createdAt: "2026-10-05T00:00:00Z", supersededAt: null },
      { id: "mid", createdAt: "2026-10-03T00:00:00Z", supersededAt: "2026-10-05T00:00:00Z" },
    ]);
    expect(v.map(x => x.id)).toEqual(["cur", "mid", "old"]);
    expect(versionLabel(v[0])).toBe("Current version");
    expect(versionLabel(v[2])).toBe("Earlier version, saved 1 October 2026");
  });
});

describe("lesson link: linked at save, matched by sections only when exact and unique, never guessed", () => {
  const lessons = [{ sessionId: A, step: 0, chunkIds: [B] }, { sessionId: A, step: 1, chunkIds: [C, B] }];
  it("prefers the link written at save", () => {
    expect(lessonLinkOf({ sessionId: C, step: 4, sources: [B] }, lessons, coversLesson)).toEqual({ kind: "linked", sessionId: C, step: 4 });
  });
  it("matches an older row only by the exact chunk set", () => {
    expect(lessonLinkOf({ sources: [B, C] }, lessons, coversLesson)).toEqual({ kind: "matched", sessionId: A, step: 1 });
    expect(lessonLinkOf({ sources: [C] }, lessons, coversLesson)).toBeNull();
  });
  it("leaves an ambiguous older row unlinked", () => {
    expect(lessonLinkOf({ sources: [B] }, [...lessons, { sessionId: C, step: 0, chunkIds: [B] }], coversLesson)).toBeNull();
  });
});

describe("titles and provenance", () => {
  it("titles a saved teaching by its first heading, else its first line", () => {
    expect(lessonTitleOf("Intro line\n## Cardiac **output**\nmore")).toBe("Cardiac output");
    expect(lessonTitleOf("Overview: The heart pumps")).toBe("The heart pumps");
    expect(lessonTitleOf("")).toBe("");
    expect(lessonTitleOf("word ".repeat(60)).length).toBeLessThanOrEqual(90);
  });
  it("says where it came from: the learner's sections, AI, research, the learner's notes", () => {
    expect(provenanceOf({ content: "x", refs: [], sources: [A] })).toEqual(["notes", "ai"]);
    expect(provenanceOf({ content: "x\n\nFROM RESEARCH:\ny", refs: [], sources: [A] }, 2)).toEqual(["notes", "ai", "research", "yours"]);
    expect(provenanceOf({ content: "x", refs: [{ kind: "external" }], sources: [] })).toEqual(["ai", "research"]);
  });
});

describe("no AI in the library model", () => {
  it("saved-library.ts imports nothing at all (pure), so no model can be reached from it", () => {
    const src = readFileSync("src/lib/individual/scholar/saved-library.ts", "utf8");
    expect(src).not.toMatch(/^import /m);
  });
});
