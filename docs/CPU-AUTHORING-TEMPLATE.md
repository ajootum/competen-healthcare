# CPU Authoring Template & Rules

How to write a Clinical Practice Unit document so COMPETEN imports it **completely and correctly**, first time.

Follow this and the importer produces the CPU, its competencies, skills, critical-failure rules and knowledge test with no manual repair. Deviate and the importer will still try — but it will report warnings and you will fix things by hand.

*Reference implementation: **CPU-DIS-010 (Gait, Balance and Mobility Assessment)** — it parses at 100%. When in doubt, copy its shape.*

---

## The five rules that matter most

1. **Use Word's real list styles** for every list (Home → Bullets or Numbering). Do **not** fake a list by typing "-" or pressing Tab. This is the single most important rule — it is how the importer tells a list item from a heading.
2. **Start with the CPU header on its own line**, exactly: `CPU-DIS-010: Gait, Balance and Mobility Assessment`
3. **Number every section** `N.1`, `N.2`, `N.3`… where `N` is the CPU's chapter number and is **unique per CPU** in the file.
4. **Use the exact section headings** listed below. The words matter — they are what the importer looks for.
5. **One CPU per file** is strongly preferred. Bundles (several CPUs in one file) do import, but they are harder to review and easier to get wrong.

---

## What each section becomes in the platform

| Your section | Becomes | Required? |
|---|---|---|
| `N.1 Introduction` | The CPU's description | **Yes** |
| `N.2 Learning Outcomes` → *Knowledge Outcomes* | Knowledge requirements | **Yes** |
| `N.2 Learning Outcomes` → *Clinical Skills Outcomes* | **Skills** (reusable library) | **Yes** |
| `N.3 Scope of Clinical Practice` | The CPU's scope | Recommended |
| `N.x Red Flags …` | **Critical-failure rules** (block competency) | **Yes** |
| `N.x Self-Assessment Questions` | **Knowledge test** (MCQ bank) | Recommended |
| `N.x Practical Skills Checklist (OSCE)` | Observation checklist | Recommended |
| `N.x Competency Assessment Rubric` → *Competency Domains* | **The competencies** | **Yes** |

> **The Competency Domains list is the most important list in the document.** It is the authoritative statement of what this CPU's competencies are. Without it the importer falls back to guessing from outcome groups.

---

## The skeleton

Copy this into Word, keeping the headings verbatim and using real Word lists where marked.

```
CPU-DIS-010: Gait, Balance and Mobility Assessment

10.1 Introduction
[Two or three paragraphs of prose: what this area of practice is and why it matters.]

10.2 Learning Outcomes

Knowledge Outcomes
By the end of this unit, the learner should be able to:
    • Explain the neuroanatomy of normal gait.            ← Word bullet list
    • Describe the phases of the gait cycle.
    • Discuss age-related changes affecting mobility.

Clinical Skills Outcomes
By the end of this unit, the learner should be able to:
    • Prepare the patient for safe gait assessment.        ← Word bullet list
    • Perform the Romberg test.
    • Assess balance using the Timed Up and Go test.

10.3 Scope of Clinical Practice
[Prose: settings, professional groups, responsibilities.]

10.21 Red Flags in Gait, Balance and Mobility Assessment
[Prose introduction.]
Urgent assessment is warranted when gait disturbance is:      ← lead-in MUST end with a colon
    • Acute in onset.                                          ← Word bullet list
    • Rapidly progressive.
    • Associated with new focal neurological deficits.

10.28 Self-Assessment Questions

Multiple Choice Questions (MCQs)

Question 1
Which system is essential for maintaining balance?
A. Endocrine system
B. Vestibular system
C. Digestive system
D. Lymphatic system
Answer: B
Rationale: The vestibular system provides head-position and equilibrium information.

Question 2
[…]

Short Answer Questions                                         ← keep these SEPARATE from MCQs
Question 11
List five characteristics of a normal gait.
Suggested Answer
    • Symmetrical stride length.

10.29 Practical Skills Checklist (OSCE)
[Prose purpose.]
Learning Outcomes Assessed
By completing this OSCE, the learner should demonstrate the ability to:
    • Prepare the environment and patient safely.              ← Word bullet list
    • Explain the assessment and obtain informed consent.

10.30 Competency Assessment Rubric
[Prose purpose.]
Competency Domains
Assessment should encompass the following domains:            ← lead-in ends with a colon
    • Professionalism and Patient Safety                       ← Word bullet list — THE COMPETENCIES
    • Communication and Patient-Centred Care
    • Knowledge of Gait and Balance Physiology
    • Technical Performance of Gait Assessment
    • Clinical Reasoning and Neurological Localisation
```

