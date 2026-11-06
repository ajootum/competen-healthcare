import { describe, expect, it } from "vitest";
import {
  DRAFT_MAX_AGE_MS, FREE_CONTEXT, NOTEBOOK_BODY_MAX, NOTEBOOK_TAGS_MAX, askPrefill, capturedInOf, cleanBody, cleanTags, linkColumns, noteHeading, notesToMarkdown,
  parseDraft, parseNoteLink, pickReadingBox, validateCreate, validatePatch,
} from "./personal-notebook";
import { relatedByTags } from "./personal-notebook-data";
import { notebookOffered } from "./store";

const K = "11111111-1111-4111-8111-111111111111", S = "22222222-2222-4222-8222-222222222222", M = "33333333-3333-4333-8333-333333333333", C = "44444444-4444-4444-8444-444444444444";

describe("capture needs only words", () => {
  it("accepts a key and words: free-standing, no title, no tag, no material", () => {
    const v = validateCreate({ clientKey: K, body: "An idea" });
    expect(v).toMatchObject({ ok: true, note: { body: "An idea", title: null, tags: [], context: { link: { targetKind: "free" } } } });
  });
  it("refuses a missing key, no words and too many words, keeping the limit the database keeps", () => {
    expect(validateCreate({ body: "x" })).toMatchObject({ ok: false, problem: "key" });
    expect(validateCreate({ clientKey: K, body: "   " })).toMatchObject({ ok: false, problem: "body" });
    expect(validateCreate({ clientKey: K, body: "a".repeat(NOTEBOOK_BODY_MAX + 1) })).toMatchObject({ ok: false, problem: "body" });
    expect(validateCreate({ clientKey: K, body: "a".repeat(NOTEBOOK_BODY_MAX) }).ok).toBe(true);
  });
  it("keeps the learner's own layout, only making line endings one and removing control characters", () => {
    expect(cleanBody("  one\r\n\r\n    two\u0007  ")).toBe("  one\n\n    two  ");
  });
  it("a half-formed link is refused, never guessed", () => {
    expect(validateCreate({ clientKey: K, body: "x", context: { link: { targetKind: "section", materialId: M } } })).toMatchObject({ ok: false, problem: "target" });
    expect(parseNoteLink({ targetKind: "lesson", sessionId: S })).toBeNull();
    expect(parseNoteLink({ targetKind: "lesson", sessionId: S, step: 200 })).toBeNull();
    expect(parseNoteLink({ targetKind: "nonsense" })).toBeNull();
  });
  it("a chunk with no material is dropped from a lesson link, because the store could not check it", () => {
    expect(parseNoteLink({ targetKind: "lesson", sessionId: S, step: 1, chunkId: C })).toEqual({ targetKind: "lesson", sessionId: S, step: 1, materialId: null, chunkId: null });
  });
  it("takes the section's context when captured inside material", () => {
    const v = validateCreate({ clientKey: K, body: "x", context: { link: { targetKind: "lesson", sessionId: S, step: 2, materialId: M, chunkId: C }, sectionLabel: "Cephalocaudal development", sectionAnchor: "s3", capturedIn: "learn", studyId: S } });
    expect(v).toMatchObject({ ok: true, note: { context: { sectionLabel: "Cephalocaudal development", sectionAnchor: "s3", capturedIn: "learn", studyId: S, link: { chunkId: C, materialId: M, step: 2 } } } });
  });
  it("a bad anchor or an unknown space is dropped, not stored", () => {
    const v = validateCreate({ clientKey: K, body: "x", context: { sectionAnchor: "Bad Anchor!", capturedIn: "employer" } });
    expect(v).toMatchObject({ ok: true, note: { context: { sectionAnchor: null, capturedIn: "other" } } });
  });
});

