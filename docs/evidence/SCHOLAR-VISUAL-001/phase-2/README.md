# SCHOLAR-VISUAL-001 phase 2, piece A: whole slides from PowerPoint

Owner decision of 6 Nov 2026: "Proceed with faithful original-slide rendering and remaining visual-content improvements in phases." Standard: if individual-object extraction cannot reliably preserve the educational meaning, render the complete original slide or page as a fallback. Never create a synthetic replacement for the original picture.

**State of migration 1010 (CLAUDE.md four states):** 2, applied and verified on staging (`ezhvpgtcqcdsgylrxgdb`), twice, idempotent. **Not applied to production.** When merged, `main` holds it while production does not. The feature is behind policy `scholar_whole_slides`, which defaults off and fails closed without the migration. sha256 `1b7a4b0d39be16ca6d202f2413ccb4342e00d4ae29cb72b5137b21338378c948`. Depends on 372, 405, 406, 413. Rollback: `../ROLLBACK-1010.sql`.

**Not proven yet:** a run on Vercel itself. No deployment was made. The function was simulated on the AWS Lambda Node 22 image (Amazon Linux 2023), one CPU, 2 GB, read-only code, writable `/tmp` only, no network. Before the policy is turned on in production, one preview run must confirm the function's size and time.

## The choice

Measured on `Growth and Development.pptx` (38 slides). PowerPoint's own export on this PC is the reference. "Similarity" is the mean over all 38 slides of a block SSIM at 960x540, grey. 1.000 is identical. Slides of text score low when a font differs, even with every word and line in place, so the pictures matter more than the number.

| Option | Similarity | Time, one CPU, 2 GB | Size | Where the file goes | Cost | Verdict |
|---|---|---|---|---|---|---|
| PowerPoint | reference | 14 s | Office licence on Windows | this PC | Office licence | Cannot run on Vercel. Used only as the reference |
| LibreOffice, native Linux build | 0.907 with fonts matched, 0.890 without | 9 to 12 s warm, about 23 s first run | 505 MB unpacked, 227 MB gzip after trimming (a further trim is possible) | our function | Vercel usage | Fastest. Runs a learner's file as native code in a process that can reach our secrets, and needs 35 MB of extra system libraries and a place to keep a large binary |
| **LibreOffice, WebAssembly (chosen)** | 0.905 with fonts matched | 96 to 143 s to start, then 20 to 36 s | 247 MB unpacked, 78 MB gzip | our function, memory and `/tmp` only, proved with networking off | Vercel usage: about one US cent per deck (estimate, not a measured bill) | Same engine. A damaged or hostile file has only the engine's own memory to reach. Installed from npm with a locked hash. The job runs once per deck in the background |
| `pptx-preview` (JavaScript, in the browser) | not scored | 1.3 s | 1.8 MB | the learner's browser | none | Lost capitals ("ONE MONTH-REFLEXES" drawn as "One month-Reflexes"). Closed source. Not taken further |
| Outside converters, Microsoft viewer | not tested | not tested | none | a new outside service | per use | The owner's decision. No learner file was sent |
| Our own conversion server | as native | as native | new hosting | new hosting | monthly | The owner's decision. Not built |

Peak memory of the WebAssembly engine: about 1.6 GB. The job in full, cold: about 190 s (unpack 10 s, start up to 140 s, convert about 25 s, draw about 1.3 s a slide), against 280 s allowed and a route limit of 300 s.

## What it does

1. Opening a presentation asks once for its slides to be drawn (`POST .../materials/[id]/whole-slides`). The answer is immediate and the job runs in `after()`. The row's primary key is the claim, so a second request starts nothing.
2. A working copy of the deck has its fonts named by their metric-compatible equivalents (Calibri to Carlito, Cambria to Caladea, Arial to Liberation Sans, Times New Roman to Liberation Serif), so a line breaks where PowerPoint breaks it. The stored file is never written to.
3. LibreOffice, in a child process with no secrets in its environment, makes a PDF: lossless, every picture at its own resolution, hidden slides included.
4. pdf.js draws the slides that need it, 1920 wide, stored as lossless WebP in the same private bucket under the learner's own folder.
5. The visuals list adds a whole slide ahead of that slide's pictures. In the notes and the lesson strip the whole slide stands for them. In the dialog they stay one tap away, labelled original. Saved lessons hold no copy, so they show drawn slides with nothing regenerated.

**Slides drawn:** those holding a content picture, a picture a browser cannot show, a chart, a diagram, a table, a group, a connector, or two or more drawn shapes. Plain text, blank and logo-only slides are not. Growth and Development: 10 of 38, 1.2 MB stored.

**A page is only stored under the slide it shows.** Scholar numbers a slide by its part name; a drawing follows the order of the deck, which differs once a slide has been moved. The map comes from `presentation.xml`. If it cannot be read, or the page count differs from the deck, nothing is stored.

**Wording.** A drawn slide is not the original bytes, so it is never called original: "Whole slide drawn from your file — not AI-generated". The dialog says a font can differ.

## Results

`walk.txt` is the first full walk on Growth and Development. `walk-2.txt` is the remaining parts. Screenshots are in `shots/`.

