import { describe, it, expect } from "vitest";
import {
  parseCpuDocument, parseCpuBundle, splitCpuBundle, splitSections,
  parseQuestions, classifyOutcomes, numberedGroupHeadings, isListItem,
  knowledgeTypeFor, extractKnowledgeObjects, extractCases,
} from "./cpu-parser";

// Word list paragraphs survive .docx→text with a trailing space — that is how
// the parser tells list items from headings. `li()` reproduces that in fixtures.
const li = (s: string) => `${s} `;
const doc = (...lines: string[]) => lines.join("\n");

describe("isListItem", () => {
  it("treats trailing-space lines and bulleted lines as list items", () => {
    expect(isListItem("Assess muscle tone ")).toBe(true);
    expect(isListItem("• Assess muscle tone")).toBe(true);
    expect(isListItem("- Assess muscle tone")).toBe(true);
  });
  it("treats headings and prose as non-items", () => {
    expect(isListItem("Competency Domains")).toBe(false);
    expect(isListItem("Assessment should encompass the following domains:")).toBe(false);
  });
});

describe("splitCpuBundle", () => {
  const bundle = doc(
    "CPU-DIS-010: Gait Assessment",
    "10.1 Introduction",
    "Gait matters.",
    "CPU-DIS-011: Autonomic Assessment",
    "11.1 Introduction",
    "Autonomics matter.",
  );

  it("splits a document containing several CPUs", () => {
    const blocks = splitCpuBundle(bundle);
    expect(blocks.map(b => b.code)).toEqual(["CPU-DIS-010", "CPU-DIS-011"]);
  });

  it("ignores cross-references written as list items", () => {
    const withRef = doc(
      "CPU-DIS-010: Gait Assessment",
      "10.1 Introduction",
      "Builds on earlier units:",
      li("CPU-DIS-006: Motor system assessment."),
      li("CPU-DIS-005: Cranial nerve assessment."),
    );
    expect(splitCpuBundle(withRef).map(b => b.code)).toEqual(["CPU-DIS-010"]);
  });

  it("ignores headers with no numbered sections, and strips Word artefacts", () => {
    const noisy = doc(
      "CPU-DIS-012: Meningeal AssessmentBottom of Form",
      "12.1 Introduction",
      "Meninges matter.",
    );
    const blocks = splitCpuBundle(noisy);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe("Meningeal Assessment");
  });

  it("de-duplicates repeated running headers, keeping the fullest block", () => {
    const repeated = doc(
      "CPU-DIS-011: Autonomic Assessment",
      "11.1 Introduction",
      "Short.",
      "CPU-DIS-011: Autonomic Assessment",
      "11.1 Introduction",
      "A considerably longer body of content that should win the de-duplication.",
    );
    const blocks = splitCpuBundle(repeated);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain("considerably longer");
  });

  it("parseCpuBundle returns one result per contained CPU", () => {
    expect(parseCpuBundle(bundle).map(c => c.code)).toEqual(["CPU-DIS-010", "CPU-DIS-011"]);
  });
});

describe("parseQuestions", () => {
  it('reads the "Answer: B" form with a rationale', () => {
    const body = [
      "Question 1",
      "Which finding suggests a myopathy?",
      "A. Distal weakness",
      "B. Symmetrical proximal weakness",
      "Answer: B",
      "Rationale: Proximal symmetrical weakness suggests primary muscle disease.",
    ];
    const { questions } = parseQuestions(body);
    expect(questions).toHaveLength(1);
    expect(questions[0].correctIndex).toBe(1);
    expect(questions[0].options).toHaveLength(2);
    expect(questions[0].rationale).toContain("primary muscle disease");
  });

  it('reads the bare "Answer" + "✅ C" form', () => {
    const body = [
      "Question 1",
      "Target SpO2 for most acutely ill adults?",
      "A. 85–90%", "B. 70–80%", "C. 94–98%",
      "Answer",
      "✅ C",
    ];
    const { questions } = parseQuestions(body);
    expect(questions[0].correctIndex).toBe(2);
  });

  it("skips short-answer items quietly and reports them once", () => {
    const body = [
      "Question 1",
      "Name the three classic features of normal pressure hydrocephalus.",
      "Answer",
      li("Gait disturbance."),
      "Question 2",
      "List five characteristics of a normal gait.",
      "Suggested Answer",
      li("Symmetrical stride length."),
    ];
    const { questions, warnings } = parseQuestions(body);
    expect(questions).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/2 short-answer\/case items skipped/);
  });

  it("flags an MCQ with no answer key instead of guessing", () => {
    const body = ["Question 1", "Which is correct?", "A. One", "B. Two"];
    const { questions, warnings } = parseQuestions(body);
    expect(questions[0].correctIndex).toBeNull();
    expect(warnings.some(w => /no answer key/.test(w))).toBe(true);
  });
});

