import { describe, expect, it } from "vitest";
import { carriedOf, checkLibraryMeta, fitsLearner, mappingStatus, metaFromFields, metaOf, metaSummary, qualificationOf } from "./library-meta";
import { libraryCopyOf, validateLibraryQuestion } from "./library-format";
import { adaptiveLibraryFits } from "./library-questions";

// SQIE-CLOSE-2026-11 WS-E / WS-F: programme, qualification level, difficulty and provenance on library items (the pilot
// batch's key names), and reuse by learner fit.

const pilotKeys = {
  programme_code: "nursing-ug-diploma", programme_label: "Nursing (Uganda), diploma",
  qualification_level: "pre_registration_diploma", qualification_label: "Pre-registration nursing, diploma", difficulty: "intermediate",
  references: [{ id: "RM-10", supports: "MAP formula" }], source_verification: { status: "not_verified", label: "source not verified" },
  competency_mapping: { status: "draft", validated: true, framework_code: "NUR-CCF", framework_version: "1.0.0", competency_code: "NUR-CCF-010", competency_name: "Hemodynamic Assessment", learning_objective: "Recognises changes in haemodynamic status", framework_pub_status_at_mapping: "draft" },
  calculation: { value: 66, unit: "mmHg", decimals: 0, tolerance: { absolute: 0, percent: 0 } }, misconception_tags: ["unit-omitted"], topic: "Cardiovascular assessment", question_type: "calculation", pilot_batch: "SQIE-PILOT-2026-11-v1",
};

describe("checkLibraryMeta", () => {
  it("absent keys are no metadata, never a refusal", () => { expect(checkLibraryMeta({ stem: "x" })).toEqual({ ok: true, fields: {} }); });
  it("keeps every pilot key", () => { expect(checkLibraryMeta(pilotKeys)).toEqual({ ok: true, fields: pilotKeys }); });
  it("refuses what 995 refuses", () => {
    for (const bad of [{ programme_code: "Not A Code" }, { qualification_level: "Pre Reg" }, { difficulty: "hard" }, { difficulty: 2 }, { references: "RM" }, { references: ["RM"] },
      { competency_mapping: ["draft"] }, { calculation: 66 }, { misconception_tags: [1] }, { misconception_tags: [""] }, { question_type: "Calc!" }])
      expect(checkLibraryMeta(bad).ok).toBe(false);
  });
});

describe("metaOf and carriedOf", () => {
  it("reads the metadata and the carried provenance apart", () => {
    expect(metaOf(pilotKeys)).toEqual({ programmeCode: "nursing-ug-diploma", programmeLabel: "Nursing (Uganda), diploma", qualificationLevel: "pre_registration_diploma", qualificationLabel: "Pre-registration nursing, diploma", difficulty: "intermediate" });
    expect(Object.keys(carriedOf(pilotKeys)).sort()).toEqual(["calculation", "competency_mapping", "misconception_tags", "pilot_batch", "question_type", "references", "source_verification", "topic"]);
  });
});

describe("qualificationOf", () => {
  it("reads codes and words", () => {
    expect(qualificationOf("pre_registration_diploma")).toBe("diploma");
    expect(qualificationOf("BSc Nursing", "Year 2")).toBe("degree");
    expect(qualificationOf("Enrolled Nurse certificate")).toBe("certificate");
    expect(qualificationOf("MSc Advanced Practice")).toBe("postgraduate");
    expect(qualificationOf("Nursing", null)).toBeNull();
  });
});

describe("fitsLearner: only a KNOWN mismatch excludes", () => {
  const meta = { programmeCode: "nursing-ug-diploma", qualificationLevel: "pre_registration_diploma" };
  it("matches, unknowns and untagged items are offered", () => {
    expect(fitsLearner(meta, { programmeCode: "nursing-ug-diploma", level: "diploma" })).toBe(true);
    expect(fitsLearner(meta, { programmeCode: null, level: null })).toBe(true);
    expect(fitsLearner(null, { programmeCode: "x-y", level: "certificate" })).toBe(true);
  });
  it("another programme or qualification family is not offered", () => {
    expect(fitsLearner(meta, { programmeCode: "bsc-nursing", level: null })).toBe(false);
    expect(fitsLearner(meta, { programmeCode: null, level: "degree" })).toBe(false);
  });
});

