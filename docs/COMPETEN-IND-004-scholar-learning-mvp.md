# COMPETEN-IND-004 — Scholar Learning MVP: build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-004/scholar-mvp`, cut from `ind-003/individual-foundation` at `d6252ad6`. **Not merged, not deployed.** |
| **Authority** | Owner GO for COMPETEN-IND-004. Builds on ADR-016 (owner rulings D1–D10), COMPETEN-IND-002 §3.2–3.3 and COMPETEN-IND-003. |
| **Migration** | `372-individual-scholar-learning.sql`. House rules ALL CLEAR. **Applied and verified on STAGING only (2026-10-23)**, under the owner's continuation GO. Committed to this branch (`08ea2a31`), as the CLAUDE.md migration-governance amendment now allows for a staging-verified migration (`main` `5a9a07cc`). Nothing merges to `main` without a GO. **Production: not applied, and a separate GO is required.** |
| **Owner acceptance** | **APPROVED** as the MVP design baseline (2026-10-23). Final verification, consent v2, residual risks and release action are in §10. |
| **Owner review** | Conditional acceptance (2026-10-23); P0.1–P0.5 done, P1.6–P1.8 done, P1.9–P1.10 recommended. See §9. |
| **Staging** | 372 applied twice, idempotent. `scholar-acceptance-harness` 40/40. End-to-end walk-through at 1440 and 390 px. Three defects found and fixed. See §6. |

## 1. The journey, end to end

Every step lives inside the existing Scholar shell at `/individual/scholar/study/**`, in the `(scholar)` route group. My Learning is one registry module, so the sidebar and the mobile bottom bar each gain one entry.

| Stage | What the person does | Where |
|---|---|---|
| **Upload** | Uploads a PDF or DOCX of up to 10 MB, after a patient-data warning and a required attestation. The file goes to a private bucket under their own folder. The text is extracted into page-referenced chunks. | `UploadPanel`, `POST /api/individual/scholar/uploads` (signed slot), `POST …/materials` (process), `extract.ts`, `store.ts` |
| **Understand** | Asks about their notes, across all materials or one, or clicks *Explain this section*. The answer cites `[S1]`…, each resolved to material and page (or section, for DOCX). It carries the label *AI-generated from your notes, not clinically reviewed*. | `ExplainPanel`, `ChunkActions`, `POST …/explain`, `retrieval.ts`, `generation.ts` |
| **Assess** | Generates practice MCQs from one section and answers them. Feedback gives the correct option, the rationale and the source sentence quoted from their notes, with its page. | `QuestionCard`, `POST …/questions`, `POST …/attempts` |
| **Revise** | Every missed question becomes an SM-2 card, due the same day. The person reveals the answer and its source, then grades their own recall from 0 to 5. | `/study/revise`, `CardReview`, `POST …/cards/[id]` |
| **Apply** | Generates case-style questions from a section and answers them, with cited feedback. Shared clinical cases are **not served**: the page shows a governed state saying why. | `/study/apply` |
| **Improve** | Sees per-material mastery (the share right on the latest try), cards due and mastered, and an 8-week trend. The page is labelled *self-directed study* and says nothing on it is verified. Not-measured shows as *Not measured yet*, never 0%. | `/study/progress`, `progress.ts` |
| **Erase** | Deletes one material, or everything (typing ERASE). Objects go first, then rows, which cascade to chunks, questions, attempts and cards. | `DeleteMaterial`, `EraseAll`, `DELETE …/materials/[id]`, `POST …/erase` |

## 2. Reused, not rebuilt

| Reused | How |
|---|---|
| Experience registry and shell | The foundation owner's one experience-module mechanism (`dde82336`, merged): one `SCHOLAR.modules` entry (`study`, on the bottom bar). Every page takes its context from `experienceModulePage(param, "study")`: the release gate, gate 3, live, D2 terms and the registry check, so `/individual/professional/study` is 404. Every page and route is `force-dynamic` (foundation 11a). Apart from the registry entry, Scholar changes one shared file: a one-line fix to `foundation.test.ts`, whose navigation test assumed Scholar ships no module. |
| `requireIndividualContext("scholar")` | Every Scholar API handler. |
| `generate()` | Every AI call, with `attribution: { scope: "person" }` (AI-LOG-001), so `plat_ai_requests` logs usage and cost. |
| `checkAiQuota` | Scholar AI calls are audited as `ai_assistant_query`, the action the hourly limit counts. `entity_type` names the operation. |
| `verifyGrounded` (`src/lib/practice/document-phrasing.ts`) | The grounding check on every explanation and question. One stated adjustment: the modal verb "may" is not treated as the month May. |
| SM-2 (`src/lib/delivery/reinforcement.ts`) | `sm2()` is imported, not copied, and so is its mastery rule. The card store is Scholar's own (D1). |
| DOCX reader (`src/lib/import/docx-text.ts`, mammoth) | Unchanged. |
| Per-feature consent (migration 215 pattern) | `individual_scholar_consent`, per person, revocable, with the notice version shown. |
| Private bucket pattern (migration 336) | `individual-scholar-materials`, private, no storage policy, signed URLs. |
| Shell components | `PageHeader`, `StatePanel`, `Unreadable`, the focus ring and the 44 px touch floor. |