describe("classifyOutcomes", () => {
  it("splits flat outcomes into knowledge vs skills by leading verb", () => {
    const { knowledge, skills } = classifyOutcomes([
      "Explain the neuroanatomy of gait",
      "Describe the gait cycle",
      "Perform a systematic gait assessment",
      "Assess balance using the Romberg test",
    ]);
    expect(knowledge).toHaveLength(2);
    expect(skills).toEqual(["Perform a systematic gait assessment", "Assess balance using the Romberg test"]);
  });
});

describe("numberedGroupHeadings", () => {
  it("reads numbered thematic groups but not list items", () => {
    const body = [
      "1. Explain the Functional Anatomy of the Neuromuscular Junction",
      li("Describe the motor unit."),
      "2. Recognise Myasthenia Gravis",
      li("Identify fatigable ptosis."),
    ];
    expect(numberedGroupHeadings(body)).toEqual([
      "Explain the Functional Anatomy of the Neuromuscular Junction",
      "Recognise Myasthenia Gravis",
    ]);
  });
});

describe("knowledgeTypeFor", () => {
  it("infers the knowledge type from the section title", () => {
    expect(knowledgeTypeFor("Functional Anatomy of Human Gait")).toBe("anatomy");
    expect(knowledgeTypeFor("Physiology of Walking and Balance")).toBe("physiology");
    expect(knowledgeTypeFor("Pathophysiology of Stroke")).toBe("pathophysiology");
    expect(knowledgeTypeFor("Classification of Neuromuscular Disorders")).toBe("classification");
    expect(knowledgeTypeFor("Timed Up and Go Test")).toBe("assessment_tool");
    expect(knowledgeTypeFor("Clinical Reasoning and Interpretation")).toBe("clinical_reasoning");
    expect(knowledgeTypeFor("Something Unrelated")).toBe("other");
  });
  it("prefers pathophysiology over the looser physiology match", () => {
    expect(knowledgeTypeFor("Pathophysiology of Gait Disorders")).toBe("pathophysiology");
  });
});

