# SCHOLAR-VISUAL-001 phase 1 and the PowerPoint reading fix: evidence

Owner instructions of 6 Nov 2026: "Correct PowerPoint Reading Classification and Upload Feedback" and "Scholar-Wide Visual Content and Learning
Experience Standard". Regression file: `Growth and Development.pptx` (38 slides), uploaded by the fixture learner on staging. `walk.txt` holds the
results of the browser walks; `shots/` holds the screenshots.

## What the file holds (read from its XML)

| Slides | Holds | Before | Now |
|---|---|---|---|
| 37 | two empty placeholders | "held no readable text", offered for an AI reading | Blank, skipped, no warning, no reading offered |
| 36 | text and two pictures, in groups | "read", pictures ignored | Text read from inside the groups; pictures kept and shown; said to be not interpreted until read |
| 35 | text and two pictures, one group | "read", pictures ignored | The same |
| 17, 29, 33, 34 | text and pictures | "read", pictures ignored | The same, without groups |
| 5, 12, 16, 18 | a picture only | "cannot be read yet" | Original picture shown inline; after an AI reading, "Interpreted from a picture" with the picture still beside it |

Counts on upload: 38 total, 27 text, 10 pictures kept and not interpreted yet, 1 blank, 0 needing review. Each slide counts once.

## How each slide is classified

`src/lib/individual/scholar/slide-classify.ts` is pure and calls no AI. A slide is blank only when it holds no text, no picture, no chart, no diagram,
no embedded object, no media, no ink and no visible drawn shape. A slide that holds a section or an AI reading is never made blank. Each slide has one
status: text, image, mixed, blank, preserved, review or processing.

`preserved` comes from SCHOLAR-VISUAL-001 s3.4 ("preserved but not interpreted should be marked distinctly"). It is not a warning while lessons show
pictures. Where the `scholar_lesson_visuals` policy is off, a picture not read really is unavailable, so the same slide becomes a warning.

## Reprocessing an existing material

"Check the slides again" (`POST /api/individual/scholar/materials/[id]/reading`) reads the stored file and updates only `extraction_quality`. No section,
lesson, plan, answer or AI reading changes. It needs no AI and no migration. On staging it was run on three presentations (33, 75 and 49 sections): section
ids and lengths were identical before and after, and running it again gave the same answer. Saved lessons are not replaced, so no separate refresh is
needed for this check. A reading the learner asks for adds sections and keeps every existing section id.

## Pictures in the notes

`SectionPictures` shows the original bytes inline in the Learn notes and on the material page, in slide order. A picture-only slide stays after the notes
before it. A long slide shows its pictures once. Selecting a picture opens the existing dialog, which now fits the width first and zooms to 400%, moved by
scrolling, swiping or the arrow keys. The lesson strip also picks up picture-only slides that follow its sections.

## Reading walk.txt

The `FAIL material: ... picture inline` lines come from a run that waited 2.5 s for the picture list on a cold dev route, on a server just restarted. The first run passed them, and the final rerun, waiting for the list, passes them (`material (rerun...)`). The `no server errors` failure is `/analyse` answering 503 `not_eligible` for this test learner: existing behaviour on a route this change does not touch.

## Tests

- Unit tests: `slide-classify.test.ts`, `material-visuals.test.ts` and the existing upload, slide-image, visuals, reader and plan-unit tests.
- Regression shapes covered by unit tests: blank, image-only, grouped (nested), mixed, chart, diagram, unsupported picture format, drawn shapes, embedded, media, ink.
- Browser: desktop 1440, tablet 820, phone 390, on a dev server against staging.

## AI cost

No model calls were added. Blank slides no longer use up the per-material reading cap, and no longer cost a reading. The AI save path was exercised with
marked test text and no model call. A real reading of a text-and-picture slide was NOT run, because the policy is off on staging: the reading code is
unchanged, and the save path for it was tested.

## Independent review

A second read before the PR found no blockers and nine should-fix items, all fixed: an outline from a shape's style, and new chart kinds, could read as blank; a failed save could re-read and duplicate a mixed slide's section (now recorded first and undone on failure, `slide-sections-store.test.ts`); a logo-only slide was called kept in lessons and offered for AI; a wordless photo on a text slide raised a lasting warning; card wording counted mixed slides as picture-only; pictures stayed visible during recall; the lesson-pictures policy was not passed everywhere; and the compare picture was lost when lesson pictures are off.

Left as notes: after an AI reading the page shows a slide's picture twice until a reload (the visuals list is kept per page view); speaker notes count as text, so a drawn diagram with notes reads as text; section anchors use the ordinal, so a reading shifts them, as readings already did for picture-only slides.

## Known limits, not fixed here

1. **Whole-slide view.** A PowerPoint slide cannot be rendered whole without a renderer on the server. Pictures and text show separately, so a grouped
   diagram whose meaning depends on layout loses that layout here. The original file stays one link away. This is standard s3.3's fallback and needs a decision.
2. **Word documents.** Pictures inside a `.docx` are not extracted or shown. This is a failed acceptance test for Word under standard s13.
3. **PDF pages.** A whole image-only PDF page is offered by a button that opens it, not drawn inline, because the stored form is a one-page PDF.
4. **Charts and SmartArt.** They are flagged for review by slide and reason. Their text is not extracted.
5. **Mixed-slide labels.** Once a text-and-picture slide has been read, every section on it carries the "read by AI" label, including its native text. This errs on the side of checking against the original.
6. **Per-slide cap.** The existing policy shows at most three pictures a slide (default), with the rest in the dialog's original file link.
7. **Reading cap.** At most 10 slides per material can be read with AI, existing policy.
8. **Phases 2 and 3** are not started.
