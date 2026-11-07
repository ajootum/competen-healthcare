# SCHOLAR-VISUAL-001 phase 2, piece B: image-only PDF pages, inline

An image-only PDF page used to sit behind a button ("Open page 3 as it is in your file"). It now shows inline, drawn once from the learner's file, with the original page one tap away.

Same policy (`scholar_whole_slides`, default off), same table and bucket as piece A (migration 1010), same job and rules. No new migration. No AI. No LibreOffice: PDFium draws the page.

## What is drawn

| Page | Drawn? | Why |
|---|---|---|
| An image a browser cannot be handed (CCITT, JPEG 2000, CMYK, masks) | Yes | Nothing else can show it inline |
| No text layer and no picture (a vector drawing) | Yes | The same |
| No text layer and two or more pictures | Yes | Its layout is its meaning |
| One ordinary picture | No | It already shows in its original bytes. Drawing a scan again would only cost storage |
| Text | No | Its text is the lesson |

A PDF with nothing to draw is told `not_needed`: no row and no job. At most 60 MB is stored per file, and at most the policy's slide cap in pages. A page over either limit keeps its button, and the row names it.

**A page that draws as one flat colour is not stored.** It may hold something that could not be decoded, so the button to the original stays. A missing picture is never passed off as a blank page. This is what caught the first choice of engine: pdf.js in this build could not decode CCITT or JPEG 2000 and drew those pages blank, which is why drawing moved to PDFium.

## Test file

`visual-pages.pdf` was built for this: 1 text; 2 one JPEG; 3 CCITT scan; 4 JPEG 2000; 5 two pictures and a line, no text layer; 6 CMYK picture on a page with text, set in a font the file does not embed; 7 vector drawing only. Each drawn page was compared by eye to the original. Screenshots in `shots/`.

## Results (`walk.txt`)

- Pages 3 to 7 drawn in about 30 s on a dev server, 2.5 MB stored. Pages 1 and 2 not drawn.
- Every page shows inline, said to be drawn. Page 2 is labelled original.
- The dialog opens the original page.
- Desktop 1440, tablet 820, phone 390: no sideways scrolling, a portrait page fits.

### Safety checks

| Check | Result |
|---|---|
| Stored image private | Public URL refused |
| Failed drawing falls back | The original-page button returns, and nothing claims to be drawn |
| Policy off | The button, as today. Nothing drawn |
| Erasure | Deleting the file removes its 5 drawn pages |

An earlier run stalled with the row left `running` while the dev server recompiled. A direct rerun finished in 23 s. A row left running can be claimed again after 10 minutes. No cause was proved beyond that timing.

## Limits, stated

1. A page of one picture shows that picture alone. Anything drawn over it, such as vector labels on a scan, is not in the inline picture. The dialog offers the whole page. Telling these apart needs reading the page's drawing commands, which this does not do.
2. Images inside Form XObjects are not enumerated (as phase 1): such a page with a text layer shows no picture.
3. Not run on Vercel. See piece A's evidence.

## Tests

`slide-render.test.ts` (which pages are drawn), `slide-render-io.test.ts` (the PDF job, no LibreOffice, flat-colour page), `material-visuals*.test.ts`, `policy.test.ts`. Browser as above.