**New dependency:** `unpdf@1.8.1`, pinned exactly. It is the unjs serverless build of Mozilla pdf.js, with no runtime dependencies. `npm audit` counts are identical with and without it (28: 6 moderate, 21 high, 1 critical, all already present). `scripts/audit-gate.ts` failed on the old base (52 unallowlisted advisories in vite, undici and others, none of them `unpdf`). It passes since `main`'s CI baseline (#4).

## 3. Governance in the code and schema

| Rule | Enforced by |
|---|---|
| D1: no Individual rows in estate learning tables | 372 creates only `individual_scholar_*`. Scholar harness B1 and foundation harness 3a. |
| D6: own-row RLS and app guards | 372: RLS on all six tables, own-row `select` only, no write policies (harness F1, F2). Every store statement is keyed on the caller's `user_id` (A1). Composite `(id, user_id)` foreign keys make a row that points at another person's material unstorable (F3). |
| D10: no AI memory | Explanations are not stored (D3). The audit row records chunk ids and counts, never the question text. |
| Consent to AI processing | `aiPreflight` checks consent first; unreadable consent is a refusal (C3, C4). Revoking stops AI at once and deletes nothing. |
| Patient-identifiable data | A warning and a required attestation, re-checked on the server; `pii_attested_at NOT NULL` (F4). A pattern check runs before anything is stored: NHS number modulus-11, labelled date of birth, hospital or patient number (E5). A hit refuses the upload and deletes the object. The check is not exhaustive, and the page says so. |
| Provenance | Each question stores its chunk, the verbatim source sentence (checked to be in the chunk), the model and the prompt version (D4). Prompt versions are in `config.ts`. |
| Grounding | Explanations are withheld and questions dropped on any ungrounded number, month or finding-word, a missing or invalid citation, or a quote not in the passage. Nothing is retried. |
| Shared clinical content | Nothing reads `clinical_cases` (B2), because it has no clinical-review record. Apply shows the governed state instead. |
| Answer key | `questionView` sends no correct index, rationale or source to the browser before an answer is given (E3). |
| Erasure | One material or all of it, objects included, including unprocessed uploads (G1–G3). |

**Upload path, and why.** A Vercel function accepts a request body of about 4.5 MB, and the proxy buffers 10 MB, so a 10 MB file cannot pass through a route handler. The server issues a one-time signed upload URL for a path it chooses (`<user_id>/<upload id>.<ext>`). The browser uploads to that path, and the bucket enforces type and size. Processing rebuilds the same path from the caller's id and never takes a path from the request (A2). It then checks the magic bytes, extracts, runs the patient-data check, chunks and stores. Any refusal deletes the object. **Finding for the owner:** the existing `/api/evidence` route advertises 10 MB and 50 MB uploads through a route handler, which the same limit would cut off on Vercel. It is not touched here.

## 4. Migration 372

| Object | Purpose |
|---|---|
| `individual_scholar_consent` | AI-processing consent, unique per (user, feature); the status and revocation time must agree. |
| `individual_scholar_material` | The uploaded file's record. Size ≤ 10 MB, PDF or DOCX, a PDF has pages and a DOCX has none, never empty, the path sits under the owner's folder, attestation NOT NULL. |
| `individual_scholar_chunk` | Ordered text with page range (null for DOCX) and a generated `tsvector` with a GIN index. |
| `individual_scholar_question` | MCQ or case, 4 options, correct index 0–3, quote, model, provider, prompt version. |
| `individual_scholar_attempt` | Chosen option and correctness. |
| `individual_scholar_card` | SM-2 state, one per question. |
| bucket `individual-scholar-materials` | Private, 10 MB, PDF and DOCX only. |

It has no function or plpgsql, so no APPLY-WHOLE banner is needed. It references only `profiles` and `storage.buckets`, so it is independent of 370 and of 373. It alters no existing object, and re-running it is a no-op. sha256 `17a43464bc36eea620e3187536bbec3f8a1ef71a499a0d843880e0bf5854351d`.

## 5. Verification (local)

| Check | Result |
|---|---|
| `tsc --noEmit` and `eslint` on changed files | clean (0 errors) |
| `vitest run` | **575 / 575** at foundation `79690f12`, including 33 Scholar cases. A real PDF is extracted page by page, and the caller's bytes stay intact (§6, defect 1). The grounding refusals are proven. Progress shows not-measured as null. |
| `scholar-learning-harness` (new, in the CI list) | **50 / 50** (E6 added after staging defect 3), with 10 planted-failure controls (P1–P10) built in. A real on-disk plant also went red: removing one `user_id` filter in `store.ts` failed A1. Restored, it is green again. Without 372 in the checkout: 40/40, with schema checks printed as NOT RUN. |
| `individual-foundation-harness` | **43 / 43** at `79690f12`. That includes 7d, 7e and 7f (pages gated through `experienceModulePage`, each module with its page), 11a (`force-dynamic`), 11c and 11d (no client before the guard), and the per-experience write rule, under which Scholar files write only `individual_scholar_*`. |
| `access-doors` / `plane-boundary` | 39 / 39 · 35 / 35 |
| `auth-boundary` | **ALL GREEN** after the merge, which brought in the CI baseline fix from `main` `6fa4cd52`. Every Scholar route is recognised. |
| `audit-gate` | **Passes** after merging `main` (3 tolerated by recorded deviation, 0 unexplained high or critical). `unpdf` adds no advisory (see §2). It failed only before `main`'s CI baseline (#4). |
| `build:verify` with `SUPABASE_SERVICE_ROLE_KEY` empty | Exit 0, 526/526 pages. All 14 Scholar routes and pages are ƒ (dynamic). Only the public `/individual` and `/individual/sign-in` are ○. |

