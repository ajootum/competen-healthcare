# SCHOLAR-VISUAL-001 phase 2, piece C: pictures inside Word files

The pictures in a `.docx` were not shown at all, which failed the standard's acceptance for Word. They now show in the notes, in the document's own order, each with the section it belongs to, exactly as they are in the file.

Behind a new policy, `scholar_word_pictures`, default off. No migration, no AI, nothing new stored: a picture is read from the stored file when asked for, like a PowerPoint picture in phase 1, and its key carries a digest of its bytes.

## How a picture finds its place

A Word file has no reliable page numbers, so its sections are numbered, and a picture belongs to the section holding the text just before it. `word-pictures.ts` reads the order of text and pictures from `document.xml`, then looks for that text in the sections as stored. Notes repeat themselves, so of all the matches it takes the one nearest to where the picture should be, counted in characters from the start of the document. Footnote markers are ignored, and footnotes appended to the stored text do not stretch the count. Text it cannot find falls back to that count. The order never moves backwards.

Handled: a picture before any text, a picture in a table, a floating picture, Word's two forms of one shape (counted once), a linked picture, and a target that tries to climb out of the media folder (never opened).

## What is kept

Every picture except a bullet or an icon (under 48 pixels on both sides). The size, shape and repeat filters used for slides do not apply: a Word file has no whole-page fallback, so a wide ECG strip, a small formula or a figure used twice would simply be gone.

## What cannot be shown

A picture a browser cannot show (EMF, WMF, SVG), a linked picture, a Word chart and a Word diagram are not shown. **They are not silently left out:** the section says "This section holds a picture, chart or diagram that cannot be shown here" with a link to the original file. So does a picture the document names but the file does not hold. Word has no whole-slide fallback here: drawing a Word page would need page layout, which the file does not fix. This is a stated limit, and it is the one place the standard's "missing meaningful visual" is met by telling the learner rather than by showing it.

## Results (`walk.txt`)

`visual-word.docx` was built for this, with the structures Word writes: 8 sections of body, a real footnote long enough to add 4 more sections after them, 7 pictures and an EMF. Each picture follows text that names where it belongs.

| Picture | Expected | Found |
|---|---|---|
| Before any text | First section | Section 1 |
| After BRAVO's text, which holds a footnote | BRAVO's section | Section 2 |
| A wide, thin strip (1600 by 90) after CHARLIE's text | CHARLIE's section, kept | Section 3 |
| In a table, beside DELTA's label | DELTA's section | Section 4 |
| Floating, anchored at the start of FOXTROT's paragraph | After ECHO's text | Section 5 |
| Word's two forms, after HOTEL's text | HOTEL's section, once | Section 8 |
| After all the body text | The last body section, not the footnote text after it | Section 8 |
| An EMF straight after it | Said to be there, in the same section | Section 8 |

- Every picture served is byte for byte the one in the file (sha256 compared).
- Desktop 1440, tablet 820, phone 390: no sideways scrolling, pictures fit. Enlarging works.
- Seven figures in the notes, captioned by section, labelled original.

An earlier run failed three placement checks: with repeated text, the first match was taken. The walk found this, a unit test now holds it, and the fix is the "nearest" rule above.

## Independent review

A second read found two blockers and three should-fix items, all fixed and held by unit tests, after the walk above: footnotes could move a picture to a later section (shown with the real mammoth on a test file); small, wide or repeated pictures vanished with no note; a failed read of the sections could be cached as "no pictures"; an empty fallback tag swallowed the pictures after it; and Word lessons sent a request with the policy off. Ink written only as a fallback, a part the file does not hold, and the dialog's label were also fixed. `walk.txt` is the last run after those fixes. It stopped at the tablet step on a dev server short of memory, as its last line says. Tablet, phone, policy off and deletion passed on the run before it, whose only difference is where two consecutive pictures go. A file saved by Word itself is the remaining check, in the integrated journey.

### Safety checks

| Check | Result |
|---|---|
| Private to the learner | Refused with no session (401). Reads are by the caller's own id, as phase 1. Unit test: another person is not found |
| Policy off | No pictures, no request from a lesson, an empty list if asked, the file not opened. A picture is not served |
| Nothing new stored | No drawing row, no new object |
| Failure | A file that cannot be opened gives an error on the list, and the notes show as they did |

## Limits, stated

1. The fixture is written to the structures Word writes, not saved by Word itself: automating Word hung on this PC. A file with a real Word export should be tried in the integrated journey.
2. Pictures in headers, footers, footnotes and text boxes outside `document.xml` are not read.
3. A section with many pictures shows them all, up to a guard of 40.
4. The lesson strip and the notes share the same pictures. Flashcards and Revise keep their existing "View the original" button for slides and pages only.

## Tests

`word-pictures.test.ts` (order, placement, repeated text, two forms, climbing targets, keys, serving rules), `material-visuals*.test.ts`, `policy.test.ts`. Browser as above.
