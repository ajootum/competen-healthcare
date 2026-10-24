# COMPETEN-SCHOLAR-UPLOAD: Stage 2 Upload (build record and readiness)

Owner GO 2026-10-24: "Stage 1 Join accepted. Proceed to Stage 2 — Upload."

**Status:**
- Development authorised. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF), and AI help behind consent and the published-legal-documents gate.

**Migrations:**
- Number **405** is this build's.
- Numbers 406 and 407 were allocated and are released unused.

## 1. Readiness assessment (read from code, not memory)

| Area | Existing (before this build) | Missing | Action |
|---|---|---|---|
| **Entry** | Welcome's primary action "Upload my notes" (#51) goes to `/individual/scholar/study#upload`, and the panel carries `id="upload"`. | — | None. Proven over HTTP (W1). |
| **Formats** | PDF (unpdf, page-cited) and DOCX (mammoth, section-cited); magic-byte sniffing; scanned PDFs refused with a stated OCR message. | Plain text, pasted text, images and photos. | **Text and pasted text added** (UTF-8 only, binary refused, kept as a `.txt` original; migration 405). **Images and photos need OCR, an owner decision on a provider**, so they're refused with the reason stated on the panel. |
| **Limits** | 10 MB (constant, and the DB and bucket cap); 300 PDF pages (constant); 600,000 characters; materials per person as policy (`scholar_materials_per_person`). | Size, pages and formats not configurable. | **Three new Individual policies** (below). Each can only tighten what the database enforces. |
| **Privacy and consent** | AI consent (versioned notice, legal-documents gate) is separate from upload, so uploading needs no AI consent and no AI runs at upload; rights and patient-information attestation required, and re-checked on the server. | — | None. Uploads with AI off; AI only after consent (M1 proves the consent gate opens it). |
| **Identifier screen** | Holdings `findPatientIdentifiers` (moved to `src/lib/privacy`) runs on the server before anything is kept; a refusal deletes the uploaded object. | — | None. Proven over HTTP (U2). |
| **Storage and deletion** | Private bucket, server-chosen path under the owner's folder, own-row RLS, composite FKs, signed 5-minute download link, delete-one and erase-all (objects included). | — | None. Proven (P2, E1, I1). |
| **Processing and status** | Two-step processing with page-referenced chunks; refusal messages; no retry guidance. | Visible step progress; clear retry. | **Three visible steps** ("sending to your private space", "reading and checking for patient information", "saved, opening it"). Each refusal says nothing was kept so the student can fix it and retry. |
| **Mapping and labels** | Auto topic finding when AI help is on; proposals with "Not clinically reviewed", "Draft content" or "Clinically approved" labels; lands on the material page. | — | None. Proven over HTTP (M1, L1). |
| **Context stamp** | 402 history and `contextAt` exist, but no page showed it. | Material context not shown. | **Every material shows "uploaded while studying …"**: programme, level and institution as recorded at the time, on the list and the material page. |
| **No-code config** | Materials per person (WCE). | Formats, size and page limits. Consent text. | **Formats, size and pages are now WCE policies** on `/super-admin/individual/configuration` (versioned, audited, rollback). **Consent text is deliberately not no-code:** it is a versioned, owner- and legal-approved notice whose version is stored with every grant. Editing it needs a new approval and version (an owner decision, not a gap). |
| **Mobile** | Touch-sized controls (`pointer-coarse`); single column below `md`. | Pasting notes on a phone. | **Paste text** mode (where enabled). Upload panel checked at 375 px on staging. |
| **Audit** | Uploaded, refused (with reason), erased and AI calls all audited. | — | None. Proven (U4). |

### New Individual policies (CONFIG-002 / WCE, no code to change them)

| Key | Default | Limits | Note |
|---|---|---|---|
| `scholar_upload_formats` | pdf, docx | pdf, docx, text | **Text is OFF by default:** it needs 405. HQ turns it on only where 405 is applied (fail-closed). |
| `scholar_upload_max_mb` | 10 | 1–10 | 10 MB is the database and bucket cap (372). |
| `scholar_pdf_max_pages` | 300 | 10–300 | Reaches the extractor. |