## 6. Staging (2026-10-23, owner continuation GO)

**Migration 372 on `ezhvpgtcqcdsgylrxgdb`.**
- **Before.** 372 depends only on `profiles` and `storage.buckets`. 370 and 371 were present (371's `attribution_scope` column included). 373 was not yet applied, and there is no collision: the prefixes differ (`individual_professional_*`), the buckets differ, both bucket inserts are `ON CONFLICT DO NOTHING`, and neither file references the other. Timing was agreed with IND-007, who applied 373 afterwards.
- **Snapshot.** A read-only schema and row snapshot (staging-guarded) was taken before, after run 1 and after run 2. It excludes `individual_professional_*`.

| | Result |
|---|---|
| Run 1 | Six tables and the private bucket (10 MB, PDF and DOCX). RLS is on every table, with an own-row SELECT policy only. |
| Run 2 | The Scholar schema hash is identical to run 1 (`b7ba7113…`), so 372 is **idempotent**. |
| Everything else | The hash of the rest of `public` is identical before and after (`91ce3da5…`), and the other buckets are unchanged. Existing row counts are preserved. 372 inserts no rows. |

**`scholar-acceptance-harness`, 40/40, against the real database.** It is staging-only (`assertSafeTarget`), registered in `privileged-harnesses` STAGING, and UNTRIAGED is 0. It covers:
- **C, consent:** grant, revoke and re-grant, plus the schema refusal.
- **U, upload:** a real PDF and DOCX through the anon-key signed upload, page-referenced chunks, and an NHS-number file refused with its object deleted.
- **R, retrieval:** FTS, with nothing visible across users and hostile input sanitised.
- **Q, Assess and Revise:** provenance; one card per miss, reset on a second miss; SM-2 rescheduling; progress from the latest answer.
- **I, isolation:**
  - store calls by another person answer not-found;
  - RLS through real sessions, including no writes from the browser;
  - no direct storage reads;
  - a working signed URL for the owner;
  - composite keys, and the attestation, folder, size and DOCX-page checks.
- **A, AI:** real `generate()` calls, with `plat_ai_requests` rows carrying `attribution_scope='person'` and no tenant.
- **M, D1:** no estate rows.
- **E, erasure:** one material, then everything, including an unprocessed upload; the consent record is kept.
- **Z:** fixtures removed, flag restored.

A planted defect (`getMaterial` without its `user_id` filter) turned I1 red (39/1).

**Release gate.** `individual_app` had no row on staging. Each run recorded that, switched it ON, and restored it to no row. With the gate off, a signed-in, granted person who had accepted the terms got **404** on the page and on the API.

**End-to-end walk-through** on `localhost:3030` against staging, with staging-only test identities and test legal versions. Evidence is in `docs/evidence/COMPETEN-IND-004/`: 11 desktop screenshots at 1440 px and 3 mobile at 390 px.
- Before 372, the governed "not set up" state.
- Terms gate, then My Learning with consent off.
- An NHS-number PDF refused with the reason, and nothing kept.
- A 3-page PDF giving 3 page-cited sections.
- Consent on, with the date recorded.
- "What should be given in the Sepsis Six?" answered from the notes only, cited `[S1]` to *page 2*, with the AI label and the model and prompt shown.
- Practice questions: 2 kept, 1 dropped by the grounding check.
- A deliberate wrong answer: the correct option, rationale, verbatim source quote and *page 1*, and "Added to your review cards".
- Revise: the card revealed with its source and graded, then no longer due.
- Apply: 3 case questions answered with cited feedback, and the governed "Reviewed clinical cases: not available yet".
- Progress: 3 of 5 answered, 67% mastery on the latest try, and weeks without answers shown as "No answers".
- Mobile: no horizontal scroll, and a bottom bar of Home, Study, AI, Passport, Profile.
- Cross-user: as a second person, the first person's material page, download and delete were **404**, and their search found nothing (no AI call).
- Before accepting the terms, that second person's API call was 403.
- Erasure through the UI: rows and object gone, consent kept.
- `plat_ai_requests` held the three browser calls with `attribution_scope='person'` and no tenant. No audit row held question text.

**Defects found on staging and fixed within scope**

| # | Defect | Fix | Proof |
|---|---|---|---|
| 1 | **Every PDF upload was refused.** pdf.js transfers (detaches) the `ArrayBuffer` it is given, so the route then stored `byte_size` 0, and the size CHECK refused it. | `extract.ts` gives pdf.js a copy. `createMaterial` returns the database reason, and the route logs and audits it. | A unit test fails without the fix and passes with it. Acceptance U2–U4 and the walk-through pass. |
| 2 | **The grounding yield was near zero with the real model.** Explanations counted in words ("in two ways"), and distractors invented thresholds ("two times", "1.5 times", "normal range"). The check was right each time. | Prompts v2 say it explicitly: no number in digits or words that the passage lacks, and distractors built only from the passage's terms. The check is unchanged. | Against the real model: explanations 4/4 shown (was 0/2), questions 9 of 12 kept, and every remaining drop is a genuinely invented number. |
| 3 | **Revise returned a 500 when a card was due.** The server page called a function exported from the `"use client"` module. | `sourceHref` and `studyHref` moved to `question-view.ts`. | New harness check E6; the planted original turns it red. |

**Known limitation, recorded rather than fixed.** The grounding check pins numbers, months and clinical finding-words. A *distractor* that names a term the notes do not contain (for example "Arrange an urgent CT scan" as a wrong option) is not caught, because it is not asserted as true. Questions carry the not-clinically-reviewed label.

**Cleanup.** Test identities, their objects and rows were removed, and the flag was restored. Every Scholar table on staging is empty, and `profiles` is back at its pre-fixture count.

## 7. Owner decisions and blockers

1. **Production for 372** is a separate GO. It is also blocked by the production schema freeze (COMPETEN-OPS-001). 372 is committed on this branch only, pending the CLAUDE.md amendment for staging-verified migrations.
2. **Consent notice wording** (`CONSENT_NOTICE` in `config.ts`, version `scholar-ai-uploads-notice-v1`). This is a product notice, not legal text. It should be reviewed alongside the COMPETEN-LEGAL-001 documents before pilot use.
3. **Clinical-review record** for shared content: who reviews, when and with what scope. This is a governance design. Until it exists, Apply serves only the person's own material.
4. **OCR for scanned PDFs**: not built. A scanned PDF is refused with that reason.
5. **Release gate.** Individual ships dark: `individual_app` is OFF by default, and while it is off every Scholar page and API answers 404. The staging acceptance switches it ON for the run and then restores its prior state, as `individual-acceptance-harness` R1-R3 and Z2 do. The flag is never touched on production.

## 9. Owner review (2026-10-23): conditional acceptance, quality and usability pass

The owner accepted the Scholar journey as the MVP foundation, subject to one focused quality pass. No schema change was needed, and none was made: 372 is unchanged (sha256 `17a43464…`).

### P0 corrections

| # | Required | Done | Where |
|---|---|---|---|
| P0.1 | Validate stems, correct answers, distractors, terminology, ambiguity and source support. Reject or regenerate defective questions. | **Deterministic layer:** every option, right or wrong, is built from the passage's own terms. The keyed answer is in the quoted source sentence. No all/none-of-the-above. No option contains another. A real question, with no lower-case NOT/EXCEPT. Bounded lengths. **Blind check:** a second `generate()` sees the passage and the questions *without the key*. A question survives only if the passage supports exactly the keyed option, it is answerable from the passage alone, the stem adds no outside facts, and it is not ambiguous. An unreadable verdict rejects (fail closed). **Regenerate once** on the same provider, with the reasons, if nothing survives. The prompt states the same rules and lists the passage vocabulary that options may use. Prompts are now `mcq/case-v3` with `verify-v1`. | `question-quality.ts` (+ tests), `generation.ts`, questions route |
| P0.2 | Distinguish source-derived answers from verified guidance, with provenance and safety warnings. | A **source notice** sits under every explanation, every piece of answer feedback and every revision answer: "from your own notes, not verified clinical guidance … never use it for a real patient". Marking reads "That matches your notes" / "Your notes support B", plus "Marked against your notes, not against clinical guidelines." The model, prompt version, citation and AI label are kept. | `config.ts` (`SOURCE_NOTICE`, `MARKED_AGAINST_NOTES`), `client.tsx` |
| P0.3 | Replace "mastery". Imply no verified competence. | The figure is now **practice accuracy** (latest try), with "It is not a measure of competence or of clinical knowledge." SM-2's stored `mastered` state is shown as *cards on long intervals*. The internal fields are renamed `latestAccuracy` / `cardsLongInterval`, and the harness refuses "mastery" on any screen. | `progress.ts`, Progress page |
| P0.4 | Verify the consent, upload screening, deletion and AI processing boundaries. | Staging acceptance adds three checks. **C6:** the AI preflight refuses with 403 when consent is revoked, and passes when it is granted. **U7:** a labelled DOB and an MRN are refused. **U8:** a file whose bytes are not the declared type is refused and its object deleted. These sit alongside the existing deletion, erasure, isolation and no-passage-no-AI checks. The harness also checks (R4) that the prompts carry no profile data. | `scholar-acceptance-harness`, `scholar-learning-harness` |
| P0.5 | Keep personal AI cases apart from clinically reviewed ones. | Every personal case card is labelled "Practice scenario from your notes · not a clinically reviewed case". Apply separates "Your practice scenarios" from "Clinically reviewed cases", which stays the governed not-available state. Nothing reads `clinical_cases`. | `client.tsx`, Apply page |

**The recorded limitation is closed.** A distractor naming something the notes never mention ("Arrange an urgent CT scan") is now refused (`unsupported_term`, unit-tested).

**What remains, stated precisely:**
1. Distractors limited to the notes' own terms are safe but sometimes *obviously* wrong ("Take oxygen", "Fatigue, to relieve fluid overload"). That lowers discrimination, but nothing they say is false.
2. The blind check is a second reading by the same model family. It catches ambiguity and keying errors; it is not a clinical review.
3. A synonym of a passage term ("administer" for "give") is refused even when harmless. That is the conservative direction.
4. **Explanations** are checked for numbers, months and clinical finding-words. Explanatory paraphrase is not checked. The live explanation glossed prerenal causes as "problems with blood supply to the kidneys", a phrase the notes do not contain. The source notice and the AI label are there for exactly this, and the passage is one click away.

### Verification

| Check | Result |
|---|---|
| `tsc`, `eslint` on changed files | clean |
| `vitest` | **585 / 585**, including 10 new quality and verification cases. The fail-closed verdict and the CT-scan distractor are among them. |
| `scholar-learning-harness` | **58 / 58**. R1–R5 pin each P0. Planted controls P11 (quality layer off), P12 (blind check skipped) and P13 ("mastery" back on a screen) each go red. |
| `individual-foundation` / `auth-boundary` / `plane-boundary` / `access-doors` | 44/44 · green · 35/35 · 39/39 |
| Real model, v3 pipeline | First run: 11 blind-verified questions across 6 sets, at least 1 per set, 8–17 s. **Re-measured after the credit was restored: 11 kept, every set at least 1 on the first attempt, 8–10 s.** Drops were 4 `unsupported_term` and 2 `ungrounded`, with no blind-check rejections. |
| Staging acceptance, re-run (flag ON for the run, restored to no row and confirmed in the database, IND-007 told) | First run **40 / 43**: A1–A3 failed only because the AI provider was out of credit. **After the owner topped it up: 43 / 43, A1–A3 green.** The live explanation was shown. Questions kept 0 on the harness's short page-1 passage, which A2 allows: it checks that what is kept is sound, not that something is kept. |
| Walk-through, updated presentation | 9 desktop (1440) and 3 mobile (390) screenshots in `docs/evidence/COMPETEN-IND-004/owner-review/`: AI help off, the notice before agreeing, AI help on, the two-column material page, feedback against the notes with the source notice, labelled personal scenarios, a revision answer with the notice, the revision summary, practice accuracy, sticky study tabs on mobile, case feedback and progress on mobile. **These were first captured with seeded questions while the provider was down. All of them are now replaced with live output.** That covers r04–r09, r11 and r12, plus **r13, a live explanation** cited to page 1 with the source notice. No screenshot in the set shows seeded data. |

### P1, done within scope

- **P1.6:** on desktop, material sections sit left with a sticky "Ask about this material" panel right, and answer options sit in two columns. On mobile, the study tab bar stays pinned under the header.
- **P1.7:** the consent card shows one line with "Review and turn on", which opens the full notice. The agreement is still its own click with the notice in view, and "Turn off" is one click. Nothing about the consent record changed.
- **P1.8:**
  - Questions show the last result ("did not match your notes") and offer "Answer again".
  - Revise shows a progress bar and a recall prompt, explains what a grade does, says when each graded card comes back, and ends with a session summary.

### P1.9: reusable organisation (recommendation only)

| Existing | Scope | Reusable for Scholar? |
|---|---|---|
| `curricula` + `curriculum_modules` + `curriculum_competencies` (016) | hospital, or global when `hospital_id` is null | **Yes, read-only, as the programme/module catalogue.** Global curricula (null hospital) can describe e.g. a pre-registration nursing programme and its modules, linked to `framework_competencies`. |
| `taxonomies` + `taxonomy_terms` (013) | global | **Yes, read-only, as the topic vocabulary** (a `scholar_subject` taxonomy kind). |
| `tags` + `object_tags` (013) | hospital, enterprise | **No.** They are organisation data, and an Individual tag row would be visible to tenants (D1). |
| `learning_pathways` / `pathway_items` (014) | per person, estate | **No.** It sits among the estate learning tables (D1). |

**Minimum extension:** one owner-only link table, `individual_scholar_material_topic (material_id, user_id, curriculum_module_id or taxonomy_term_id)`, with the same composite-key and RLS shape as 372. The person tags their material against the shared catalogue, and Progress groups by module or topic. That is a new migration (374) and needs a staging GO, so it is **not done here**. Nothing configuration-only would deliver it.

### P1.10: progressive clinical reasoning (recommendation only)

- **Existing:**
  - `simulation-briefs.ts` (7 static briefs) and `cdp_sim_sessions` (147) are estate, hospital-scoped, so D1 rules them out as Scholar storage.
  - `osce_stations` (033) is an institutional exam model.
  - `clinical_cases` (026) has no review record.
- **Minimum extension: a staged case.** One source passage gives an ordered series of 3–4 steps. Each step reveals one more fact *from the passage* and asks one decision. Each step runs through the existing generation, quality layer and blind verification, so the safety model is unchanged.
- **Storage:** two nullable columns on `individual_scholar_question` (`case_group uuid`, `step int`, a CHECK that both are set or neither). The UI shows the next step only after the previous one is answered. This is a migration (374 or 375) and needs a staging GO.
- **Later:** a free-text "explain your reasoning" step marked against the source, reusing the existing `/api/ai/coach` advisory pattern, and shared reviewed cases once `clinical_cases` gains a review record.

### Blockers

1. ~~The AI provider account was out of credit.~~ **Resolved:** the owner topped it up, and A1–A3 are green.
2. Unchanged: production for 372 needs a separate GO (production freeze); the LEGAL-001 documents and the consent-notice wording need review; and `individual_app` is OFF in production.

### Recommended Scholar pilot-readiness decision

**Conditional GO for a closed pilot, on four owner-side conditions. No further code is required.**
1. ~~Restore AI provider credit, then A1–A3 green on staging.~~ **Met** (43/43).
2. Publish the Holdings and Scholar-operator terms and privacy versions (LEGAL-001) and approve the consent-notice wording.
3. Give the production GO for 370 and 372, after the recovery mechanism the production freeze requires.
4. Turn `individual_app` on, and pilot-grant the cohort through the HQ grant right (D8/D9).

Until then, Scholar stays dark in production behind the default-OFF gate.

## 10. Owner visual acceptance (APPROVED, 2026-10-23): final verification and release preparation

The owner approved the revised interface and journey as the MVP design baseline. This section records the final verification, the AI-consent change the owner approved the same day, the residual risks and the release action. No schema change; 372 is unchanged (sha256 `17a43464…`).

### Final verification

| # | Owner item | Evidence | Result |
|---|---|---|---|
| 1 | Question validation covers stems, correct answers, distractors, ambiguity, clinical terminology and source support | `question-quality.ts`:<br>• stem: a question, no unmarked negative;<br>• key: in the quoted source sentence;<br>• distractors and terminology: every option from the notes' terms, no catch-all or overlap.<br>The blind check covers ambiguity, exactly-one-supported, and no outside facts. Unit tests, harness R1 + P11/P12. **Live on staging (A1–A3):** green, with 3 acceptance runs today. The v3 pipeline re-measured at 11 kept across 6 sets, at least 1 each. | **Pass** |
| 2 | AI consent, withdrawal and material-deletion boundaries | Acceptance C1–C6: off by default; grant records the notice version (now **v2**, confirmed in the database); revoke records when; the preflight refuses with **403** after revoke. E1–E3: one material and everything, objects included, an unprocessed upload too; the consent record kept. I1–I8: isolation. Walk-through: the statement must be ticked before "Turn on AI help" enables, and "Turn off" is one click. | **Pass** |
| 3 | Source-grounded explanations, clear separation from clinically reviewed content | A1 live: shown only after the grounding check, cited `[S1]` to a page, with the AI label and the source notice (screenshot r13). The Apply page separates "Your practice scenarios" from "Clinically reviewed cases" (not served). Nothing reads `clinical_cases` (harness B2, R5). | **Pass**, with residual risk 4 |
| 4 | Practice accuracy, spaced revision, progress calculations | **Known fixtures (unit tests, all green):**<br>• Accuracy: the latest answer per question counts (wrong then right = right). Material with 2 answered, 1 right on the latest = **50%**.<br>• Not measured: no answers gives `null`, shown as "Not measured yet", never 0%. A week with no answers has no bar.<br>• Weekly trend: 3 answers in the week of 19 Oct, 1 right, gives **33%**. Weeks start on Monday, and the window is 8 weeks ending with the current one.<br>• SM-2 (the estate's `sm2()`, imported): Good every time gives **1 → 6 → 15 → 38 → 95 days**, reaching long intervals on review 5 (reps ≥ 5 and interval ≥ 60). Easy/Okay set the ease (2.6 / 2.36) for later intervals. A miss restarts at 1 day.<br>• Cards due: a card due today counts; a future card does not.<br>Staging Q2–Q7 confirm the same against the real database. | **Pass** |
| 5 | Desktop and mobile usability and navigation | 15 owner-review screenshots, all live (1440 and 390). No horizontal overflow at 390 (measured). Study tabs pinned on mobile, five-tab bottom bar, two-column material page with a sticky Ask panel on desktop. Revise keeps its session summary after the due-count refresh (defect found and fixed). | **Pass** |
| 6 | Personal educational activity kept distinct from verified competency | "Practice accuracy … not a measure of competence or of clinical knowledge". The self-directed label on Progress. Nothing is written to the Passport or any estate table (harness B1, acceptance M1). "Mastery" is refused on screen (R3). Answers are "marked against your notes, not against clinical guidelines". | **Pass** |

Local checks: `tsc` clean; `vitest` **587/587**; `scholar-learning-harness` **63/63** (S1–S4 consent and separation, planted P14 goes red); `individual-foundation` 44/44; `auth-boundary`, `plane-boundary`, `access-doors` green. Staging: `scholar-acceptance-harness` **43/43**. The flag was restored to no row each time and confirmed, with IND-007 told before and after.

### AI consent v2 (owner GO, 2026-10-23)

- **Wording:** the owner-approved wording, verbatim, as `CONSENT_NOTICE` v2 (`scholar-ai-uploads-notice-v2`, stored with each grant).
- **Agreement:** the agreement control is a checkbox labelled with the Consent sentence, followed by its own "Turn on AI help" click. It stays off by default, the notice is in view, and withdrawal is one click.
- **Legal links:** the Privacy Notice and Terms links come from the Individual legal configuration: version shown, URL only if configured, and nothing invented.
- **Separation:** contribution and training permissions are kept separate by not existing. No code path shares, submits or publishes a person's material, and no training permission is requested or implied: the only consent feature, in code and schema, is `ai_processing_uploads`. Harness S1–S4 pin this, and planted P14 goes red.

**Consistency check: where the approved wording and the implementation differ (report only, no code changed):**
1. *"With your separate, optional permission, eligible materials may be submitted for review…"* No such permission or mechanism exists; contribution is out of scope. The sentence describes a capability the person cannot use today. Legal and product should decide whether to keep it before the pilot, or say it is not yet available.
2. *"…or material you do not have permission to use."* The upload attestation covers patient information only, not copyright or permission to use. A one-line attestation change would align it; that needs a decision on whether the attestation timestamp should then cover both.
3. *"You can review the applicable Privacy Notice and Terms of Service…"* and *"…as described in the Privacy Notice."* Both depend on LEGAL-001. No Individual Privacy Notice or Terms is published; on staging the links show test versions with "no published link yet". The consent would refer to a document that does not exist until legal publishes it.
4. *"Terms of Service"* vs the configured and displayed name *"Terms of Use"* (legal.ts, the terms gate). The names should be aligned in one place.
5. *"processed by Competen and its authorised technology providers"* The provider is Anthropic, via `generate()`. Naming the processor and its terms, including that API inputs are not used for training, belongs in the Privacy Notice, which is a legal dependency.
6. *"receive personalised explanations and feedback"* Explanations are AI-generated. Answer **feedback** is the stored question's own rationale and source, with no AI call at marking time. The sentence is accurate for explanations and loosely so for feedback.
7. The v2 wording drops the v1 operational details: only the passages you ask about are sent; explanations are not saved; questions are saved with their source; turning AI off deletes nothing. They are still true. Legal should decide whether the Privacy Notice carries them.

### Residual risks (accepted for the MVP, recorded)

1. **Question quality limits.**
   - Distractors limited to the notes' terms are safe but sometimes obviously wrong, which lowers discrimination.
   - A harmless synonym is refused (conservative).
   - In explanations, explanatory paraphrase is not term-checked (live example: "problems with blood supply to the kidneys").
2. **The blind check is the same model family, not clinical review.** It catches keying errors and ambiguity. It does not validate clinical truth, and the notes themselves may be wrong. The AI label and source notice say so on every output.
3. **The consent-notice wording is pending legal review** (items 1–7 above), and the Privacy Notice and Terms it relies on are unpublished (LEGAL-001).
4. **Storage files are outside the planned database backups.** Uploaded originals live in the `individual-scholar-materials` Storage bucket. A database backup or PITR (COMPETEN-OPS-001) does not cover Storage objects, so a restore could bring back material rows whose original file is gone. The extracted text is in the database, so study still works. Download-original would 404, and erasure must stay object-first, as it is.
5. Unchanged from §9: production needs 370 + 372 under a separate GO and the freeze's recovery mechanism; `individual_app` stays OFF in production.

### Recommended release action

**Merge PR #9 to `main` when the owner gives the GO.** The code is dark behind the default-OFF `individual_app` gate, and 372 is staging-verified and eligible under the CLAUDE.md amendment. Merging records it in release history and activates nothing.

Then, as **separate owner GOs**, in order:
1. Legal: resolve consistency items 1–5 and publish the Individual Privacy Notice and Terms (LEGAL-001).
2. Production: apply 370 + 372 once the freeze's recovery mechanism exists. Decide whether Storage needs its own backup first (risk 4).
3. Pilot: turn `individual_app` on in production and pilot-grant the closed cohort through the HQ right (D8/D9).

No production migration, merge, deployment or pilot activation has been done.

### Addendum: AI consent v3 (owner GO, 2026-10-23)

The owner's GO on the consistency check above: correct the seven items, remove references to contribution functionality that does not exist, use the Terms of Use name, and keep AI help off until the applicable Privacy Notice and Terms are published and legally approved. Operator names stay configurable. No schema change; 372 is unchanged.

| # | Item | What changed |
|---|---|---|
| 1 | Optional-contribution sentence | **Removed entirely.** In its place is a plain statement that is true of the code today: *"Your private uploads are not shared with other learners, and Competen does not use them to train AI models."* |
| 2 | Attestation covers patient data only | The upload checkbox is now *"I confirm this file contains no identifiable patient information, and I have permission to upload and use it."* The refusal in both upload routes says the same. **One attestation and one timestamp** (`pii_attested_at`) cover both; no schema change. The warning above it also says to upload only material you have permission to use. |
| 3 | Privacy Notice and Terms unpublished | **Gate implemented** (`src/lib/individual/scholar/consent-gate.ts`). AI help cannot be turned on, or used, until every applicable document (the Scholar operator's and the shared foundation's Privacy Notice and Terms of Use) has a **version and a URL** in the Individual legal configuration. A version with no URL does not count, because nobody can open it. Until then the card says *"AI help will be available once our Privacy Notice and Terms of Use are published."* and shows the notice read-only. The consent route refuses a grant (409), and `aiPreflight` refuses every AI call (403) with that message. Turning AI help off is always allowed. The gate opens through configuration, not code. |
| 4 | Terms of Service vs Terms of Use | "Terms of Use" throughout Scholar. Harness S3 fails if "Terms of Service" appears in any Scholar file. (The marketing site's planned footer link `src/lib/marketing/home-content.ts` still says "Terms of Service". It is outside Individual and was left alone.) |
| 5 | Naming the AI provider and its training terms | **A legal dependency; recorded only, no code.** It belongs in the Privacy Notice (LEGAL-001). |
| 6 | "feedback" loosely accurate | Now *"…and receive personalised explanations, and feedback on practice questions drawn from your notes."* |
| 7 | Operational details dropped in v2 | A **"How it works"** list in the notice: only the passages you ask about are sent; explanations are not saved; questions are saved with their source passage; turning AI help off deletes nothing. |

**Version and re-agreement.** The notice is `scholar-ai-uploads-notice-v3`. A grant counts only for the current version: `consentStatus` returns `on` only for a v3 grant with the documents published. A v2 grant stays in `individual_scholar_consent` as the record of what was agreed then. The person sees *"We have updated how we describe AI help. Please review the notice and agree again to keep using it."*, and can review and agree, or turn it off. Every AI surface (the Ask panels and the per-section actions) reads the same status, and none treats the stored grant as "on" by itself (harness S6).

**Harness pins** (`scholar-learning-harness`, now 68 checks):
- **S3:** the v3 wording. No contribution, library or submission language, the no-sharing/no-training sentence, Terms of Use, the feedback scope, and the four How-it-works items rendered.
- **S5:** the legal gate, in the preflight and in the consent route before anything is saved. The pure function is checked with no documents, with one URL missing, and with all four published.
- **S6:** re-agreement. v2 → `outdated`, v3 → `on`, and no page or route reads the raw grant.
- **S7:** the attestation, on screen and in both refusals.
- Planted **P15** (the route stops checking the documents) and **P16** (a page reads the raw grant again) both go red.

The staging acceptance harness adds **C7** (a v2 grant is kept but refused, 403, asking again) and **C8** (documents unpublished: even a current grant is refused, 403, saying why). **C6** now runs with the documents set as published. The harness sets test legal versions and `example.test` URLs in its own process and restores the environment afterwards.

**Staging walk-through.** Staging publishes test versions with no URLs, so the gate is closed there, which is the honest state. To walk through the agreement, the consent worktree's local `.env.local` (not committed) sets the four `INDIVIDUAL_LEGAL_*_URL` values to `example.test` addresses.

**Screenshots** (`docs/evidence/COMPETEN-IND-004/consent-v3/`, live on staging):
- v1: AI help awaiting the published documents, beside the new upload attestation;
- v2: a v2 grant asked to agree again;
- v3a/v3b: the v3 notice, How it works, the legal links and the statement;
- v4: AI help on;
- v5: the material page while the documents are unpublished;
- m1: the notice on mobile at 390, with no horizontal overflow.

The superseded v2 consent screenshots (owner-review r01–r03, r14) are kept as the record of what v2 showed.

**Verification:**
- `tsc` clean and `eslint` 0 errors on changed files.
- `vitest` **595/595**, including 8 new consent-gate tests.
- `scholar-learning-harness` **68/68**: S3, S5, S6 and S7, with planted P15 and P16 red.
- `individual-foundation` **44/44**.
- **Staging** `scholar-acceptance-harness` **45/45**: C6, C7 and C8 green, fixtures removed, flag restored to its prior state.
- CI no-credential subset on an LF clone: **46/46 harnesses green** (`scripts/ci-harnesses.ts`, 5 excluded by record), on a `core.autocrlf=false` clone of this branch after `npm ci`.

## 8. Next

- Staging acceptance is done (§6). Next is owner review of this branch and of 372 for production, which needs a separate GO and is blocked by the production freeze. Then an HQ console page for pilot grants, so Scholar pilots can be provisioned without the API.
- Post-MVP: OCR, audio (TTS), persisted OSCE prep on `osce_stations`, adaptive question selection over `individual_scholar_attempt`, and a clinical-review record for shared cases.
