# COMPETEN-SCHOLAR: upload limits, 25 MB per file and a 10-file / 100 MB session (build record)

**Owner GO 2026-10-24** (Stage 2 acceptance, "Upload limits"), in full:
- Increase the configurable per-file upload limit from 10 MB to an initial target of 25 MB.
- Keep 10 files per session, with an initial combined session limit of 100 MB.
- Keep the limits compatible with storage, processing and hosting; preserve resource protection and clear failure handling.
- Use the existing no-code configuration.

**Status:** development and staging only. **Production activation not authorised.** Migration **413** is this build's; 410–412 are IND-007's.

## 1. What changed

| Limit | Before | Now | Where |
|---|---|---|---|
| **Ceiling for one file** | 10 MB (372: DB CHECK, bucket, `MAX_UPLOAD_BYTES`) | **25 MB** | Migration 413 (CHECK and bucket); `MAX_UPLOAD_BYTES` in `config.ts` |
| **Live per-file limit** | `scholar_upload_max_mb` = 10 (range 1–10) | **Still 10 until HQ raises it**, now in range 1–25 | Individual policy (WCE). Raising it above 10 needs 413 first. |
| **Files per upload session** | 10, enforced in the browser only | **10, enforced on the server too** | New policy `scholar_upload_session_files` (default 10, range 1–10) |
| **Combined size per session** | none | **100 MB** | New policy `scholar_upload_session_mb` (default 100, range 10–100; never below one file at the limit) |

**What a session is.**
- In the browser, it is one upload action. The panel states both limits and checks the batch before anything is sent.
- On the server, it is the files the person **kept in the last 60 minutes**. The limit is enforced at both steps:
  - **at the slot**, which gives an early answer (429 with the reason);
  - **at processing**, which decides, on the bytes actually uploaded, because several slots requested together all pass the early check before any file is kept. A refusal deletes the uploaded object.
- The window is measured on the app clock against `created_at`. That is a rate window, not a grant decision, so a few seconds of skew only moves the edge of an hour.

**Unchanged:**
- the 300-page and 300-slide caps;
- the 600,000-character cap (refused, never truncated);
- the ZIP and PDF screens;
- duplicate refusal;
- the Professional evidence bucket (373, 10 MB);
- processing stays synchronous (see §2).

## 2. Constraints, checked with evidence

1. **Hosting: no request carries the file.** The browser puts the file straight into storage on a one-time signed URL; processing then downloads it from storage. So Vercel's 4.5 MB request and response body limit does not apply (Vercel Functions limits, docs updated 2026-08-24).
2. **Supabase storage:**
   - A bucket limit is honoured only up to the project's **global** upload limit: at most 50 MB on Free, up to 500 GB on Pro (Supabase "Storage file limits").
   - 413 sets the bucket to 25 MB.
   - **Staging proof (L0):** a 24 MB object went through a one-time signed URL, the browser path, into the Scholar bucket and was stored, then removed. So the staging project's global limit is at least 24 MB, and 413's bucket limit is honoured.
   - **Production:** the global limit must be confirmed at or above 25 MB (Dashboard → Storage → Settings) before production.
3. **Processing time and memory.** The route allows 60 s (`maxDuration`); Vercel's Fluid compute default is 300 s and 2 GB / 1 vCPU. The worst cases at 25 MB were measured locally, through the same steps the route runs (sniff and screens, sha256, extract, chunk, quality):

   | File (≈25 MB) | Result | Time | Peak memory above baseline |
   |---|---|---|---|
   | PDF, 300 pages of dense text plus 24 MB of image data | refused at the 600,000-character cap after full extraction (the cap working) | 1.9 s | ≈194 MB |
   | PPTX, 300 slides plus a 24 MB image | 300 slides, 593 sections | 0.3 s | ≈25 MB |
   | DOCX, 3,000 paragraphs plus a 24 MB embedded image (mammoth inlines it) | 272 sections | 1.4–1.7 s | ≈100–215 MB |

   Plus the download from storage: one 25 MB buffer.

   **Every case is far inside 60 s and 2 GB, so no asynchronous path is needed and none is built.** If a later format (OCR, audio) cannot fit, it gets its own asynchronous design then.

**Not addressed, and stated:** very slow mobile connections. A 25 MB standard upload either completes or fails as a whole, and the student is told to try again. Resumable (TUS) uploads would help, but that is a separate change.

## 3. A defect found and fixed

