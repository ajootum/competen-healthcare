# SCHOLAR-UPLOAD-FIX — status

Branch `scholar/upload-topics-images-01` (base `main` 500df4d4). Not pushed. **No migration.** Production not touched.

## Diagnosis (production, read-only)

Material c140d52c… "Quality Improvement Science and Methods" (pptx, extractor `pptx-drawingml@1`, 49 slides, 47 chunks,
`extraction_quality.empty_units` [33, 38]).

- Topic finding **worked**: 47 `individual_scholar_chunk_analysis` rows (46 with concepts, 277 distinct), written
  09:53–09:54, about 90 s after upload, by AnalysePanel's auto-run (POST `…/materials/[id]/analyse`). `programme_code` was
  null (the learner has no programme).
- Production has 0 Scholar programmes, 0 `programme_framework` rows and no published framework. The "no competencies"
  message is accurate. No draft or in-review framework is exposed, and none was invented.
- The defect was the wording: the ready page said "None found yet." (and the material page "No topics were found in the
  sections looked at so far.") while topic finding was still running, which read as "nothing found".
- Slides 33 and 38 hold only pictures, so Scholar had nothing to read from them.

## What changed

1. **Topics line** (`classify-view.ts` `topicsState`, used by `study/ready/page.tsx` and `FoundInMaterial`). While some
   sections are still waiting (AI help on), it says "Finding topics… n of m sections". "No topics found in these
   notes." appears only once every section has been analysed and none had topics. The AI-off wording is unchanged. If
   progress can't be read, the line says so. AnalysePanel now runs `router.refresh()` after each batch (and at the
   end, as before), so topics appear as they're saved.
2. **Re-link** (`POST …/analyse {relink:true}`, `AnalysePanel`). Applies when the learner now has a programme whose
   catalogue isn't empty, and some analysed sections have `programme_code` null or a different programme
   (`relinkTargets`). The learner then sees a "Link to your programme's competencies" button. Clicking it sends those
   sections in batches of 6 through the existing `runAnalysis` prompt and runner. It's metered as `map`, the same as
   topic finding. Proposals are added through `saveAnalysis`, which uses `ignoreDuplicates`, so concepts and topic
   corrections are never overwritten. After that, `programme_code` is updated (`markRelinked` in store.ts). With no
   programme or catalogue, the absence message stays and gains one clause: "Linking can be run from here once a
   framework is published for your programme."
3. **Picture-only slides** (`slide-images.ts` pure, `slide-reading.ts` service, `POST …/materials/[id]/slides`,
   `PictureSlides`).
   - **Offer:** a pptx with `empty_units` gets "Read the N picture-only slides with AI". It's learner-initiated and
     needs AI consent. Only empty slides are offered, never a slide that was already tried or already has a section,
     and at most 10 per material, ever.
   - **Pictures:** each slide's own `r:embed`/`r:link` ids are resolved through its `.rels` into `ppt/media` only.
     PNG and JPEG are accepted, checked by magic bytes. They're placed one slide per page in a PDF (pdf-lib), and the
     **existing** `runTranscription` (prompt `exam-transcribe-v1`) reads it, two slides per request.
   - **Skipped and said:** EMF, WMF, SVG, GIF and linked pictures, a slide with no picture, pictures over 8 MB per
     slide, and figure-only transcriptions.
   - **PII screen:** each transcription goes through `findPatientIdentifiers`, the upload's own screen. A slide that
     matches isn't kept.
   - **Insertion:** new sections go in slide order with `page_from = page_to = slide`. No existing chunk id changes.
     Only later ordinals are raised, last first, so the unique `(material_id, ordinal)` index never collides.
   - **Material record:** `chunk_count`, `char_count`, and `extraction_quality` (`empty_units`, `chars`, `sections`)
     are updated, plus new keys `ai_read_units` and `ai_tried_units` (406's CHECK allows extra keys). The extractor
     becomes `…+ai-slides-v1`.
   - **Label:** each such section shows "Read by AI from a picture on slide N — check it against the slide". The
     quality notice names the slides as well. The new sections start unanalysed, so AnalysePanel ("Analyse the rest")
     finds their topics.

## Policy key

`scholar_material_image_slides`, with values `off` | `ai_transcription`. **Default `off`.** This follows the precedent of
`scholar_exam_scanned_pages`: slide pictures go to the AI provider, and in healthcare notes they may be clinical
photographs (wounds, imaging) that can identify a patient without any text. The text screen only runs **after** the
image has been sent. Turning it on is an owner decision. Metered under `EXAM_ACTIVITY.transcribe` (= `map`).

## Clinical note

AI-read text is **labelled** on every section it adds, and on the material's quality notice. It's then treated as
notes, the same way exam transcription is: Learn, Explain and Revise use it like any other section. Two things carry
over from the reused prompt. It was written for scanned exam papers, so a diagram comes back as `[FIGURE: …]` (a slide
that yields only such markers isn't kept). It also tells the model not to answer, correct or add anything. The upload
attestation (no patient-identifiable information) still covers the file.

## Tests

- **vitest** (`slide-images.test.ts`, `classify-view.test.ts`, `policy.test.ts`, `extract.test.ts`): 52 passed. Coverage:
  - rels parsing and the ppt/media-only rule
  - unsupported types, magic bytes, the cap
  - topics wording and relink selection
  - insertion order (no ordinal collision, ids kept)
  - a real in-memory .pptx through `pictureSlideImages`
  - a planted planner that sends a non-empty slide makes the empty-slides-only check go red
- **scholar-learning harness:** ALL GREEN, 163 passed. New check **U1**: the policy gate comes before the preflight,
  the preflight before the AI call, the PII screen before a section is kept. Its planted control **P62** removes the
  screen or the gate and goes red.
- **K4 narrowed** (see owner actions): an update of `chunk_analysis` that sets `programme_code` *alone* is allowed.
  Planted control **P63**: the same update that also writes `concepts` goes red.
- **tsc --noEmit** (NODE_OPTIONS=--max-old-space-size=6144, as CI): exit 0. eslint on the changed files: clean.

## Owner actions

- Decide whether to publish `scholar_material_image_slides = ai_transcription`. Until then the picture-slide offer
  doesn't appear.
- Accept the K4 narrowing. "Concepts are never edited" still holds. The re-link step now updates the row's
  `programme_code`, as this brief asked, so that column means "the programme this section's competencies were last
  mapped against". The original programme stays in the audit log and on each proposal's `programme_code`.
- Re-linking can only be used once a Scholar programme with a published framework exists (production has none).
- Known limits:
  - Two parallel requests on the same material can't duplicate sections: the insert hits the ordinal index, and the
    request fails cleanly.
  - If a run is interrupted part-way, ordinals can be left with gaps, but the order stays correct.
  - Learn and Revise don't label AI-read text; only the material page does.
