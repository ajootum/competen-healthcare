import { describe, expect, it } from "vitest";
import { correctQuery, expandText, expandWebsearch, vocabularyOf } from "./tolerant";

describe("expandText", () => {
  it("adds the closed synonyms and keeps the words typed", () => {
    expect(expandText("paediatric dosing")).toBe("paediatric dosing pediatric");
    expect(expandText("sbar")).toContain("situation background assessment recommendation");
  });
  it("finds a known phrase in the whole query", () => {
    expect(expandText("root cause analysis")).toContain("rca");
  });
  it("leaves a query the list does not know", () => {
    expect(expandText("hypertension")).toBe("hypertension");
  });
});

describe("expandWebsearch", () => {
  it("offers alternatives, so a synonym does not have to be present as well", () => {
    expect(expandWebsearch("paediatric dosing")).toBe("paediatric dosing or pediatric dosing");
  });
  it("leaves a query the learner shaped", () => {
    expect(expandWebsearch('"paediatric dosing"')).toBe('"paediatric dosing"');
    expect(expandWebsearch("preload or afterload")).toBe("preload or afterload");
    expect(expandWebsearch("oedema -leg")).toBe("oedema -leg");
  });
  it("stays within the limit", () => {
    expect(expandWebsearch(`${"anaemia ".repeat(30)}`).length).toBeLessThanOrEqual(240);
  });
});

describe("correctQuery", () => {
  const vocab = vocabularyOf(["Hypertension management", "Cardiac output", "Sepsis bundle", "Ward round notes"]);
  it("corrects one slip against the learner's own words", () => {
    expect(correctQuery("hypertenison", vocab)).toEqual({ text: "hypertension", changed: true });
    expect(correctQuery("cardaic output", vocab)).toEqual({ text: "cardiac output", changed: true });
  });
  it("never turns hypotension into hypertension", () => {
    expect(correctQuery("hypotension", vocab)).toEqual({ text: "hypotension", changed: false });
  });
  it("never changes a word of four letters or fewer, or a word the vocabulary holds", () => {
    expect(correctQuery("sepsi", vocabularyOf(["sepsis"]))).toEqual({ text: "sepsi", changed: false });
    expect(correctQuery("ward", vocab).changed).toBe(false);
    expect(correctQuery("cardiac", vocab).changed).toBe(false);
  });
  it("does not guess between two corrections", () => {
    const two = vocabularyOf(["tests", "testy"]);
    expect(correctQuery("testx", two).changed).toBe(false);
  });
  it("needs the same first letter", () => {
    expect(correctQuery("ypertension", vocab).changed).toBe(false);
  });
});