describe("extractKnowledgeObjects", () => {
  const prose = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i} of substantive clinical prose about the subject.`).join(" ");

  it("captures substantive prose sections and types them", () => {
    const sections = splitSections(doc(
      "10.4 Functional Anatomy of Human Gait",
      prose(40),
      "10.5 Physiology of Walking",
      prose(40),
    ));
    const kos = extractKnowledgeObjects(sections);
    expect(kos.map(k => k.type)).toEqual(["anatomy", "physiology"]);
    expect(kos[0].section).toBe("10.4");
    expect(kos[0].words).toBeGreaterThan(120);
  });

  it("excludes structural sections and thin sections", () => {
    const sections = splitSections(doc(
      "10.1 Introduction", prose(40),                    // structural
      "10.2 Learning Outcomes", prose(40),               // structural
      "10.28 Self-Assessment Questions", prose(40),      // structural
      "10.9 Tandem Walking", "Too short to govern.",     // thin
    ));
    expect(extractKnowledgeObjects(sections)).toHaveLength(0);
  });

  it("keeps prose but drops list items from the content", () => {
    const sections = splitSections(doc(
      "10.6 Classification of Gait Disorders",
      prose(40),
      li("Spastic gait."),
      li("Ataxic gait."),
    ));
    const [ko] = extractKnowledgeObjects(sections);
    expect(ko.content).not.toContain("Spastic gait");
    expect(ko.content).toContain("substantive clinical prose");
  });
});

describe("extractCases", () => {
  const sections = splitSections(doc(
    "10.25 Clinical Case Studies",
    "Cases bridge theory and practice.",
    "Case Study 1 – Acute Hemiplegic Gait",
    "Clinical Scenario",
    "A 68-year-old man suddenly began dragging his right leg.",
    "Assessment Findings",
    "Gait",
    li("Circumduction of the right leg."),
    li("Reduced right arm swing."),
    "Questions",
    li("What gait abnormality is present?"),
    li("What is the most likely diagnosis?"),
    "Discussion",
    "Gait Pattern",
    "Hemiplegic gait.",
    "Learning Points",
    li("Acute hemiplegic gait is a neurological emergency."),
    "Case Study 2 – Cerebellar Ataxia",
    "Clinical Scenario",
    "A 54-year-old woman reports unsteadiness.",
    "Questions",
    li("Where is the lesion?"),
  ));

  const cases = extractCases(sections);

  it("splits the section into individual cases and reads their titles", () => {
    expect(cases).toHaveLength(2);
    expect(cases[0].title).toBe("Acute Hemiplegic Gait");
    expect(cases[1].title).toBe("Cerebellar Ataxia");
  });
  it("separates scenario, findings, questions, discussion and learning points", () => {
    const c = cases[0];
    expect(c.scenario).toContain("68-year-old man");
    expect(c.findings).toContain("Circumduction");
    expect(c.questions).toEqual(["What gait abnormality is present?", "What is the most likely diagnosis?"]);
    expect(c.discussion).toContain("Hemiplegic gait");
    expect(c.learningPoints).toEqual(["Acute hemiplegic gait is a neurological emergency"]);
  });
  it("does not leak one case's content into the next", () => {
    expect(cases[0].scenario).not.toContain("54-year-old");
    expect(cases[1].questions).toEqual(["Where is the lesion?"]);
    expect(cases[1].learningPoints).toEqual([]);
  });
  it("returns nothing when the document has no case-study section", () => {
    expect(extractCases(splitSections(doc("10.1 Introduction", "Prose.")))).toEqual([]);
  });
});

describe("parseCpuDocument — end to end", () => {
  const sample = doc(
    "CPU-DIS-010: Gait, Balance and Mobility Assessment",
    "10.1 Introduction",
    "Assessment of gait is the culmination of the neurological examination.",
    "10.2 Learning Outcomes",
    "Knowledge Outcomes",
    "By the end of this unit, the learner should be able to:",
    li("Explain the neuroanatomy of normal gait."),
    li("Describe the phases of the gait cycle."),
    "Clinical Skills Outcomes",
    "By the end of this unit, the learner should be able to:",
    li("Prepare the patient for safe gait assessment."),
    li("Perform the Romberg test."),
    "10.21 Red Flags in Gait Assessment",
    "Urgent assessment is warranted when gait disturbance is:",
    li("Acute in onset."),
    li("Rapidly progressive."),
    "10.28 Self-Assessment Questions",
    "Question 1",
    "Which system is essential for balance?",
    "A. Endocrine", "B. Vestibular",
    "Answer: B",
    "10.30 Competency Assessment Rubric",
    "Competency Domains",
    "Assessment should encompass the following domains:",
    li("Professionalism and Patient Safety"),
    li("Clinical Reasoning and Neurological Localisation"),
  );

  const parsed = parseCpuDocument(sample);

  it("reads the code and title", () => {
    expect(parsed.code).toBe("CPU-DIS-010");
    expect(parsed.title).toBe("Gait, Balance and Mobility Assessment");
  });
  it("prefers the rubric's competency domains", () => {
    expect(parsed.competencies).toEqual([
      "Professionalism and Patient Safety",
      "Clinical Reasoning and Neurological Localisation",
    ]);
  });
  it("separates skills from knowledge using the outcome headings", () => {
    expect(parsed.skills).toEqual(["Prepare the patient for safe gait assessment", "Perform the Romberg test"]);
    expect(parsed.knowledge).toHaveLength(2);
  });
  it("reads red flags as critical-failure candidates", () => {
    expect(parsed.redFlags).toEqual(["Acute in onset", "Rapidly progressive"]);
  });
  it("reads the question bank", () => {
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].correctIndex).toBe(1);
  });

  it("warns rather than inventing content when sections are missing", () => {
    const thin = doc("CPU-DIS-099: Thin Unit", "99.1 Introduction", "Short.");
    const p = parseCpuDocument(thin);
    expect(p.code).toBe("CPU-DIS-099");
    expect(p.competencies).toHaveLength(0);
    expect(p.warnings.some(w => /No competencies/.test(w))).toBe(true);
    expect(p.warnings.some(w => /Red Flags/.test(w))).toBe(true);
  });
});