describe("a topic link", () => {
  it("is optional, and needs real words within the bounds the database keeps", () => {
    expect(parseNoteLink({ targetKind: "topic", topic: "  Motor   development " })).toEqual({ targetKind: "topic", topic: "Motor development" });
    expect(parseNoteLink({ targetKind: "topic", topic: "x" })).toBeNull();
    expect(parseNoteLink({ targetKind: "topic", topic: "a".repeat(121) })).toBeNull();
    expect(parseNoteLink({ targetKind: "topic" })).toBeNull();
    expect(validateCreate({ clientKey: K, body: "x", context: { link: { targetKind: "topic", topic: "Motor development" } } })).toMatchObject({ ok: true, note: { context: { link: { targetKind: "topic", topic: "Motor development" } } } });
  });
  it("writes the topic and clears every other target. Any other link clears the topic", () => {
    expect(linkColumns({ targetKind: "topic", topic: "Motor development" })).toEqual({ target_kind: "topic", artefact_id: null, material_id: null, chunk_id: null, session_id: null, step: null, topic: "Motor development" });
    expect(linkColumns({ targetKind: "free" }).topic).toBeNull();
    expect(linkColumns({ targetKind: "material", materialId: M }).topic).toBeNull();
    expect(linkColumns({ targetKind: "lesson", sessionId: S, step: 1, materialId: null, chunkId: null }).topic).toBeNull();
  });
});

describe("linkColumns", () => {
  it("names every column, so moving a note leaves nothing behind", () => {
    expect(linkColumns({ targetKind: "free" })).toEqual({ target_kind: "free", artefact_id: null, material_id: null, chunk_id: null, session_id: null, step: null, topic: null });
    expect(linkColumns({ targetKind: "material", materialId: M })).toMatchObject({ material_id: M, chunk_id: null, session_id: null, step: null });
    expect(linkColumns({ targetKind: "lesson", sessionId: S, step: 3, materialId: M, chunkId: C })).toMatchObject({ session_id: S, step: 3, material_id: M, chunk_id: C });
  });
});

describe("a change", () => {
  it("needs a revision, so it is always made from a known copy", () => {
    expect(validatePatch({ body: "x" }).ok).toBe(false);
    expect(validatePatch({ expectedRevision: 0, body: "x" }).ok).toBe(false);
    expect(validatePatch({ expectedRevision: 2, body: "x" })).toMatchObject({ ok: true, patch: { expectedRevision: 2, body: "x" } });
  });
  it("carries only what is present", () => {
    const v = validatePatch({ expectedRevision: 1, pinned: true });
    expect(v.ok && Object.keys(v.patch).sort()).toEqual(["expectedRevision", "pinned"]);
  });
  it("a blank title clears it. A blank body is refused", () => {
    expect(validatePatch({ expectedRevision: 1, title: "  " })).toMatchObject({ ok: true, patch: { title: null } });
    expect(validatePatch({ expectedRevision: 1, body: "  " }).ok).toBe(false);
  });
  it("refuses a bad link or competency id", () => {
    expect(validatePatch({ expectedRevision: 1, link: { targetKind: "section" } }).ok).toBe(false);
    expect(validatePatch({ expectedRevision: 1, competencyId: "nope" }).ok).toBe(false);
    expect(validatePatch({ expectedRevision: 1, competencyId: null })).toMatchObject({ ok: true, patch: { competencyId: null } });
  });
});

describe("tags", () => {
  it("trims, drops the hash, keeps one of each whatever the case, and stops at the limit", () => {
    expect(cleanTags("#Growth,  growth , motor   skills,,")).toEqual(["Growth", "motor skills"]);
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(NOTEBOOK_TAGS_MAX);
    expect(cleanTags(null)).toEqual([]);
  });
});

describe("which section is being read", () => {
  it("is the first box at or below the reading band, the last past the end, and none without boxes", () => {
    const boxes = [{ bottom: -100, id: "a" }, { bottom: 240, id: "b" }, { bottom: 900, id: "c" }];
    expect(pickReadingBox(boxes, 300)?.id).toBe("c");
    expect(pickReadingBox(boxes, 200)?.id).toBe("b");
    expect(pickReadingBox([{ bottom: -500 }, { bottom: -10 }], 300)?.bottom).toBe(-10);
    expect(pickReadingBox([], 300)).toBeNull();
  });
});

describe("capturedInOf", () => {
  it("names the Scholar space, most specific first", () => {
    expect(capturedInOf("/individual/scholar")).toBe("home");
    expect(capturedInOf("/individual/scholar/study/learn?session=1")).toBe("learn");
    expect(capturedInOf("/individual/scholar/study/revise/mistakes")).toBe("revise");
    expect(capturedInOf("/individual/scholar/study/notebook/new")).toBe("notebook");
    expect(capturedInOf("/individual/scholar/study/saved")).toBe("library");
    expect(capturedInOf(`/individual/scholar/study/${M}`)).toBe("library");
    expect(capturedInOf("/individual/scholar/passport")).toBe("other");
  });
});

