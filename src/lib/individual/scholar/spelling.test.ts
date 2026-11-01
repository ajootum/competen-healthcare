import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classificationReadings, editDistance, isDrugLike, normaliseLearnerText, spellingNotice, vocabularyOf } from "./spelling";

// Owner instruction 1 Nov 2026 item 8: deterministic spelling and terminology normalisation that never alters clinically
// significant content.

const n = (t: string, o?: Parameters<typeof normaliseLearnerText>[1]) => normaliseLearnerText(t, o);

describe("everyday slips are corrected, with casing and punctuation kept", () => {
  it("the owner's example", () => {
    const r = n("Expalin the etiology of UTIs");
    expect(r.display).toBe("Explain the etiology of UTIs");
    expect(r.original).toBe("Expalin the etiology of UTIs");
    expect(r.corrections).toEqual([{ from: "Expalin", to: "Explain", index: 0 }]);
    expect(r.needsClarification).toEqual([]);
  });
  it("lower case stays lower case, punctuation stays put", () => {
    expect(n("expalin, then desribe the managment?").display).toBe("explain, then describe the management?");
    expect(n("(Desribe) it.").display).toBe("(Describe) it.");
  });
  it("informal short forms are read as the word", () => {
    expect(n("shuld i giv him paracetamol").display).toBe("should i give him paracetamol");
  });
  it("Damerau distance counts a swap as one", () => {
    expect(editDistance("expalin", "explain")).toBe(1);
    expect(editDistance("managment", "management")).toBe(1);
    expect(editDistance("abc", "xyz", 2)).toBe(3);
  });
});

describe("clinically significant content is never silently changed", () => {
  it("a near miss of a medicine is asked, not changed", () => {
    const r = n("amoxicilin 500 mg");
    expect(r.display).toBe("amoxicilin 500 mg");
    expect(r.corrections).toEqual([]);
    expect(r.needsClarification).toEqual([{ token: "amoxicilin", index: 0, candidates: ["amoxicillin"] }]);
  });
  it("a near miss of a medical term is asked, not changed", () => {
    const r = n("expalin sepssis managment");
    expect(r.display).toBe("explain sepssis management");
    expect(r.needsClarification.map(c => [c.token, c.candidates])).toEqual([["sepssis", ["sepsis"]]]);
  });
  it("numbers, doses, units and values are untouched", () => {
    for (const t of ["Give 0.9% saline 500 ml over 30 mins", "K 6.5 mmol/L", "5mg", "1:1000", "x=3", "10 u insulin", "eGFR 45 mL/min/1.73m2"]) {
      expect(n(t).display, t).toBe(t);
      expect(n(t).corrections, t).toEqual([]);
    }
  });
  it("abbreviations and mixed case are untouched", () => {
    for (const t of ["UTI COPD NEWS2 SBAR ABCDE", "SpO2 and eGFR", "Use SBAR for handover"]) expect(n(t).display, t).toBe(t);
  });
  it("medicine names and medicine-like endings are untouched", () => {
    for (const t of ["amoxicillin flucloxacillin ramipril bisoprolol losartan omeprazole atorvastatin enoxaparin ciprofloxacin", "tirzepatide adalimumab osimertinib"]) {
      const r = n(t);
      expect(r.display, t).toBe(t);
      expect(r.needsClarification, t).toEqual([]);
    }
    expect(isDrugLike("tirzepatide")).toBe(true);
    expect(isDrugLike("done")).toBe(false);
  });
  it("a correction never lands on a clinical value (laterality, direction, numbers)", () => {
    const r = n("the riht leg");
    expect(r.display).toBe("the riht leg");
    expect(r.needsClarification[0]).toMatchObject({ token: "riht", candidates: ["right"] });
  });
  it("a name is not a typo; the learner's own material words are not typos", () => {
    expect(n("Name: John Smith").display).toBe("Name: John Smith");
    expect(n("we met Sharon today").display).toBe("we met Sharon today");
    expect(n("the donabedain triad").needsClarification).toEqual([]);
    const withNotes = n("the donabedain triad", { vocabulary: vocabularyOf(["The Donabedian model: structure, process, outcome"]) });
    expect(withNotes.display).toBe("the donabedain triad");
    expect(withNotes.needsClarification).toEqual([{ token: "donabedain", index: 4, candidates: ["donabedian"] }]);
    expect(n("explain the zorblax", { vocabulary: ["zorblax"] }).corrections).toEqual([]);
  });
  it("ambiguous: a tie between two everyday words changes nothing", () => {
    const r = n("what is the bist one");
    expect(r.display).toBe("what is the bist one");
  });
});

describe("British and American spellings", () => {
  it("both are valid, and neither is changed without a variant", () => {
    const t = "paediatric pediatric aetiology etiology haemoglobin hemoglobin oedema edema anaesthesia anesthesia organise organize";
    expect(n(t).display).toBe(t);
    expect(n(t).needsClarification).toEqual([]);
  });
  it("with a variant, only the variant pairs are converted", () => {
    expect(n("Organise paediatric haemoglobin, oedema and anaesthesia notes; expalin", { variant: "en-US" }).display)
      .toBe("Organize pediatric hemoglobin, edema and anesthesia notes; explain");
    expect(n("Organize pediatric hemoglobin, edema and anesthesia notes", { variant: "en-GB" }).display)
      .toBe("Organise paediatric haemoglobin, oedema and anaesthesia notes");
    expect(n("amoxicillin 500 mg", { variant: "en-GB" }).display).toBe("amoxicillin 500 mg");
  });
});

describe("the validation set is read as typed", () => {
  it("no correctly written study, ambiguous or high-risk question in the SCHOLAR-RISK-01 set is changed", () => {
    const SET = JSON.parse(readFileSync(new URL("../../../lib/ai/fixtures/scholar-risk01-validation.json", import.meta.url), "utf8"));
    const all: string[] = [...SET.educational, ...SET.ambiguous, ...SET.high, ...SET.heldOut.map((x: [string, string]) => x[1])];
    const changed = all.filter(t => n(t).display !== t);
    expect(changed).toEqual([]);
  });
});

describe("classification readings", () => {
  it("as typed, as corrected, and with asked words beside their candidates", () => {
    const { readings } = classificationReadings("expalin sepssis managment");
    expect(readings).toEqual(["expalin sepssis managment", "explain sepssis management", "explain sepssis sepsis management"]);
    expect(classificationReadings("Explain sepsis").readings).toEqual(["Explain sepsis"]);
  });
  it("a page is told nothing when the text was read as typed", () => {
    expect(spellingNotice(n("Explain sepsis"))).toEqual({});
    expect(spellingNotice(n("Expalin sepsis")).spelling?.display).toBe("Explain sepsis");
  });
});
