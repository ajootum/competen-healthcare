# SCHOLAR-VISUAL-001 phase 2, piece D: charts and SmartArt

**Question.** Charts and SmartArt are flagged for review and not extracted. Does the whole-slide rendering in piece A cover them?

**Decision: yes for showing them, no for reading them. No separate extraction is built.** On PowerPoint, the learner now sees the chart or diagram whole. What it says is still not in the lesson's text, and Reading details keeps saying so.

## Evidence

A test deck made in PowerPoint itself, drawn through the real pipeline, compared with PowerPoint's own export (`shots/shapes-slide-1.png` to `5`):

| Slide | Holds | Result |
|---|---|---|
| 1 | Native bar chart, 3 series, data labels | Every bar height, label (6.4, 7.9, 8.9, 9.6), axis, title and legend present and correct. The plot area sits a little lower than PowerPoint's |
| 2 | SmartArt, with text in its shapes | Same shapes, same layout, same words |
| 3 | Table | Same |
| 4 | Picture with arrows and labels, grouped | Arrows land where they land in PowerPoint |
| 5 | Flow chart of drawn shapes | Same |

Slides holding only these are drawn even with no picture on them. Without this they showed nothing, because there was no picture to extract.

## What rendering does not do

1. **A chart's values are not read.** The lesson's text does not contain them, so a lesson does not teach from them, and search does not find them. A slide with a chart stays flagged ("a chart Scholar cannot read yet"). That sentence stays true, so it is left as it is.
2. **Scores and thresholds.** Keeping them only in a picture is the safer side of the existing rule that scores and thresholds are not taken from charts by AI.
3. **Word.** A chart or diagram in a Word file is not drawn. Its section says it cannot be shown, with the original file a link away (piece C).
4. **Other chart kinds.** One bar chart and one SmartArt layout were tested. LibreOffice lays out charts itself, so a complex chart (combined axes, unusual kinds) can differ from PowerPoint. SmartArt saved with PowerPoint's stored drawing should hold; one saved without it was not tested. Original files stay one link away in every case.

## Why not extract them as well

Chart values could be read from the chart's XML, and SmartArt's words from its data part. That would put them in the lesson's text, which changes what AI teaches from, so it belongs with phases 2 and 3 of the standard, which are out of scope here. It is not needed for the standard's rule that a visual must not be missing.

## Status

No code in this piece beyond piece A. Depends on piece A and its policy `scholar_whole_slides`.
