// Generates the CPU authoring template as a Word .docx with real Word list
// styles already applied — authors fill in the blanks and the importer reads it
// cleanly. Run: node scripts/make-cpu-template.mjs
import { Document, Packer, Paragraph, TextRun, HeadingLevel, LevelFormat, AlignmentType } from "docx";
import { writeFileSync } from "node:fs";

const OUT = "C:/Users/USER/Documents/Competent/COMPETEN-CPU-Authoring-Template.docx";

const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts.run })], ...opts.para });
const H = (text, level) => new Paragraph({ heading: level, children: [new TextRun(text)] });
// Real Word bullet — this is what the importer detects as a list item
const B = (text) => new Paragraph({ numbering: { reference: "cpu-bullets", level: 0 }, children: [new TextRun(text)] });
const Guide = (text) => new Paragraph({
  children: [new TextRun({ text, italics: true, color: "9A3412", size: 18 })],
  spacing: { after: 120 },
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial", color: "0A2E38" },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 25, bold: true, font: "Arial", color: "12A594" },
        paragraph: { spacing: { before: 260, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: "cpu-bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
    },
    children: [
      P("COMPETEN — Clinical Practice Unit Authoring Template", { run: { bold: true, size: 34, color: "0A2E38" } }),
      Guide("Replace every [bracketed] prompt with your content. Keep the headings exactly as written — the importer looks for them. Keep bullet lists as Word bullets (this template already applies them). Delete these orange guidance notes before submitting."),
      Guide("Numbering: replace “10” throughout with your CPU’s chapter number, unique to this CPU."),

      H("CPU-DIS-010: [Full CPU Title]", HeadingLevel.HEADING_1),
      Guide("↑ The header must be its own line in the form CPU-XXX-NNN: Title"),

      H("10.1 Introduction", HeadingLevel.HEADING_2),
      Guide("Becomes → the CPU description. Two or three paragraphs of prose (no bullets)."),
      P("[Explain what this area of clinical practice is, why it matters, and where it sits relative to other CPUs.]"),

      H("10.2 Learning Outcomes", HeadingLevel.HEADING_2),
      Guide("Both sub-headings below are required. Knowledge verbs: Explain, Describe, Discuss, Define, Outline, List, Differentiate. Skill verbs: Perform, Assess, Prepare, Evaluate, Demonstrate, Recognise, Document, Escalate."),

      H("Knowledge Outcomes", HeadingLevel.HEADING_3),
      P("By the end of this unit, the learner should be able to:"),
      B("Explain [the anatomy / physiology underpinning this practice]."),
      B("Describe [the key clinical concepts]."),
      B("Discuss [relevant conditions, risks or variations]."),

      H("Clinical Skills Outcomes", HeadingLevel.HEADING_3),
      Guide("Becomes → skills in the reusable skill library. One action per bullet."),
      P("By the end of this unit, the learner should be able to:"),
      B("Prepare [the patient and environment for the assessment]."),
      B("Perform [the core technique]."),
      B("Assess [the specific finding]."),
      B("Document [findings to the required standard]."),

      H("10.3 Scope of Clinical Practice", HeadingLevel.HEADING_2),
      Guide("Becomes → the CPU scope. Prose: settings, professional groups, responsibilities."),
      P("[Describe where this practice is performed and by whom.]"),

      H("10.21 Red Flags in [Practice Area]", HeadingLevel.HEADING_2),
      Guide("Becomes → CRITICAL-FAILURE RULES. A learner failing one of these cannot be judged competent regardless of score — list only findings that genuinely carry that weight. The lead-in line must end with a colon."),
      P("[Brief prose introduction.]"),
      P("Urgent assessment is warranted when:"),
      B("[Acute in onset]."),
      B("[Rapidly progressive]."),
      B("[Associated with new focal neurological deficits]."),

      H("10.28 Self-Assessment Questions", HeadingLevel.HEADING_2),
      Guide("Becomes → the knowledge test (MCQ bank). Use “Answer: B” and “Rationale:” exactly. Keep short-answer questions in their own section below — never in the same Question numbering as the MCQs."),

      H("Multiple Choice Questions (MCQs)", HeadingLevel.HEADING_3),
      P("Question 1"),
      P("[Question stem — one best answer.]"),
      P("A. [Option A]"),
      P("B. [Option B]"),
      P("C. [Option C]"),
      P("D. [Option D]"),
      P("Answer: B"),
      P("Rationale: [Why B is correct.]"),
      P(""),
      P("Question 2"),
      P("[…repeat the pattern…]"),

      H("Short Answer Questions", HeadingLevel.HEADING_3),
      Guide("These are NOT imported (no lettered options) — that is expected. Keep them here so they don’t break the MCQ numbering."),
      P("Question 1"),
      P("[Short answer question.]"),
      P("Suggested Answer"),
      B("[Expected point one.]"),

      H("10.29 Practical Skills Checklist (OSCE)", HeadingLevel.HEADING_2),
      Guide("Shown at import; built in the Checklist Builder once skills are attached to competencies."),
      P("[Purpose of the OSCE station.]"),
      H("Learning Outcomes Assessed", HeadingLevel.HEADING_3),
      P("By completing this OSCE, the learner should demonstrate the ability to:"),
      B("[Prepare the environment and patient safely]."),
      B("[Explain the assessment and obtain informed consent]."),
      B("[Perform the assessment systematically]."),

      H("10.30 Competency Assessment Rubric", HeadingLevel.HEADING_2),
      Guide("THE MOST IMPORTANT LIST IN THE DOCUMENT. “Competency Domains” becomes → the CPU’s competencies. Aim for 5–10 domains that together describe competent practice."),
      P("[Purpose of the rubric.]"),
      H("Competency Domains", HeadingLevel.HEADING_3),
      P("Assessment should encompass the following domains:"),
      B("Professionalism and Patient Safety"),
      B("Communication and Patient-Centred Care"),
      B("Knowledge of [subject] Physiology"),
      B("Technical Performance of [the assessment]"),
      B("Clinical Reasoning and Interpretation"),
      B("Clinical Decision-Making and Escalation"),
      B("Documentation and Reporting"),

      P(""),
      P("Author checklist before submitting", { run: { bold: true, size: 24, color: "0A2E38" } }),
      B("Header line CPU-XXX-NNN: Title at the very top"),
      B("Every section numbered N.x, with N unique to this CPU"),
      B("Learning Outcomes has BOTH Knowledge Outcomes and Clinical Skills Outcomes"),
      B("Every list is a real Word bullet list (not typed dashes)"),
      B("Red Flags section has a colon lead-in and a real list"),
      B("MCQs use “Answer: X” and “Rationale:”; short answers are in their own section"),
      B("Competency Assessment Rubric contains a Competency Domains list"),
      B("References to other CPUs are bullets, never standalone lines"),
      B("Orange guidance notes deleted"),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(OUT, buf);
console.log(`Template written: ${OUT} (${(buf.length / 1024).toFixed(0)} KB)`);