These are enforced at **both** upload steps: the slot, and processing. A format switched off between the two is still refused.

## 2. Migration 405

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `405-individual-scholar-plain-text-materials.sql` | `c2aaea38a8714978bb994fa94c532aa513733210c3279101a7b6227b5428b09a` | Low | **Applied ×2 on staging** (coordinating session, 2026-10-24; both ok, guard passed; sha matches). **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-UPLOAD/ROLLBACK-405.sql` | `c62b7127ba4d074dbdc38631cf605e71583173e721f92339b9f5e3c2b1f1cac2` | — | — |

- **What it does:** adds `text/plain` to the material MIME CHECK and to the private bucket's allowed types. Nothing else changes.
- **Depends on:** 372.
- **House rules:** ALL CLEAR.
- **Verified read-only by this session:** the material CHECK lists pdf, docx and text/plain; the bucket is still private, with a 10 MB cap and the same three types; 0 text materials before enabling.
- **Turning text on (staging):** `npx tsx scripts/seed-staging-scholar-text-format.ts`. **The owner ran it on 2026-10-24.** `--verify` shows draft and published = pdf, docx, text, actor "COMPETEN-SCHOLAR-UPLOAD Stage 2 staging script (owner-run)". It uses the governed WCE path and refuses production and any pending draft. `--remove` restores the default.

## 3. Verification

- **Unit tests:** Vitest `src/lib` 726/726. New tests: text extraction, sniffing (UTF-8 and NUL), and upload rules.
- **Static harnesses:**
  - scholar-learning 114/114 (new **K20** with planted red **P37**; F5 now reads 372 and 405);
  - foundation 74/74;
  - config 41/41;
  - professional 92/92;
  - competency-foundation 33/33;
  - ratchet green.
- **Build:** real `next build` compiled, exit 0.
- **Staging over HTTP:** `scholar-upload-harness`, against a staging-pointed dev server with the staging-test legal versions. **First run: ALL GREEN, 14 passed, 0 failed, 1 PEND (T1). Re-run on main 9f83aefa after text was enabled: ALL GREEN, 15 passed, 0 failed, 0 PEND.**
  - W1: Welcome leads to the upload panel.
  - W2: the panel states the policy's formats and size.
  - U1: refusals for the attestation, size, a photo (no OCR), and a format the policy has off.
  - U2: an NHS-number file is refused and its object removed.
  - U3: a real PDF is processed.
  - U4: the upload and the refusal are audited.
  - P1: the material page shows its sections, the source download and the context stamp.
  - P2: the original is served by signed link.
  - M1: topic finding runs, with clinical-status labels.
  - L1: a cited explanation and practice questions come from the upload.
  - I1: another student gets 404.
  - E1: erasure removes everything.
  - Z1: fixtures are cleaned up.
  - T1 (re-run): pasted text is kept as a `.txt` original, a text material with no pages.
  - The run reads shared configuration and never writes it.

## 4. Production activation dependencies (none authorised by this build)

1. **Migrations on production, each with its own owner GO** (Supabase SQL editor; OPS-001 recovery reference, rollback, verification).
   - **Already applied and verified in production (24 Oct 2026):** 372, 375, 384, 387, 388, 389, 390, 391, 393.
   - **Remaining, in order:** **394** (S1 controlled catalogue entries), **402** and **403** (Join), **405** (plain text, only if plain text is wanted).
2. **The Individual release gate `individual_app`** turned on in production (owner decision).
3. **Legal:** the Holdings and Scholar Operator Privacy Notice and Terms of Use **published with production URLs and versions** (COMPETEN-LEGAL-001). Without them, AI help, and therefore topic finding and learning, stays unavailable by design.
4. **The Scholar catalogue allowlist** (S1 seed catalogues published in production) and at least one **programme** row: HQ configuration.
5. **Policy:** `scholar_upload_formats` includes `text` only after 405 is in production.
6. **An AI provider** configured in production (it already is for the estate) and the Individual AI quota.
7. **Owner decision (not a dependency for this stage):** an OCR provider for photos of notes.
