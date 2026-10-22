# COMPETEN-IND-004 — Scholar Learning MVP: build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-004/scholar-mvp`, cut from `ind-003/individual-foundation` at `d6252ad6`. **Not merged, not deployed.** |
| **Authority** | Owner GO for COMPETEN-IND-004. Builds on ADR-016 (owner rulings D1–D10), COMPETEN-IND-002 §3.2–3.3 and COMPETEN-IND-003. |
| **Migration** | `372-individual-scholar-learning.sql`. House rules ALL CLEAR. **Not committed and not applied anywhere** until the owner applies it (CLAUDE.md, Database). Never production without a separate GO. |
| **Staging** | See §6. |

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

**New dependency:** `unpdf@1.8.1`, pinned exactly. It is the unjs serverless build of Mozilla pdf.js, with no runtime dependencies. `npm audit` counts are identical with and without it (28: 6 moderate, 21 high, 1 critical, all already present). `scripts/audit-gate.ts` fails on the base too: 52 unallowlisted advisories in vite, undici and others, none of them `unpdf`.

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
| `tsc --noEmit` and `eslint` on the 32 changed files | clean |
| `vitest run` | **571 / 571** after merging the foundation at `68028b5b`, including 37 new Scholar cases. A real two-page PDF is extracted page by page. The grounding refusals are proven. Progress shows not-measured as null. |
| `scholar-learning-harness` (new, in the CI list) | **49 / 49**, with 10 planted-failure controls (P1–P10) built in. A real on-disk plant also went red: removing one `user_id` filter in `store.ts` failed A1. Restored, it is green again. Without 372 in the checkout: 40/40, with schema checks printed as NOT RUN. |
| `individual-foundation-harness` | **41 / 41** at `68028b5b`. That includes 7d and 7e (pages gated through `experienceModulePage`), 11a (`force-dynamic`), and the per-experience write rule, under which Scholar files write only `individual_scholar_*`. |
| `access-doors` / `plane-boundary` | 39 / 39 · 35 / 35 |
| `auth-boundary` | **ALL GREEN** after the merge, which brought in the CI baseline fix from `main` `6fa4cd52`. Every Scholar route is recognised. |
| `audit-gate` | Fails on base and branch alike. `unpdf` adds no advisory (see §2). |

## 6. Staging

Pending owner authorisation to apply 372 to staging. Staging already has 370 and is missing 361–369, none of which 372 needs. Once authorised:

1. `apply-migrations.ts --only 372`, twice, with an identical schema snapshot after the second run.
2. Create a pilot-granted test identity (membership, Scholar entitlement with adult confirmation, staging-only test legal versions), then walk the journey on `localhost:3030` against staging. Steps: upload PDF and DOCX; refusals (patient data, scanned PDF, wrong type); consent on, then off, then on; explain; generate and answer MCQs; miss one, then review the card; case question; progress; erase one; erase all. Capture desktop and mobile screenshots.
3. Cross-user check: a second identity cannot read, answer, review, download or delete the first one's rows or objects (expect 404).
4. Remove the test identities and their objects.

## 7. Owner decisions and blockers

1. **Apply 372 to staging** (§6). After that, production is a separate GO, and it is also blocked by the production schema freeze (COMPETEN-OPS-001).
2. **Consent notice wording** (`CONSENT_NOTICE` in `config.ts`, version `scholar-ai-uploads-notice-v1`). This is a product notice, not legal text. It should be reviewed alongside the COMPETEN-LEGAL-001 documents before pilot use.
3. **Clinical-review record** for shared content: who reviews, when and with what scope. This is a governance design. Until it exists, Apply serves only the person's own material.
4. **OCR for scanned PDFs**: not built. A scanned PDF is refused with that reason.
5. **Release gate.** Individual ships dark: `individual_app` is OFF by default, and while it is off every Scholar page and API answers 404. The staging acceptance switches it ON for the run and then restores its prior state, as `individual-acceptance-harness` R1-R3 and Z2 do. The flag is never touched on production.

## 8. Next

- Staging acceptance (§6). Then an HQ console page for pilot grants, so Scholar pilots can be provisioned without the API.
- Post-MVP: OCR, audio (TTS), persisted OSCE prep on `osce_stations`, adaptive question selection over `individual_scholar_attempt`, and a clinical-review record for shared cases.
