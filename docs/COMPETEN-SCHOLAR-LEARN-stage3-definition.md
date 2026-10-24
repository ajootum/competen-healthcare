# COMPETEN-SCHOLAR Stage 3: Learn, product definition and implementation plan

**For owner approval. Nothing here is implemented.** This document defines Stage 3 and plans it. Implementation starts only on a separate owner GO.

**Owner's line for Stage 3:** "Learn: the Personal Learning Workspace (explain, summarise, simplify, go deeper, tutor; background beyond the notes labelled; personal AI context; material workspace)."

**Owner GO 2026-10-24 (Stage 2 acceptance):**
- Stage 3 must consume the Stage 2 outputs, not build a duplicate processing or retrieval pipeline.
- Configuration-first and no-code.
- Individual and Scholar are not activated in production.

**Basis:**
- `main` at 7049297, with UPLOAD-01 merged.
- The parked branch `scholar/stage3-learn` (f2329369) is cited below as **candidate implementation only**. It is neither merged nor cherry-picked. It was cut before UPLOAD-01, so it conflicts with today's explain route, upload panel, config and policy, and would be re-applied piece by piece on current `main`.

## 1. What Stage 3 is, and is not

**It is** the place a student *learns from their own notes*: a workspace for each material, and for the library as a whole. In it, Scholar:
- explains, summarises, simplifies, goes deeper and tutors, always from the student's own uploaded notes and cited to them;
- shows general background beyond the notes only apart, labelled, and only where policy allows;
- uses the student's own learning context: programme, level, the competencies their notes support, and what they have practised.

**It is not:**
- an assessment: practice questions, cases and revision are the existing Assess and Revise stages;
- a place where content is approved, or a source of clinical guidance;
- a second store, extractor, index or retrieval engine;
- a memory of the student's conversations. Nothing a student asks, and no answer, is stored (owner ruling D10, kept).

## 2. The student experience, step by step

1. **Arrive.** Every upload ends on "Your notes are ready" (UPLOAD-01 U5). **Start learning** opens the material's workspace. The student can also open any material from My Learning, or a competency from Progress (step 7).
2. **See what Scholar can teach from.** The workspace opens with:
   - the material's sections, each with its citation (page, slide or section);
   - its topics, the student's own corrections where they made them;
   - the competencies and learning outcomes the sections support, labelled with their clinical-content status.

   A partly read file says, at the top of the workspace, which pages or slides could not be read and so **cannot be taught from**.
3. **Learn the whole material.** Two actions at the top:
   - **Summarise this material** reads its sections in order and says how much it covered ("from 12 of 30 sections"), never implying it read everything when it did not.
   - **Tutor me on this material** starts a step-by-step tutor on the whole material.
4. **Learn one section.** On every section: **Explain**, **Summarise**, **Simplify**, **Go deeper** and **Tutor me**. Each answer cites the section it came from.
5. **Background beyond the notes.** Go deeper and Tutor may add general background. It always appears **apart from the answer**, in its own box labelled "Beyond your notes: general background from the AI. It is not from your notes and has not been verified." If it breaks the background rules (numbers, doses, drug names, citation tags, advice about a patient), it is withheld with the reason. Where policy turns background off, it never appears and nothing is said about it.
6. **Ask across notes.** From My Learning, a question can be asked of all notes, chosen materials, or the notes linked to a competency (UPLOAD-01 U4), with the same five ways of learning. Each source is named.
7. **Learn a competency.** From Progress, **Learn this competency** opens a workspace view of every section, across all materials, linked to that competency. Accepted links come first, then suggestions; rejected links never appear. The outcome each section supports is shown, and the tutor can teach toward those outcomes.
8. **Personal context, never stored.** The tutor knows the student's programme and level, the competencies their notes support, and where their practice is weak. This context is assembled at the moment of asking from their own rows, never stored, never used as grounding, and never names the person (already true on `main`: P1).
9. **Move on.** From any answer the student can:
   - open the cited section;
   - practise questions from that section (Assess, existing);
   - open related sections in their other notes (shared topics, with the reason shown).

## 3. What done looks like (acceptance, testable)

1. Every way of learning (explain, summarise, simplify, go deeper, tutor) answers **only from the student's notes, cited**, or is withheld with a reason. It is never shown ungrounded.
2. **Background beyond the notes** appears only in go deeper and tutor, only where policy allows, always apart and labelled, and is withheld when it breaks its rules.
3. **Whole-material** summarise and tutor read the material's sections in order and **state their coverage**.
4. A **partly read** material says which pages or slides cannot be taught from, in the workspace and on any whole-material answer.
5. **Learn this competency** retrieves only sections linked to it (not rejected ones) and shows their outcomes. A programme with no usable catalogue says so (R1), and learning still works.
6. The **tutor uses the personal context**. The audit records that it did, and holds no study text.
7. **Policy switches:**
   - a way of learning switched off is refused (403) and not offered;
   - background switched off never appears;
   - the HQ policy page changes both, with no code change.
