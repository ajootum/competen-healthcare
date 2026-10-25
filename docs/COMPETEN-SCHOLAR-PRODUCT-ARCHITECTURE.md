# Competen Scholar: the eight-stage product architecture (canonical)

| | |
|---|---|
| **Status** | **Canonical.** Owner decision 2026-10-25: "COMPETEN SCHOLAR — EIGHT-STAGE PRODUCT ARCHITECTURE". It restores and keeps the original eight-stage Scholar product model. |
| **Nature** | A product-definition clarification, **not** a new development authorisation. It reopens no completed stage and creates no new work. |
| **Technical artefacts** | Every workstream identifier, migration, record and accepted implementation keeps its name and number. This document maps them onto the eight stages; nothing is renamed or renumbered. |

## The eight stages

The stages are **interconnected, not compulsory sequential steps.** A student moves between them freely.

| # | Stage | What it is | Workstream(s) | Status |
|---|---|---|---|---|
| 1 | **Join** | Identity, entitlements and educational context | COMPETEN-SCHOLAR-JOIN-01 (`docs/COMPETEN-SCHOLAR-JOIN-01-stage1-join.md`) | Accepted (dev/staging) |
| 2 | **Upload** | Student-supplied learning materials | COMPETEN-SCHOLAR-UPLOAD-01 (`docs/COMPETEN-SCHOLAR-UPLOAD-01.md`, `…-UPLOAD-stage2.md`, `…-UPLOAD-limits.md`) | Accepted (dev/staging) |
| 3 | **Classify** | Continuous knowledge organisation and CFCA mapping | Existing classification infrastructure: COMPETEN-SCHOLAR-01 (`docs/COMPETEN-SCHOLAR-01-competency-learning.md`; migrations 387–390), outcome links (#92), case classification (#90) | Continuous background capability, in use. The optional **My Knowledge & Competencies** view is defined here and is not yet built. |
| 4 | **Learn** | AI-powered teaching and understanding | COMPETEN-SCHOLAR-LEARN-01 (`docs/COMPETEN-SCHOLAR-LEARN-01.md`) | Accepted (dev/staging) |
| 5 | **Revise** | Recall, retention and examination preparation | COMPETEN-SCHOLAR-REVISION-01 (`docs/COMPETEN-SCHOLAR-REVISION-01.md`; migrations 416, 417, 425) | Accepted, with bounded follow-ups. Closed. |
| 6 | **Apply** | Clinical reasoning, and broader application of knowledge | COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (`docs/COMPETEN-SCHOLAR-CLINICAL-REASONING-01.md`; migrations 422–424, 435, 436), Case Intelligence (5B) | Accepted, with bounded follow-ups. Closed. **Clinical cases are Apply's first major experience.** Apply is broader than clinical reasoning. |
| 7 | **Evaluate** | Learning evidence, evaluation and knowledge gaps | COMPETEN-SCHOLAR-EVALUATION-01 (`docs/COMPETEN-SCHOLAR-EVALUATION-01.md`; migration 426, staging) | **In development**, under the owner GO for dev/staging. |
| 8 | **Progress** | Longitudinal learning development and recommendations | none yet | **Not started.** Its product definition and owner approval come first. Implementation must not begin before then. |

## Earlier numbering (for reading existing records)

Earlier owner GOs and build records numbered the stages differently. **Those records stay as written.** This table translates:

| Earlier label | Workstream | Stage in this model |
|---|---|---|
| Stage 1 Join | JOIN-01 | 1 Join |
| Stage 2 Upload (including classification) | UPLOAD-01, SCHOLAR-01 | 2 Upload + 3 Classify |
| Stage 3 Learn | LEARN-01 | 4 Learn |
| Stage 4 Revision | REVISION-01 | 5 Revise |
| Stage 5 Clinical Reasoning (5A) and Case Intelligence (5B) | CLINICAL-REASONING-01 | 6 Apply |
| Stage 6 Evaluation | EVALUATION-01 | 7 Evaluate |
| Stage 7 Progress | none | 8 Progress |

## Stage 3, Classify: what holds

- **Continuous and in the background.** Concepts and proposed competency mappings are produced as material is processed (388). A student never has to choose a competency before uploading, and learning works with no catalogue.
- **Corrections are recorded, not overwritten.** Accepting or rejecting a mapping is a new append-only row in `individual_scholar_competency_decision` (388), and the current state is the latest decision.
- **CFCA structure:** Clinical Domain → Competency Practice Unit → Individual Competency → Learning Outcome, referenced and never copied.
- **The optional "My Knowledge & Competencies" view** is part of this stage's definition. It is not built, and this clarification does not authorise building it.

## Shared principles (unchanged)

- Shared Holdings engines.
- Configurable no-code capabilities.
- Minimal necessary verification.
- Direct implementation once requirements are agreed.
- Formative learning is never presented as verified clinical competence.

## Architectural notes raised by this clarification (for the owner; no work started)

1. **Reclassification and history.**
   - "Support future reclassification without overwriting historical mappings" holds for *decisions* (append-only).
   - It holds only partly for the *analysis itself*. `individual_scholar_chunk_analysis` is **one row per chunk**, so re-analysing a section would replace its concept record.
   - A competency **removed from the catalogue cascades and removes its mappings** (388).
   - Keeping full history through reclassification and catalogue change would need a versioned analysis and mapping record. That is a future design decision, not a defect, and nothing has been changed.
2. **Evaluate and Progress boundary.** EVALUATION-01 writes the record (426) that Stage 8 Progress will read. No Progress implementation has begun.
