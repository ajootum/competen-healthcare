import { describe, expect, it } from "vitest";
import { mapPassportItems } from "./document-passport";
import type { DocRecord } from "../documents/model";
import type { PassportItem } from "../passport-view";

// PR7 x Stage 7: a Passport link's items become the Studio's own stable keys; unstable Passport keys are never stored,
// and anything that cannot be matched is reported, never guessed.

const rec = (key: string, kind: DocRecord["kind"], title: string, date: string | null = null): DocRecord =>
  ({ key, kind, sections: ["learning_cpd"], title, subtitle: null, from: null, to: null, date, trust: "self_declared", validity: "not_applicable", source: "x", facts: [] });
const item = (key: string, category: PassportItem["category"], title: string, date: string | null = null): PassportItem =>
  ({ key, category, sourceService: "x", title, description: null, issuer: null, date, version: null, evidenceRef: null, method: null, authority: null, trust: "self_declared", validity: "not_applicable", meaning: "x" });

describe("mapPassportItems", () => {
  const own = [rec("cpd:c1", "cpd", "ECG workshop"), rec("learning_record:r1", "learning_record", "ECG course"), rec("profile_item:p1", "profile_item", "Professional registration", "2019-03-01"),
    rec("competency:e1", "competency", "Interprets ECGs"), rec("evaluation:v1", "evaluation", "Evaluation: ECG")];
  it("maps id keys directly, matches the rest by kind and title, and stores no Passport key", () => {
    const { keys, unmatched } = mapPassportItems([
      item("cpd:c1", "cpd", "ECG workshop"), item("learning:r1", "learning", "ECG course"), item("evaluation:530:v1", "evaluation", "ECG"),
      item("profile:0", "profile", "Professional registration", "2019-03-01"), item("competency:0:evidence:1", "competency", "Interprets ECGs: Observed reading"),
      item("profile:overview", "profile", "Professional overview"),
    ], own);
    expect(keys).toEqual(["cpd:c1", "learning_record:r1", "evaluation:v1", "profile_item:p1", "competency:e1"]);
    expect(keys.some(k => /^profile:|^competency:\d|^institution:/.test(k))).toBe(false);
    expect(unmatched).toEqual([]);
  });
  it("a record that is not the person's own, or cannot be matched, is reported and not placed", () => {
    const { keys, unmatched } = mapPassportItems([item("cpd:someone-else", "cpd", "Other"), item("profile:3", "profile", "Unknown record")], own);
    expect(keys).toEqual([]);
    expect(unmatched).toEqual(["Other", "Unknown record"]);
  });
});