8. **Isolation:** another student reaches nothing (404 or not-in-notes) through any Learn route.
9. **Nothing is stored:** no question, answer, summary or tutor turn reaches the study record.
10. **Every AI answer** carries the private-formative label (§6) and is never presented as clinically reviewed.
11. **Evidence:** a staging acceptance harness proves 1–10 over HTTP on the owner's three-resource scenario (anatomy PDF, pneumonia PowerPoint, oxygen therapy notes). Unit tests and static harness checks each have a planted red control. A real `next build` passes.

## 4. How Stage 3 consumes the Stage 2 outputs (no second pipeline)

| Stage 2 output | Where it lives on `main` | How Stage 3 uses it |
|---|---|---|
| **Extracted document sections** | `individual_scholar_chunk` (372): ordered, cited, with FTS `tsv` | Every passage is a chunk, read through the store (`listChunks`, `getPassage`, `searchCandidates`, `toPassages`). Whole-material actions read the chunks in order; per-section actions read one chunk. **No re-extraction, no new index.** |
| **Concepts and relationships** | `individual_scholar_chunk_analysis` (388); the student's `individual_scholar_topic_correction` (408); `libraryTopics` and `relatedMaterials` (UPLOAD-01) | The workspace shows a section's topics (the correction where made). "Related in your notes" uses `relatedMaterials` (a shared topic, with the reason). The tutor may name the topics a section covers. No new concept extraction. |
| **Source references** | Chunk page or slide or section; `passageCitation` with the material's unit (UPLOAD-01); material title on every source | Every answer's `[S n]` resolves to "material, page/slide/section", linking to the section. Unchanged citation code. |
| **Competency and learning-outcome mappings** | `individual_scholar_competency_map` with `outcome` and `catalogue_version` (408), and its append-only decisions (388); `competencyChunks` (UPLOAD-01) | "Learn this competency" uses `competencyChunks` (accepted first, never rejected). The workspace shows each section's competencies and outcomes. The tutor may teach toward the outcomes of the sections it is given. **No new mapping call in Learn.** |
| **Processing-quality information** | `individual_scholar_material.extraction_quality` (406); `qualitySummary` | The workspace's partial-read notice. Whole-material answers state coverage, and that unreadable pages were not taught from. |
| **Educational context** | `individual_scholar_learner_context` history (402); `contextAt` / `contextStamp`; `loadTutorContext` (P1) | The tutor's personal context (programme, level, competencies, weak practice), assembled per request. Each material shows the context it was uploaded in. |

**Retrieval stays the one on `main`:** Postgres FTS through `searchCandidates`, plus the UPLOAD-01 scopes (chosen materials, competency, spread across materials). Stage 3 adds a **whole-material scope**, which reads that material's chunks in order (a read, not a search), and nothing else.

## 5. No-code policies (Individual policy page, WCE)

Already on `main` and reused:
- formats, size and session limits;
- materials per person;
- AI hourly limit;
- the Scholar catalogue allowlist and content-status floor (`scholar_catalogue_min_status`; "approved" now means clinically approved, per IND-007).

