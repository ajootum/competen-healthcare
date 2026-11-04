# SCHOLAR-CE07C: staging proof under constrained network conditions (4 Nov 2026)

**Where:** this branch's dev server (port 3179, webpack) pointed at STAGING (ezhvpgtcqcdsgylrxgdb), migration 960 applied
there. Real Chromium (Playwright) driven with **Chrome DevTools network emulation** (CDP `Network.emulateNetworkConditions`):
"Slow 3G" = 400 ms latency, 500 kbit/s up and down; offline = DevTools offline (in-flight requests fail, `navigator.onLine`
false, `offline`/`online` events fire). Learner: the staging pilot learner fixture (credential read in code, never printed).
**File:** a 16-slide deck exported to PDF, 10,222,322 bytes (10.2 MB, 9.7 MiB; staging policy allows 10 MiB), every
slide a heading, teaching text and a photo-like picture that does not compress. Each run used a different deck (different
sha256). Every result is checked in the staging database with the service role: one material per file, original bytes in
storage equal to the local file (sha256), the 960 upload record's state, and exactly ONE `individual_scholar_material_uploaded`
audit row for the material (the finish writes it once per extraction: extraction ran once).

Scripts: `scripts/walk.mts` (browser walk), `scripts/make-deck.mts`, `scripts/cleanup-proof.mts`, `scripts/tus-probe.mjs`.

## Results: 34 / 34 PASS (plus 2 / 2 clean-up)

| Run | Condition | Result |
|---|---|---|
| A | Slow 3G, **offline for 20 s at 30 %**, reconnect | "Paused, waiting for a connection. 3.0 MB of 9.7 MB (30%) sent, kept safely: it continues by itself when you are back online." (plain, not an error); on reconnect "Uploading 3.0 MB of 9.7 MB (31%)"; ready page after **226 s**. 1 material, bytes intact (sha256 a051bb18...), 16 sections, record `kept`, 1 audit row. Progress samples only rise (10, 16, 22, 29 ...). |
| B | Slow 3G, **tab closed at 35 %**, new tab | Banner "An upload was not finished. deck-2.pdf: 3.4 MB of 9.7 MB sent. Choose the same file again and press Upload to continue from there." Same file chosen: storage requests `HEAD`, then `PATCH Upload-Offset 3145728`, `4194304` ... (no new upload, no byte re-sent). 1 material, bytes intact, record `kept`, 1 audit row. |
| C | Finish answer **lost** (connection reset after the server answered) | First finish 200 (never reached the browser); the automatic retry answered 200 `already=true`. 1 material, bytes intact, record `kept`, **1 audit row** (no second extraction). |
| D | The same file again | "already in your library", answered at the slot from the sha256: **0 storage requests** (nothing re-sent). |
| E | Slow 3G, **Cancel at 15 %** | "Cancelled. Nothing was kept."; record `cancelled`; 0 objects left; 0 materials. |
| F | **Corrupt upload**: slot for deck-5's sha256, deck-6's bytes (same size) sent to that path | Finish 422 "The file did not arrive complete, so it was not read or kept. Upload it again." BEFORE extraction; record `refused`; object removed; 0 materials for either file; a retried finish gets the same 422 (stored answer, nothing re-read). |
| G | **Two finishes at once** for one good upload | Answered 200 and 202 (`processing`: the second waits for the first's claim); a later finish 200. 1 material, bytes intact, record `kept`, **1 audit row**. |
| Clean-up (hourly) | A planted upload record issued 25 h ago + its object | `sweepAllUploads`: object removed, record `abandoned` (`{"abandoned":1}`). |
| Clean-up (per person) | `sweepPersonUploads` on the fixture | Removed 0 (no orphan older than 24 h); all 8/8 kept materials' originals still present (no false deletion). |

Screenshots: `A1-slow3g-uploading.png`, `A2-offline-paused.png`, `A3-resumed.png`, `A4-ready.png`,
`B1-unfinished-banner.png`, `D1-duplicate-before-sending.png`, `E1-cancelled.png`. Raw log of the final A run:
`walk-A-results.json` (the B-G console output is reproduced in the table above).

**Re-run after moving the record statements into the Scholar store** (the scholar-learning harness requires store.ts to be
the only Scholar write site): runs C, E, F and G again 16 / 16 PASS with the same results, and the clean-up proof again
2 / 2 PASS (`{"abandoned":1}`, all kept originals present).

After the walk the five walk materials and the fixture's upload records were removed; the fixture has its original 3 materials.

## TUS on staging (the probe, before building)

`scripts/tus-probe.mjs`: `POST /storage/v1/upload/resumable/sign` with `x-signature: <signed upload token>` -> 201 + Location;
`PATCH` 6 MB -> 204 offset 6291456; `HEAD` -> offset 6291456; a token re-issued for the SAME path continues the same
upload -> 204 offset 7340032; the downloaded object equals the bytes sent; the same token for ANOTHER path -> 400
"Invalid signature" (the token stays bound to the one server-chosen path). 1 MB chunks also work (used on slow connections).
The plain `/storage/v1/upload/resumable` endpoint refuses the token (403 RLS), which is why the `/sign` endpoint is used.

## Not covered here

- A real phone on a real Ugandan network (the emulation is Chrome's). CE-07 acceptance (Wave 4) should repeat run A on a
  phone over a mobile connection.
- The Professional evidence upload (`/api/evidence`, bucket 373) is unchanged and was not re-tested.
- The single-PUT fallback (used only if the resumable endpoint answers 404) was not exercised on staging: the endpoint exists.