---

## Formatting rules in detail

**Lists**
- Always a real Word list. Every outcome, red flag, checklist item and competency domain must be a list item.
- Keep each item to **one line, under ~200 characters**. Long paragraphs are read as prose and ignored.
- A list must follow a lead-in line ending in a **colon**, or a sub-heading.

**Headings**
- Section headings: `10.4 Functional Anatomy of Human Gait` — number, space, title. Never end a heading with a full stop.
- Sub-headings (`Knowledge Outcomes`, `Competency Domains`) sit on their own line with **no** trailing punctuation and must **not** be list items.

**Learning outcomes**
- Always use both sub-headings: `Knowledge Outcomes` and `Clinical Skills Outcomes`.
- Start knowledge outcomes with: Explain, Describe, Discuss, Define, State, Outline, List, Differentiate, Compare.
- Start skill outcomes with a doing verb: Perform, Assess, Prepare, Evaluate, Demonstrate, Measure, Recognise, Interpret, Document, Escalate.
- *Why:* if the sub-headings are missing, the importer must guess the split from these verbs and will warn you.

**MCQs**
- `Question N` on its own line, then the stem, then options as `A.` `B.` `C.` `D.` at line start.
- The answer line must be exactly **`Answer: B`**. (The older `Answer` + `✅ C` form still works, but use `Answer: B`.)
- Rationale line: **`Rationale: …`**
- **Never** number short-answer questions in the same `Question N` sequence as MCQs — put them under a separate `Short Answer Questions` heading. Anything without lettered options is skipped.

**Red flags**
- One clinical finding per list item, phrased so it reads as a rule: *"Acute in onset"*, *"Associated with new focal neurological deficits"*.
- These become **critical-failure rules** — a learner failing one cannot be judged competent regardless of score. Only list things that genuinely carry that weight.

---

## Before you submit — author's checklist

- [ ] Header line `CPU-XXX-NNN: Title` at the very top
- [ ] Every section numbered `N.x`, `N` unique to this CPU
- [ ] `Introduction` present
- [ ] `Learning Outcomes` has **both** `Knowledge Outcomes` and `Clinical Skills Outcomes` sub-headings
- [ ] Every list uses **Word list formatting** (not typed dashes)
- [ ] `Red Flags` section with a colon lead-in and a real list
- [ ] MCQs use `Answer: X` and `Rationale:`; short answers are in their own section
- [ ] `Competency Assessment Rubric` contains a `Competency Domains` list
- [ ] Cross-references to other CPUs are **list items**, never standalone lines (otherwise they're read as a new CPU)

---

## What the platform still cannot store

Be aware these are authored but have nowhere to land yet — they are registered gaps, not silent losses:

- **Knowledge outcomes** (anatomy/physiology prose) — no knowledge-object store yet.
- **Clinical case studies** — no simulation/case module yet.
- **OSCE checklists** — imported to preview only; they attach to a skill, so they are built in the Checklist Builder after skills are assigned to competencies.

*Import it via Studio → 📄 Import CPU Document. Nothing is saved until you review the extraction and confirm; everything lands as a draft.*