New in Stage 3 (all fail-closed to today's behaviour):

| Key | Kind | Default | Limits | Effect |
|---|---|---|---|---|
| `scholar_learning_modes` | set | all five | explain, summary, simplify, deeper, tutor | A mode switched off is not offered and the route refuses it (403). |
| `scholar_beyond_notes` | choice | `labelled` (today) | `labelled` / `off` | `off`: go deeper and tutor run notes-only; background is never asked for or shown. |
| `scholar_material_scope_sections` | int | 12 | 4–30 | How many sections one whole-material answer reads, in order; the answer states its coverage. |
| `scholar_tutor_turns` | int | 6 (today's `TUTOR_MAX_TURNS`) | 2–10 | How many earlier tutor turns the browser may send back. |

## 6. Clinical safety and AI-content rules

Per the owner's ruling (2026-10-24) and IND-007's `content-governance.ts` (holdings/clinical-approval):

- **Everything Learn produces is `private_formative`:** AI-generated for one student's own study.
  - **No manual clinical approval and no approval queue.**
  - **Always labelled** "AI-generated from your notes, not clinically reviewed". Where IND-007's label lands on `main`, it is used verbatim.
  - `presentableAsApproved` and `usableForDecision` are false for all of it. It is never shown as approved, never counted as evidence of competence, and never put on the Passport as an assessment.
- **Grounding:** every answer passes the Holdings verifier against its passages (numbers, clinical descriptors, counts) or is withheld with the reason. A student can ask again; nothing is relaxed to make an answer appear.
- **Background beyond the notes** is general principles only: no numbers, units, doses, drug names, thresholds or citation tags, and no advice about any patient. It is shown apart and labelled, or withheld. Policy can switch it off (§5).
- **Shared clinical content** appears in Learn only as competency titles and outcomes from the catalogue. It is shown as approved **only** when 395 clinical review approved that exact version (`contentStatus` / `clinicalState`); otherwise it is labelled "Not clinically reviewed", "Draft", or as review states it.
- **Formal assessment is out of scope.** Learn decides nothing about a student.
- **Patient identifiers:** a question containing one is refused before any AI call (the existing screen). The tutor context never names the student.
- **Gates (unchanged):**
  - AI consent, which needs the published legal documents;
  - the AI hourly quota;
  - `individual_app`.

## 7. Gaps against `main` (what Stage 3 must add)

| # | Gap | Candidate on `scholar/stage3-learn` (f2329369) |
|---|---|---|
| G1 | Ways of learning and background are hard-coded: no `scholar_learning_modes` / `scholar_beyond_notes`, no 403 for a mode switched off | **Yes:** both policies, the route gate and the client filter. Re-apply on current `policy.ts`, `config.ts`, the explain route and `client.tsx`. |
| G2 | No whole-material scope: today an answer is a search or one section | **Yes:** `scope: "material"` with coverage; "Summarise this material" and "Tutor me on this material". Make the section count policy (`scholar_material_scope_sections`). |
| G3 | Prompt rules that cut withheld answers (counting) | **Yes:** explain v3 / modes v6. Carry them with their unit tests. |
| G4 | The workspace does not state a partial read at the point of learning, and whole-material answers do not exclude unread pages | **No.** New, reading `extraction_quality`. |
| G5 | No "Learn this competency" entry from Progress (the route supports `competencyId` since UPLOAD-01; the UI is only the library ask box) | **No.** New page view over `competencyChunks`, with outcomes. |
| G6 | The tutor context does not include the outcomes of the given sections, nor the topics | **No.** Small extension of `loadTutorContext`, still assembled per request and unstored. |
| G7 | No Learn acceptance harness on `main` | **Yes:** `scholar-learn-harness.ts`. Extend it to the three-resource scenario and §3. |
| G8 | "Related in your notes" from a section | **No.** Uses `relatedMaterials` (UPLOAD-01). |

## 8. Implementation plan

| Milestone | Delivers | Gaps |
|---|---|---|
| **M1: Governed ways of learning** | The four policies; the mode gate (403); background off/labelled; client offers only what policy allows; prompts v3/v6 | G1, G3 |
| **M2: The material workspace** | Whole-material summarise and tutor with stated coverage; the partial-read notice; related sections | G2, G4, G8 |
| **M3: Learning by competency and context** | "Learn this competency" from Progress; outcomes in the workspace and the tutor context | G5, G6 |
| **M4: Acceptance** | The Learn harness on the three-resource scenario covering §3 1–10; unit tests with red controls; static checks; `next build`; a staging run on a 3032-style staging server; the build record | G7 |

- **Migrations:** **none expected.** Policies are WCE rows; everything else reads tables that exist (372, 388, 402, 406, 408). If a milestone turns out to need one, I'll ask the coordinator for a number before writing it.
- **Shared staging config** (turning a policy away from its default to test it) goes to the owner as an `npx.cmd` PowerShell command, as before.
- **Parked branch:** each candidate piece is re-applied on current `main`, reviewed against the gaps above, with its tests. Nothing is merged or cherry-picked wholesale.

## 9. Decisions for the owner

1. **Background beyond the notes:** keep it on (labelled) by default, as `main` does today, or default it off?
2. **Nothing stored:** confirm Learn keeps D10. No answer, summary or tutor turn is saved; "save to revision" goes through the existing practice questions, not a new store.
3. **Whole-material coverage:** confirm 12 sections per answer as the default, with coverage always stated.
4. **Parked branch:** confirm re-applying its pieces on current `main` as described (my recommendation), rather than reviving the branch.

## 10. Out of scope for Stage 3

- New formats: OCR, audio.
- Saved notes or summaries.
- Formal assessment.
- Reviewer workflows.
- Shared or peer content.
- Production activation of anything.
