import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceCompetency } from "./catalogue";

// Stage 3 acceptance (owner, 2026-10-24), items 3-5: governed reference collections by policy, "clinically approved"
// only for the exact content 395 approved, AI flags apart from review, and an unsupported answer said plainly with
// next steps from the notes only. The store and the catalogue read are mocked: these pin Scholar's rules.

const links: { chunkId: string; competencyId: string; outcome: string | null; accepted: boolean }[] = [];
let collections: ReferenceCompetency[] | null = [];
const collectionCalls: string[][] = [];
vi.mock("./store", async orig => ({ ...(await orig<typeof import("./store")>()), sectionLinks: vi.fn(async () => links) }));
vi.mock("./competency-view", async orig => ({
  ...(await orig<typeof import("./competency-view")>()),
  competencyLabels: vi.fn(async (_a: unknown, _c: unknown, ids: string[]) => new Map(ids.map(id => [id, { title: `Named ${id}`, code: null, layer: "profession", catalogue: null }]))),
}));
vi.mock("./catalogue", async orig => ({
  ...(await orig<typeof import("./catalogue")>()),
  referenceCollections: vi.fn(async (_a: unknown, ids: readonly string[]) => { collectionCalls.push([...ids]); return collections; }),
}));

const { governedReferences, referenceSource, referenceStatus, relabelReferences } = await import("./learn");
const { withheldNext } = await import("./learn-view");
const { resolvePolicy, policyPath, validateDraft } = await import("../policy");
const { CONTENT_STATUS_LABEL, NOT_IN_NOTES_LABEL, REFERENCE_CHANGED_LABEL, SUPPLEMENTARY_LABEL, WITHHELD_WHY } = await import("./config");

const OUTCOME = "Administer oxygen safely to a prescribed target range";
const comp = (id: string, contentStatus: ReferenceCompetency["contentStatus"], outcomes = [OUTCOME]): ReferenceCompetency => ({ id, title: `Competency ${id}`, code: `C-${id}`, outcomes, contentStatus });
const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b";

beforeEach(() => { links.length = 0; collections = []; collectionCalls.length = 0; });

describe("item 5: the governed reference source is policy, the CFCA by default", () => {
  it("the policy is empty by default, holds only well-formed ids, and is validated like every catalogue list", () => {
    expect(resolvePolicy([]).scholarReferenceCollections).toEqual([]);
    expect(resolvePolicy([{ config_path: policyPath("scholar_reference_collections"), published: { ids: [A, "all", B] } }]).scholarReferenceCollections).toEqual([A, B]);
    expect(validateDraft("scholar_reference_collections", [A])).toMatchObject({ ok: true, settings: { ids: [A] } });
    expect(validateDraft("scholar_reference_collections", ["every collection"])).toMatchObject({ ok: false });
  });

  it("empty keeps the student's programme catalogue and reads nothing more; a list reads exactly those collections", async () => {
    const programme = [comp("p1", "approved")] as never;
    expect(await referenceSource(null, { scholarReferenceCollections: [], scholarCatalogueMinStatus: "unreviewed" }, programme)).toEqual({ collections: false, catalogue: programme });
    expect(collectionCalls).toEqual([]);
    collections = [comp("x1", "approved")];
    expect(await referenceSource(null, { scholarReferenceCollections: [A, B], scholarCatalogueMinStatus: "unreviewed" }, programme)).toEqual({ collections: true, catalogue: collections });
    expect(collectionCalls).toEqual([[A, B]]);
  });

  it("listed collections that cannot be read give no reference (fail closed)", async () => {
    collections = null;
    expect(await referenceSource(null, { scholarReferenceCollections: [A], scholarCatalogueMinStatus: "unreviewed" }, null)).toEqual({ collections: true, catalogue: [] });
  });

  it("with listed collections only their competencies are references; by default a link the catalogue lacks keeps its name, unapproved", async () => {
    links.push({ chunkId: "s1", competencyId: "in", outcome: OUTCOME, accepted: true }, { chunkId: "s1", competencyId: "out", outcome: null, accepted: true });
    const listed = await governedReferences(null, "u", ["s1"], { collections: true, catalogue: [comp("in", "approved")] });
    expect(listed.map(r => r.competencyId)).toEqual(["in"]);
    expect(listed[0]).toMatchObject({ title: "Competency in", outcome: OUTCOME, status: CONTENT_STATUS_LABEL.approved, approved: true });
    const byDefault = await governedReferences(null, "u", ["s1"], { collections: false, catalogue: [comp("in", "approved")] });
    expect(byDefault.find(r => r.competencyId === "out")).toMatchObject({ title: "Named out", status: CONTENT_STATUS_LABEL.unreviewed, approved: false });
  });

  it("an outcome the competency's current content no longer holds is not given", async () => {
    links.push({ chunkId: "s1", competencyId: "in", outcome: "An outcome since removed", accepted: true });
    const [r] = await governedReferences(null, "u", ["s1"], { collections: false, catalogue: [comp("in", "approved")] });
    expect(r).toMatchObject({ outcome: null, approved: true });
  });
});