While measuring the 25 MB PDF, the **UPLOAD-01 PDF script screen refused a clean PDF** as `pdf_javascript`.
- **Cause:** it also scanned binary stream data, where the bytes `/JS` followed by a non-letter occur by chance roughly once per 16 MB of image data. A clean image-heavy PDF could be refused at 25 MB, and quite possibly at 10 MB.
- **Fix:** stream contents are skipped and only the dictionaries between them are scanned. pdf.js's document script table still catches scripts in compressed object streams.
- **Proof:** a unit test for the false positive (`/JS` inside an image stream is ignored) with a control (`/S /JavaScript` in a dictionary is still refused); the 25 MB clean PDF now passes the screen.
- **Production:** unaffected, since Scholar is not active there.

## 4. Migration 413

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `413-individual-scholar-upload-25mb.sql` | `267c28eb7606bf863659ff26879469ae1eaf87d1d0ac13bd6dba127b4267df76` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2 (below). Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-413.sql` | `850e5b6e589df52ff5658566f4dd4400557e1af665a3c78c88fb58778a4b8dde` | — | — |

- **Staging run record** (coordinating session, 2026-10-24, under the owner GO; target `ezhvpgtcqcdsgylrxgdb` at every step, guard passed, every run "ok"):
  - The bytes on disk matched both shas before and after the runs. Pre-check: 0 materials over 10 MB.

    | Step | Scholar-schema fingerprint | Size CHECK | Scholar bucket |
    |---|---|---|---|
    | PRE | `047c829cdc8c` | ≤ 10485760 | 10485760 |
    | Apply ×2 (F1) | `89d53e7f618b` | ≤ 26214400 | 26214400 |
    | Roll back (F2) | `047c829cdc8c` = PRE | ≤ 10485760 | 10485760 |
    | Re-apply ×2 (F3) | `89d53e7f618b` = F1 | ≤ 26214400 | 26214400 |

  - Only the constraints component changed (`48f3a68e` → `d09cb6d7` → back).
  - `individual-professional-evidence` stayed at 10485760 throughout.
- **What it does:** replaces the material size CHECK with `byte_size <= 26214400`, and sets the `individual-scholar-materials` bucket `file_size_limit` to 26214400.
- **Depends on:** 372.
- **House rules:** ALL CLEAR (no function).
- **Fail-closed without it:** the live limit stays 10 MB. The owner script that raises it refuses to run unless the bucket is at 25 MB.
- **Rollback pre-check:** count the materials over 10 MB.

## 5. Verification

- **Unit tests:** Vitest **884/884**. New `upload-limits.test.ts`:
  - the ceiling is 25 MB and the live value stays 10 MB;
  - a raised policy reaches 25 MB and is never above it;
  - the session defaults are 10 files and 100 MB, can only be tightened, and never fall below one file;
  - the refusal names whether the count or the size was over.

  `extract.test.ts` pins the new ceiling. The PDF-screen test covers the false positive.
- **Static harness:** scholar-learning **118/118**.
  - New **K23**: 413 raises the CHECK and the bucket; `MAX_UPLOAD_BYTES` is 25 MB; the default is 10; the session is enforced at the slot and at processing.
  - Planted red **P40**: processing stops deciding the session; the default jumps to the ceiling.
  - F5 reads 413.
- **ci-harnesses:** 52/54, plus the two known Windows CRLF artefacts (`pd-screen-doctrine`, `pui-tokens`), which pass on an LF clone.
- **Build:** a real `next build`, exit 0 (on 8c0dbdcc; the commits after it change only the harness and the migration files).
- **Staging:** `scholar-upload01-harness` at de757d49 on a staging-pointed dev server: **ALL GREEN, 23 passed, 0 failed**. All of UPLOAD-01 still holds, plus:
  - **L0:** 24 MB through the signed URL into the bucket.
  - **L2:** the session takes the policy's 10 files, and the 11th is refused at the slot (429) with "…in the last hour…".
  - **L1** is PEND **by design.** It needs the live per-file limit raised above 20 MB, and the owner GO keeps it at 10 MB until HQ raises it. On staging, the owner can run `npx.cmd tsx scripts/seed-staging-scholar-upload-25mb.ts` (it refuses without 413). Then L1 runs end to end through the app.
  - **R1** stays owner-flagged, as before.

## 6. Production dependencies (none authorised by this build)

1. **Migration 413 on production**, with its own owner GO (OPS-001 recovery reference, rollback, verification).
2. **The production project's global upload limit at or above 25 MB**, confirmed in the dashboard.
3. **HQ raising `scholar_upload_max_mb`** in production, only after 1 and 2.
4. Everything Stage 2 already lists: `individual_app`, the published legal documents, the catalogue allowlist and programmes, an AI provider.