describe("words about a note", () => {
  it("heads with its title, else its first line, shortened at a word", () => {
    expect(noteHeading({ title: "T", body: "b" })).toBe("T");
    expect(noteHeading({ body: "\n\n  first line\nsecond" })).toBe("first line");
    expect(noteHeading({ body: "word ".repeat(40) }, 30).length).toBeLessThanOrEqual(30);
    expect(noteHeading({})).toBe("Untitled note");
  });
  it("offers Ask the learner's own words, bounded", () => {
    expect(askPrefill("develop", "Head  before\ntrunk", 500)).toBe("Help me develop this idea: Head before trunk");
    expect(askPrefill("research", "x".repeat(900), 100)).toHaveLength(100);
  });
});

describe("export", () => {
  const note = { title: null, body: "Line one\n\n  kept layout", quote: null, tags: ["a"], where: "Lesson 1", createdAt: "2026-11-06T10:00:00.000Z", updatedAt: "2026-11-06T11:00:00.000Z" };
  it("keeps the learner's words exactly, and says when and where", () => {
    const md = notesToMarkdown([note], "2026-11-06T12:00:00.000Z");
    expect(md).toContain("Line one\n\n  kept layout");
    expect(md).toContain("Written 2026-11-06 10:00 UTC, edited 2026-11-06 11:00 UTC, on Lesson 1");
    expect(md).toContain("Tags: a");
    expect(md).toContain("1 note.");
  });
  it("an empty notebook is still a file that says so", () => {
    expect(notesToMarkdown([], "2026-11-06T12:00:00.000Z")).toContain("0 notes.");
  });
});

describe("a stored draft", () => {
  const good = { clientKey: K, noteId: null, revision: null, body: "words", title: "", tags: [], context: { ...FREE_CONTEXT, link: { targetKind: "free" } }, savedAt: 1000 };
  it("is read back", () => {
    expect(parseDraft(JSON.stringify(good), 2000)).toMatchObject({ clientKey: K, body: "words", context: { link: { targetKind: "free" } } });
  });
  it("is not offered when it is rubbish, blank or too old", () => {
    expect(parseDraft("{not json", 2000)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...good, body: "  " }), 2000)).toBeNull();
    expect(parseDraft(JSON.stringify(good), 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseDraft(null, 0)).toBeNull();
  });
  it("a draft whose link no longer parses is restored free-standing, with its words", () => {
    expect(parseDraft(JSON.stringify({ ...good, context: { link: { targetKind: "section" } } }), 2000)).toMatchObject({ body: "words", context: { link: { targetKind: "free" } } });
  });
});

describe("related by tags", () => {
  it("finds shared tags, most shared first, never the note itself", () => {
    const others = [
      { id: "a", tags: ["x"], title: "A", body: null, quote: null }, { id: "b", tags: ["X", "y"], title: "B", body: null, quote: null },
      { id: "c", tags: ["z"], title: "C", body: null, quote: null }, { id: "me", tags: ["x", "y"], title: "Me", body: null, quote: null },
    ];
    expect(relatedByTags({ id: "me", tags: ["x", "y"] }, others).map(r => r.id)).toEqual(["b", "a"]);
    expect(relatedByTags({ id: "me", tags: [] }, others)).toEqual([]);
  });
});

describe("notebookOffered", () => {
  it("needs the policy, the library and migration 1000, all three", () => {
    expect(notebookOffered({ scholarPersonalNotebook: "on", scholarLearningLibrary: "on" }, true)).toBe(true);
    expect(notebookOffered({ scholarPersonalNotebook: "off", scholarLearningLibrary: "on" }, true)).toBe(false);
    expect(notebookOffered({ scholarPersonalNotebook: "on", scholarLearningLibrary: "off" }, true)).toBe(false);
    expect(notebookOffered({ scholarPersonalNotebook: "on", scholarLearningLibrary: "on" }, false)).toBe(false);
  });
});
