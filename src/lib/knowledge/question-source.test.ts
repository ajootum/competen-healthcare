import { describe, expect, it } from "vitest";
import { licenceAllowed, looksCited, normaliseSource, sourceOf, sourceRefusal } from "./question-source";
import { contentOf } from "./educator";

describe("licenceAllowed", () => {
  it.each(["CC0", "CC BY 4.0", "CC-BY-SA-4.0", "Public domain", "OGL v3", "Open Government Licence v3.0"])("allows %s", l => expect(licenceAllowed(l)).toBe(true));
  it.each(["CC BY-NC 4.0", "CC-BY-NC-SA", "CC BY-ND", "non-commercial use only", "all rights reserved", "unknown", "", undefined, "CC BY NC"])("refuses %s", l => expect(licenceAllowed(l as string | undefined)).toBe(false));
});

describe("sourceRefusal (submit and publish gate)", () => {
  it("no source declared passes (legacy) and own writing passes", () => {
    expect(sourceRefusal({ stem: "x" })).toBeNull();
    expect(sourceRefusal({ source: { kind: "own_writing" } })).toBeNull();
  });
  it("material from a source needs a reference", () => { expect(sourceRefusal({ source: { kind: "governed_reference" } })).toMatch(/name the source/); });
  it("governed reference with a reference passes", () => { expect(sourceRefusal({ source: { kind: "governed_reference", reference: "CKRI entry 12" } })).toBeNull(); });
  it("open licence needs a licence, and refuses NC and unknown", () => {
    expect(sourceRefusal({ source: { kind: "open_licence", reference: "https://x" } })).toMatch(/name the licence/);
    expect(sourceRefusal({ source: { kind: "open_licence", reference: "https://x", licence: "CC BY-NC 4.0" } })).toMatch(/does not allow/);
    expect(sourceRefusal({ source: { kind: "open_licence", reference: "https://x", licence: "something" } })).toMatch(/does not allow/);
    expect(sourceRefusal({ source: { kind: "open_licence", reference: "https://x", licence: "CC BY 4.0" } })).toBeNull();
  });
  it("permission needs a note", () => {
    expect(sourceRefusal({ source: { kind: "permission", reference: "Journal X" } })).toMatch(/Record the permission/);
    expect(sourceRefusal({ source: { kind: "permission", reference: "Journal X", permissionNote: "Written, J. Smith, 1 Oct 2026" } })).toBeNull();
  });
  it("an unknown kind is refused", () => { expect(sourceRefusal({ source: { kind: "web" } })).toMatch(/not one of/); });
});

describe("storage inside the content jsonb", () => {
  it("contentOf keeps a normalised source on a revision question and none on other kinds", () => {
    const f = { stem: "s", options: ["a", "b", "c", "d"], correctIndex: 1, rationale: "r", source: { kind: "open_licence", reference: " https://x ", licence: "CC0", permissionNote: "ignored", junk: 1 } };
    expect(contentOf("revision_question", f).source).toEqual({ kind: "open_licence", reference: "https://x", licence: "CC0" });
    expect(contentOf("revision_question", { ...f, source: undefined })).not.toHaveProperty("source");
    expect(contentOf("explanation", { body: "b", source: f.source })).not.toHaveProperty("source");
  });
  it("sourceOf reads it back", () => {
    expect(sourceOf({ source: { kind: "permission", reference: "r", permissionNote: "n" } })).toEqual({ kind: "permission", reference: "r", permissionNote: "n" });
    expect(sourceOf({})).toBeNull();
    expect(normaliseSource("x")).toBeNull();
  });
  it("looksCited flags links, DOIs and et al", () => {
    expect(looksCited("see https://example.org")).toBe(true);
    expect(looksCited("Smith et al found")).toBe(true);
    expect(looksCited("The heart has four chambers")).toBe(false);
  });
});
