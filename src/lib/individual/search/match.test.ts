import { describe, expect, it } from "vitest";
import { matchesSearch, oneSlip, searchWords } from "./match";

describe("matchesSearch", () => {
  it("an empty search matches everything", () => {
    expect(matchesSearch("Anything", "")).toBe(true);
    expect(matchesSearch("Anything", "   ")).toBe(true);
    expect(matchesSearch("Anything", null)).toBe(true);
  });
  it("finds part of a word, in any case", () => {
    expect(matchesSearch("Recognising Deterioration Notes", "deterio")).toBe(true);
    expect(matchesSearch("Recognising Deterioration Notes", "NOTES")).toBe(true);
  });
  it("every word must match, so another word narrows the list", () => {
    expect(matchesSearch("Recognising Deterioration Notes", "deterioration notes")).toBe(true);
    expect(matchesSearch("Recognising Deterioration Notes", "deterioration sepsis")).toBe(false);
  });
  it("reads across several fields", () => {
    expect(matchesSearch(["Oxygen therapy", "Respiratory"], "oxygen respiratory")).toBe(true);
  });
  it("ignores punctuation", () => {
    expect(matchesSearch("Plan-Do-Study-Act cycles", "plan do")).toBe(true);
    expect(matchesSearch("Plan do study act", "plan-do")).toBe(true);
  });
  it("uses the curated synonyms", () => {
    expect(matchesSearch("Using SBAR on handover", "situation background assessment recommendation")).toBe(true);
    expect(matchesSearch("Plan do study act cycles", "pdsa")).toBe(true);
  });
  it("forgives one slip of the keyboard", () => {
    expect(matchesSearch("Deterioration", "deteroration")).toBe(true);
    expect(matchesSearch("Deterioration", "detreioration")).toBe(true);
    expect(matchesSearch("Anaemia", "anemia")).toBe(true);
  });
  it("⚠ never swaps opposite clinical terms", () => {
    expect(matchesSearch("Hypertension", "hypotension")).toBe(false);
    expect(matchesSearch("Hyperkalaemia", "hypokalaemia")).toBe(false);
    expect(matchesSearch("Hyperglycaemia", "hypoglycaemia")).toBe(false);
  });
  it("⚠ a typo never lands on an opposite", () => {
    for (const typo of ["hypetension", "hyprtension", "hypotnsion", "hyptension"]) {
      expect(matchesSearch("Hypertension", typo)).toBe(false);
      expect(matchesSearch("Hypotension", typo)).toBe(false);
    }
    expect(matchesSearch("Hypokalaemia", "hypekalaemia")).toBe(false);
    expect(matchesSearch("Hypothermia", "hypthermia")).toBe(false);
  });
  it("⚠ never swaps terms that differ by one letter", () => {
    for (const [a, b] of [["abduction", "adduction"], ["exophthalmos", "enophthalmos"], ["dysphagia", "dysphasia"], ["aphasia", "aphagia"], ["perineal", "peroneal"], ["ileum", "ilium"], ["prostate", "prostrate"], ["colic", "cholic"], ["insulin", "inulin"]]) {
      expect(matchesSearch(b, a)).toBe(false);
      expect(matchesSearch(a, b)).toBe(false);
      expect(matchesSearch(a, a)).toBe(true);
    }
  });
  it("a synonym counts only as whole words", () => {
    expect(matchesSearch("A solution of saline", "urinary tract infection")).toBe(false);
    expect(matchesSearch("Acute appendicitis", "personal protective equipment")).toBe(false);
    expect(matchesSearch("The oesophagus", "standard operating procedure")).toBe(false);
    expect(matchesSearch("Treating a UTI at home", "urinary tract infection")).toBe(true);
    expect(matchesSearch("Choosing PPE", "personal protective equipment")).toBe(true);
    expect(matchesSearch("Personal protective equipment", "ppe")).toBe(true);
  });
  it("does not stretch short words", () => {
    expect(matchesSearch("Pain score", "rain")).toBe(false);
    expect(matchesSearch("The cat", "cut")).toBe(false);
  });
});

describe("oneSlip", () => {
  it("counts one edit only, with the same first letter", () => {
    expect(oneSlip("sepsiss", "sepsis")).toBe(true);
    expect(oneSlip("spesis", "sepsis")).toBe(true);
    expect(oneSlip("sepssi", "sepsis")).toBe(true);
    expect(oneSlip("aepsis", "sepsis")).toBe(false);
    expect(oneSlip("sepxyz", "sepsis")).toBe(false);
    expect(oneSlip("sepsos", "sepsis")).toBe(false);
  });
  it("splits words the same way as matching", () => {
    expect(searchWords("  Plan-Do  ")).toEqual(["plan", "do"]);
  });
});
