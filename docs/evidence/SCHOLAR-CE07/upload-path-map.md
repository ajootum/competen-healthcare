# SCHOLAR-CE07C: the Scholar upload path as it is (main @ e19a363a, 4 Nov 2026)

Read before changing anything (owner directive LEARNING-CLOSE-2026-11, WS02 CE-07, acceptance 6.5).

## How an upload proceeds today

1. **Slot** `POST /api/individual/scholar/uploads` `{ mime, size, piiAttested }`
   (`src/app/api/individual/scholar/uploads/route.ts`). Checks policy formats and size, the attestation, the
   materials-per-person cap and the upload-session window, then `createUploadSlot` (`store.ts`) mints a fresh
   `uploadId` (random UUID) and a one-time signed upload token for the server-chosen path
   `<user_id>/<uploadId>.<ext>` in the private bucket `individual-scholar-materials`. Nothing is recorded server-side.
2. **Bytes** `UploadPanel.uploadOne` (`study/_components/client.tsx`) calls `storage.uploadToSignedUrl(path, token, file)`:
   ONE multipart `PUT /storage/v1/object/upload/sign/...` carrying the whole file (up to 25 MB, policy 10 MB today).
   No progress, no retry, no resume.
3. **Finish** `POST /api/individual/scholar/materials` `{ uploadId, mime, fileName, piiAttested }`
   (`materials/route.ts`, maxDuration 300 s). Rebuilds the path from the caller's id, downloads the object, checks
   size and session, sniffs the bytes, refuses a duplicate by sha256 (409 unique per person), extracts (optionally AI
   transcription of a scanned exam paper), screens for patient identifiers, chunks, and `createMaterial` inserts the
   material with `id = uploadId`, then its chunks. Any refusal deletes the object.

The Professional evidence upload (`src/lib/evidence/client-upload.ts`, `/api/evidence`, bucket of migration 373) is
a separate route and bucket with the same signed-URL pattern. It is NOT changed by CE-07C.

## Where an interruption leaves partial state today

| Interruption | What is left | Learner sees |
|---|---|---|
| Connection drops during step 2 (any size) | Nothing in storage (single PUT is atomic), but every byte sent is lost | "It could not be uploaded. Check your connection and try again." Restart from 0 bytes |
| Tab closed / phone sleeps during step 2 | Nothing; the work is lost | Nothing on return |
| Tab closed or connection lost after step 2, before step 3 reaches the server | A complete object in the person's folder with **no material row**, kept forever (only "erase all" removes it) | Nothing on return; uploading again sends the whole file again |
| Step 3 response lost (slow extraction, network drop) and the learner presses Upload again | A second slot and second full upload; the finish is refused as a duplicate (sha256) | "already in your library": correct outcome, but the file was sent twice |
| Step 3 **retried with the same uploadId** (a client retry) after the first succeeded | **DEFECT**: the duplicate check finds the material just created (same sha256), and `discardUpload(path)` deletes the object that material points at: a kept material with no original file | The material opens, but its original cannot be downloaded or re-read |
| Two step-3 requests for the same uploadId at once | Both extract (and may both pay for AI transcription); the second insert fails on the primary key and `createMaterial`'s failure path **deletes the object** the first one kept (same DEFECT) | One material, original file missing |
| Any network failure | "Competen could not be reached..." in red, as an error | No bytes or percent, no paused state |

Also: no integrity check between what the browser had and what storage holds (the server trusts whatever object is
at the path), and a duplicate file is only detected after the whole file has been sent over the network.

## What CE-07C changes (summary, details in the PR body)

- Bytes go through Supabase Storage's resumable (TUS) endpoint `/storage/v1/upload/resumable/sign`, authorised by the
  SAME signed upload token (proved on staging: `x-signature` accepted, token bound to its path, a re-issued token for
  the same path continues the same upload, `HEAD` returns the stored offset). Single-PUT fallback kept.
- One upload identity per file: the client hashes the file first (sha256), the server reuses an unfinished upload of
  the same bytes, and the resume record survives a closed tab (24 h, matching the TUS URL lifetime).
- Finish is idempotent and runs extraction once (migration 960 claim), never deletes an object a kept material uses,
  and verifies size and sha256 before extraction.
- Abandoned uploads are cleaned up (per person on the next upload, and hourly with 960).
