# SCHOLAR-VISUAL-001 phase 2, piece C: pictures inside Word files

The pictures in a `.docx` were not shown at all, which failed the standard's acceptance for Word. They now show in the notes, in the document's own order, each with the section it belongs to, exactly as they are in the file.

Behind a new policy, `scholar_word_pictures`, default off. No migration, no AI, nothing new stored: a picture is read from the stored file when asked for, like a PowerPoint picture in phase 1, and its key carries a digest of its bytes.

## How a picture finds its place

A Word file has no reliable page numbers, so its sections are numbered, and a picture belongs to the section holding the text just before it. `word-pictures.ts` reads the order of text and pictures from `document.xml`, then looks for that text in the sections as stored. Notes repeat themselves, so of all the matches it takes the one nearest to how far through the document the picture is. Text it cannot find falls back to that same distance. The order never moves backwards.

Handled: a picture before any text, a picture in a table, a floating picture, Word's two forms of one shape (counted once), a linked picture, and a target that tries to climb out of the media folder (never opened).

## What cannot be shown

A picture a browser cannot show (EMF, WMF, SVG), a linked picture, a Word chart and a Word diagram are not shown. **They are not silently left out:** the section says "This section holds a picture, chart or diagram that cannot be shown here" with a link to the original file. Word has no whole-slide fallback here: drawing a Word page would need page layout, which the file does not fix. This is a stated limit, and it is the one place the standard's "missing meaningful visual" is met by telling the learner rather than by showing it.

## Results (`walk.txt`)

`visual-word.docx` was built for this, with the structures Word writes: 8 sections, 6 pictures and an EMF. Each picture follows text that names where it belongs.

| Picture | Expected | Found |
|---|---|---|
| Before any text | First section | Section 1 |
| After BRAVO's text | BRAVO's section | Section 2 |
| In a table, beside DELTA's label | DELTA's section | Section 4 |
| Floating, anchored at the start of FOXTROT's paragraph | After ECHO's text | Section 5 |
| Word's two forms, after HOTEL's text | HOTEL's section, once | Section 8 |
| After all the text | Last section | Section 8 |

- Every picture served is byte for byte the one in the file (sha256 compared).
- Desktop 1440, tablet 820, phone 390: no sideways scrolling, pictures fit. Enlarging works.
- Six figures in the notes, captioned by section, labelled original.

An earlier run failed three placement checks: with repeated text, the first match was taken. The walk found this, a unit test now holds it, and the fix is the "nearest" rule above.

### Safety checks

| Check | Result |
|---|---|
| Private to the learner | Refused with no session (401). Reads are by the caller's own id, as phase 1. Unit test: another person is not found |
| Policy off | No pictures, an empty list, the file not opened. A picture is not served |
| Nothing new stored | No drawing row, no new object |
| Failure | A file that cannot be opened gives an error on the list, and the notes show as they did |

## Limits, stated

1. The fixture is written to the structures Word writes, not saved by Word itself: automating Word hung on this PC. A file with a real Word export should be tried in the integrated journey.
2. Pictures in headers, footers, footnotes and text boxes outside `document.xml` are not read.
3. A section with many pictures shows them all, up to a guard of 40.
4. The lesson strip and the notes share the same pictures. Flashcards and Revise keep their existing "View the original" button for slides and pages only.

## Tests

`word-pictures.test.ts` (order, placement, repeated text, two forms, climbing targets, keys, serving rules), `material-visuals*.test.ts`, `policy.test.ts`. Browser as above.