- Slides 35 and 36: each picture and its label stay together, in the layout of the original (`shots/desktop-slide-35.png`, `phone-slide-36.png`, `tablet-slide-35.png`). Mean difference from PowerPoint's own picture: 1.36 and 0.93 of 255.
- Desktop 1440, tablet 820, phone 390: no sideways scrolling, whole slide fitted, proportions kept.
- Chart, SmartArt, table, grouped diagram, drawn flow chart (a test deck made in PowerPoint): all drawn, values in place (`shots/shapes-slide-1.png` to `5`).
- A saved lesson reopened: whole slide in its notes, nothing regenerated.

### Safety checks

| Check | Result |
|---|---|
| Stored image private | Public URL refused (400). Image route refuses no session (401). Another person's id reads nothing and touches no storage (`slide-render-io.test.ts`) |
| Failed drawing falls back | Original pictures show, nothing claims to be drawn, no new job. Also seen for real: on this memory-short PC the job timed out twice and left a clean `failed` row with a reason and nothing stored |
| Policy off | The page does not ask. Drawn image not served. Original pictures as before. The record stays, so turning it back on needs no second drawing |
| Erasure | Deleting a deck removes its 5 drawn images and its record. `eraseAllMaterial` removes them by their recorded paths |
| At most once | Later page views: same claim, one attempt |

### Reading walk.txt

- `policy on: opening the material asks once (0)`, `slide 35: one figure...` and `figures in the notes: 0`: the walk looked before the page's list had arrived on a cold dev route. The same run then shows `1 asks in all`, and its later checks and screenshots show one figure per slide. The walk now waits.
- `test deck: ... status failed reason timed_out`: this PC had about 1 GB free. The same deck converts in 162 s cold in the function-like container. A development-only setting (`SCHOLAR_RENDER_DEV_BUDGET_MS`, ignored in production) gave the dev run more time, and `walk-2.txt` passes.
- `no server or page errors`: `/analyse` answers 503 `not_eligible` for this test learner, existing behaviour. One page answered 500 with a webpack chunk error during dev recompilation.
- `learn: a session opens` in walk-2.txt: the check ordered by a column the table does not have. The later line, a saved lesson reopened, is the real check.

## Limits, stated

1. **Fonts.** A font the engine does not have is replaced: Agency FB, on this deck's headings, draws in another sans. Words and line positions stay close; a heading can look different. The dialog says so.
2. **First view waits.** A presentation shows its original pictures for about three minutes after it is first opened, then whole slides appear with no reload, while the page stays open. There is no message: nothing is missing meanwhile.
3. **Cap.** At most 80 slides drawn per file (policy, up to 150). The rest keep their original pictures. The row records which.
4. **Resolution.** A slide is drawn 1920 wide. A larger original picture has more detail than its place on the slide, so for fine detail the dialog offers the original.
5. **Memory.** One job at a time on an instance. A second request is told to come back and spends no claim.
6. **Storage.** About 120 KB a drawn slide, in the Supabase bucket, not counted against the learner's upload limit.
7. **Engine package.** `@matbee/libreoffice-converter` is one maintainer's build of LibreOffice, pinned exactly and hash-locked. It runs with no secrets and, as tested, no network.

## Independent review

A second read before the PR found one blocker and six should-fix items, all fixed:

- **Blocker.** The clean-up of abandoned uploads (sweepPersonUploads) would have deleted every drawn slide a day after it was stored, at the learner's next upload. The record would still say drawn, so saved lessons would show broken images. The sweep now keeps recorded drawings and skips the run if it cannot read them. An image no record names, from a killed job, still goes once it is a day old.
- A drawn slide that cannot be loaded now gives way to the original pictures, in the notes and the strip.
- Two requests arriving together could both start the engine. The engine is now reserved before the claim.
- Deleting a file now also removes images a killed job never recorded.
- A logo-only slide that also holds a chart or diagram is now drawn.
- A timed-out job now kills the engine's whole process group, so its memory is freed.
- Wording that called a drawn slide original is corrected, and the note no longer promises pictures on a chart-only slide.
- The .render-engine folder is kept out of the deploy archive. The page stops checking once the server says drawing is off.

Not verifiable from the code, and so to be confirmed by a preview deployment: the function's final size, @napi-rs/canvas loading on Vercel, the time on Vercel, and process-group kill there.

These fixes came after the browser walks. They were checked by unit tests (slide-render-store.test.ts, slide-render-io.test.ts), not by a further walk.

## Owner steps for production

1. Apply `1010-individual-scholar-slide-render.sql` in the Supabase SQL editor, after a separate GO.
2. After deployment, turn on `scholar_whole_slides` in the Individual policy page.

## Tests

- `slide-render.test.ts`: slide order, moved slides, what is drawn, once only, font names, malformed records, keys.
- `slide-render-io.test.ts`: the claim, policy off, table absent, engine failure, storing failure, page count, deck order, deletion mid-job, privacy.
- `slide-render-store.test.ts`: the upload clean-up keeps drawn slides; deletion takes them, recorded or not, and nothing outside the learner's folder.
- `policy.test.ts`: default off.
- Browser: desktop 1440, tablet 820, phone 390, dev server against staging.