describe("mappingStatus: a draft mapping is never shown as evidence (owner decision 3)", () => {
  it("a mapping that SAYS validated, on a draft framework, is a draft", () => { expect(mappingStatus(pilotKeys, "published").status).toBe("draft"); });
  it("only a published version on a published framework version is validated", () => {
    const c = { competency_mapping: { ...pilotKeys.competency_mapping, framework_pub_status_at_mapping: "published" } };
    expect(mappingStatus(c, "submitted").status).toBe("draft");
    expect(mappingStatus(c, "published")).toMatchObject({ status: "validated", framework: "NUR-CCF", version: "1.0.0", competency: "NUR-CCF-010 Hemodynamic Assessment" });
  });
  it("none recorded", () => { expect(mappingStatus({}, "published").status).toBe("none"); });
});

const shortQ = {
  format: "short", stem: "Calculate the MAP for 102/48 mmHg, as a whole number with its unit.", options: [], answerKey: { accepted: ["66 mmHg"] },
  marking: "deterministic", rationale: "MAP = (102 + 2 x 48) / 3 = 66 mmHg.",
};

describe("validateLibraryQuestion keeps the metadata and provenance; the learner copy is unchanged", () => {
  it("a format question keeps every pilot key, and its copy equals the untagged copy", () => {
    const tagged = validateLibraryQuestion({ ...shortQ, ...pilotKeys });
    const plain = validateLibraryQuestion(shortQ);
    expect(tagged.ok && plain.ok).toBe(true);
    if (!tagged.ok || !plain.ok) return;
    expect(tagged.content).toMatchObject(pilotKeys);
    expect(libraryCopyOf(tagged.content)).toEqual(libraryCopyOf(plain.content));
  });
  it("a legacy 442 question is unchanged, with or without the keys; a bad key is refused", () => {
    const legacy = { stem: "Which vein is used for most adult cannulations?", options: ["Cephalic", "Femoral", "Jugular", "Saphenous"], correct_index: 0, rationale: "The cephalic vein is commonly used." };
    const a = validateLibraryQuestion(legacy);
    expect(a.ok && a.content).toBe(legacy);
    expect(validateLibraryQuestion({ ...legacy, difficulty: "advanced" }).ok).toBe(true);
    expect(validateLibraryQuestion({ ...legacy, difficulty: "nope" }).ok).toBe(false);
  });
  it("form fields with nothing set add nothing", () => { expect(metaFromFields({ programmeCode: "", qualificationLevel: "", difficulty: "" })).toEqual({}); });
  it("a short summary for lists", () => {
    expect(metaSummary(metaOf(pilotKeys))).toBe("Pre-registration nursing, diploma · Intermediate · nursing-ug-diploma");
    expect(metaSummary(null)).toBeNull();
  });
});

describe("adaptiveLibraryFits (WS-F): every exam format, never a look-alike", () => {
  const lib = (["mcq", "mrq", "short", "match", "sequence", "structured", "cloze", "true_false", "extended", "flashcard"] as const).map(format => ({ format }));
  it("reuses the exam's formats, not only mcq", () => {
    expect(adaptiveLibraryFits(lib, ["mcq", "mrq", "short", "match", "sequence", "structured"]).map(x => x.format)).toEqual(["mcq", "mrq", "short", "match", "sequence", "structured"]);
  });
  it("cloze, true/false and extended (stored as short) and flashcards are not the short answer an exam asked for", () => {
    expect(adaptiveLibraryFits(lib, ["short"]).map(x => x.format)).toEqual(["short"]);
  });
  it("a legacy item (no format) is a single best answer", () => {
    expect(adaptiveLibraryFits([{}], ["mcq"]).length).toBe(1);
    expect(adaptiveLibraryFits([{}], ["mrq"]).length).toBe(0);
  });
});