describe("items 3 and 5: 'clinically approved' only for the exact content 395 approved", () => {
  it("one rule: approved current content with the outcome it holds; anything else is not approved", () => {
    expect(referenceStatus(comp("a", "approved"), OUTCOME)).toEqual({ status: CONTENT_STATUS_LABEL.approved, approved: true });
    expect(referenceStatus(comp("a", "approved"), null)).toEqual({ status: CONTENT_STATUS_LABEL.approved, approved: true });
    expect(referenceStatus(comp("a", "approved"), "Not in this version")).toEqual({ status: REFERENCE_CHANGED_LABEL, approved: false });
    expect(referenceStatus(comp("a", "draft"), OUTCOME)).toEqual({ status: CONTENT_STATUS_LABEL.draft, approved: false });
    expect(referenceStatus(comp("a", "unreviewed"), OUTCOME).approved).toBe(false);
    expect(referenceStatus(undefined, OUTCOME)).toEqual({ status: CONTENT_STATUS_LABEL.unreviewed, approved: false });
  });

  it("a saved answer's references are labelled as the source is now, never as they were saved", () => {
    const saved = [
      { tag: "R1", competencyId: "lost", title: "Was approved", code: null, outcome: OUTCOME, status: CONTENT_STATUS_LABEL.approved, approved: true },
      { tag: "R2", competencyId: "now", title: "Approved since", code: "C-now", outcome: OUTCOME, status: CONTENT_STATUS_LABEL.unreviewed },
      { tag: "R3", competencyId: "edited", title: "Outcome removed", code: null, outcome: "Old outcome", status: CONTENT_STATUS_LABEL.approved, approved: true },
      null, { nonsense: true },
    ];
    const source = { collections: false as const, catalogue: [comp("lost", "unreviewed"), comp("now", "approved"), comp("edited", "approved")] };
    const out = relabelReferences(saved, source);
    expect(out.map(r => [r.tag, r.approved, r.status])).toEqual([
      ["R1", false, CONTENT_STATUS_LABEL.unreviewed], ["R2", true, CONTENT_STATUS_LABEL.approved], ["R3", false, REFERENCE_CHANGED_LABEL],
    ]);
    expect(relabelReferences(saved.slice(0, 1), { collections: true, catalogue: [] })[0]).toMatchObject({ approved: false, status: CONTENT_STATUS_LABEL.unreviewed });
  });
});

describe("item 4: an unsupported answer, said plainly, with next steps from the notes only", () => {
  const src = (i: number) => ({ tag: `S${i}`, chunkId: `c${i}`, materialId: "m", materialTitle: "Notes", citation: `Notes, page ${i}`, excerpt: "the passage itself" });
  const sources = [src(1), src(2), src(3), src(4)];

  it("not in the notes: says so, the nearest sections (at most three, nearest first), a rephrase where Ask is offered", () => {
    const n = withheldNext({ reason: "not_in_notes", detail: null, sources, askOffered: true, background: null, backgroundAllowed: true });
    expect(n).toEqual({
      why: WITHHELD_WHY.not_in_notes, notInNotes: true, rephrase: true, background: null,
      nearest: [1, 2, 3].map(i => ({ tag: `S${i}`, chunkId: `c${i}`, materialId: "m", citation: `Notes, page ${i}` })),
    });
    expect(NOT_IN_NOTES_LABEL).toBe("This isn't in your notes.");
    expect(withheldNext({ reason: "not_in_notes", detail: null, sources, askOffered: false, background: null, backgroundAllowed: true }).rephrase).toBe(false);
  });

  it("ungrounded: says what was not in the notes, and never carries the withheld text or a passage's words", () => {
    const n = withheldNext({ reason: "ungrounded", detail: "the number 94", sources, askOffered: true, background: null, backgroundAllowed: false });
    expect(n.why).toBe(`${WITHHELD_WHY.ungrounded} (the number 94)`);
    expect(n.notInNotes).toBe(false);
    expect(JSON.stringify(n)).not.toContain("the passage itself");
  });

  it("the labelled background only where policy allows it and it passed its own checks", () => {
    const ok = { ok: true as const, text: "Oxygen is a medicine." };
    expect(withheldNext({ reason: "ungrounded", detail: null, sources, askOffered: true, background: ok, backgroundAllowed: true }).background).toEqual({ text: ok.text, label: SUPPLEMENTARY_LABEL });
    expect(withheldNext({ reason: "ungrounded", detail: null, sources, askOffered: true, background: ok, backgroundAllowed: false }).background).toBeNull();
    expect(withheldNext({ reason: "ungrounded", detail: null, sources, askOffered: true, background: { ok: false, reason: "figure" } as never, backgroundAllowed: true }).background).toBeNull();
  });
});
