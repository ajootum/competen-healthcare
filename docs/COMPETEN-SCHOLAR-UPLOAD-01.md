# COMPETEN-SCHOLAR-UPLOAD-01: Stage 2 Upload, infrastructure review and implementation (build record)

Owner GO 2026-10-24: "COMPETEN-SCHOLAR-UPLOAD-01 Stage 2 — Upload: Infrastructure Review and Implementation". It builds on Stage 2 (#52–#54) and the content-status work (#49).

**Status:**
- Development authorised. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF), and AI help behind consent and the published-legal-documents gate.
- **The Stage 3 hold stands.** "Start learning" opens the EXISTING material page, and no Learn-stage feature was added. The parked `scholar/stage3-learn` branch was not used: one-document study (`materialId`) and library-wide search already existed on `main`.
- **Owner AI-content ruling (2026-10-24) applied:**
  - private AI study material (topics, competency suggestions, explanations) stays labelled formative and unreviewed;
  - no Scholar approval queue was built;
  - shared clinical approval is read from IND-007's Holdings content status (#49), not rebuilt.
  - IND-007's `holdings/clinical-approval` (not yet on `main`) narrows `contentStatus: "approved"` to content that clinical review (395) approved, and adds the optional `clinicalState`. Everything this build shows goes through `contentStatus` and the existing labels, so it needs no change. In IND-007's terms, all of Scholar's AI output here is `private_formative`: always labelled, with no approval step.

**Migrations:** 406, 407, 408 and 409, this build's whole range. See §4.

## 1. Readiness matrix (read from code on `main` 852b427, before this build)

| Capability | Existing | Missing | Implementation (this build) |
|---|---|---|---|
| **Secure upload** | Two-step signed upload into a private bucket, at a server-built path; attestation; policy type and size checks at both steps; magic-byte sniff; refusals delete the object and are audited; sha256 stored; 10 MB DB CHECK. | Duplicate detection (sha256 never checked); Office ZIP screening (zip bomb, macros); PDF script screening; a recorded processing outcome. | The duplicate is refused **before extraction** with a link to the copy (409), and **409** makes it unstorable per person. Office archives are screened **from their directory before anything is inflated**: entries, expanded size, ratio, VBA project. **A PDF carrying a script or a launch action is refused before it is read**: a raw scan for `/JavaScript`, `/JS` and `/Launch`, plus the document's own script table as pdf.js reads it. An unsafe file is refused (422) with its reason. Every upload returns `ready` or `partial`. |
| **Multiple documents in one upload session** | One file per upload. | Several files in one action. | Up to 10 files in one action. **Each goes through the existing two-step slot on its own**, so there is no new storage path, and each is refused independently: one failure never takes down the batch. Per-file status is shown (kept, partly read, already in your library, not kept and why). The batch ends on **one "Your notes are ready" page** for everything that was kept. |
| **Supported formats** | PDF, DOCX, plain text (405), switchable by policy. | PowerPoint. A `.pptx` was sniffed as DOCX (both are ZIPs) and failed as "unreadable". | The ZIP kind comes from its parts (`word/` vs `ppt/`). **PowerPoint is read slide by slide, with speaker notes, and cited "slide N"** (migration 406, and `pptx` in `scholar_upload_formats`, off by default). The `scholar_pptx_max_slides` policy applies. Several files per upload (up to 10). Images, scans and audio stay refused with the reason, so they can arrive later as further extractor kinds. |
| **Document extraction** | unpdf per page, mammoth for DOCX, UTF-8 text; page or section citations; FTS tsvector. | Quality indicators. A PDF with scanned pages was reported as plain success. | `extraction_quality` (406): unit, units, the empty pages or slides, chars, sections. **"Partly read" is shown with the page numbers**, on upload, the ready page, the material page and the library list. Null means "not recorded", never "read in full". |
| **Concept identification** | `chunk_analysis` (388): AI concepts per section, consent-gated. | A material-level topic view; related concepts across uploads. | Topics are aggregated per material (`materialTopics`), and related materials found by **the same topic** (`relatedMaterials`, with the shared topics as the reason). The Holdings analysis is unchanged. |
| **CFCA mapping** | Holdings engine (competency-map-v2); multiple mappings per section; accept, reject and add; S1 gives Domain › Practice › CPU › Competency, outcomes and catalogue version. | Learning-outcome level; a versioned competency reference; R1 (a catalogue-less programme unlabelled). | **Opt-in outcome mapping on the Holdings engine** (`outcomes: true`, `competency-map-v3-outcomes`). The default v2 prompt and version are byte-for-byte unchanged for Professional. The model may name one numbered outcome, **verified to be that competency's own**. Map rows record `catalogue_version` and `outcome` (408). A student's link may name an outcome, and anything else is refused. **R1 fixed:** `competencyAbsence` says why there are no suggestions (no programme, or "{programme} has no competency catalogue Scholar can use yet"), never blocking study. |
| **Multiple-document retrieval** | FTS over the person's chunks: the whole library or one material. | Chosen documents; by competency; attribution across documents. | `materialIds` (up to 10) and `competencyId` (accepted links first, then suggestions, never a rejected one). **Passages are spread across the materials that matched**, so each relevant document is cited by name (`materialTitle` on every source). FTS only, no vectors. |
| **Learner corrections** | Accept, reject (append-only trail), add a link. | Rename; topic correction. | Rename (PATCH). **Topic correction** (408) is the student's own list, which replaces what they see, while the AI row is kept as the record. It is screened for patient identifiers and is personal. Nothing writes to a shared catalogue (pinned by K1 and U3c). |
| **Source provenance** | File name, sha256, extractor, the original by signed link, page or section, the 402 context stamp; map model, prompt and confidence. | The catalogue version on maps; slide citations. | Both added (406 and 408). Citations say "slide N" wherever a PowerPoint passage is cited: explanations, questions, revision and the material page. |
| **Privacy and deletion** | Private bucket, own-folder CHECK, RLS read-own, composite FKs, delete and erase-all cascading through everything derived. | New tables must follow. | The collection uses a composite FK (another person's shelf cannot be stored) and RLS read-own. The topic correction cascades with its chunk. **Erase-all also removes collections.** Proven over HTTP (E1, I1–I3). |
| **No-code configuration** | Formats, size and PDF pages as Individual policy (405 build). | PowerPoint; a slide limit. | `pptx` is added as a format option (OFF by default, fail-closed until 406), plus a new `scholar_pptx_max_slides` (5–300, default 150). Both are WCE: versioned, audited, rolled back. |

## 2. What was built

- **U1:**
  - the real kind is taken from the bytes;
  - the ZIP is screened;
  - PowerPoint is read with speaker notes;
  - duplicates are refused before extraction;
  - several files per upload, each reported (kept, partly read, already in your library, not kept and why);
  - the slide limit is policy.
- **U2:** `extractionQuality` and `qualitySummary`. A partial read is never presented as success.
- **U3:**
  - outcome-level mapping, opt-in on the Holdings engine;
  - catalogue version and outcome on every new mapping;
  - student links may name an outcome;
  - the outcome and catalogue version are shown on each link;
  - R1 is said through one rule.
- **U4:** questions across chosen documents or a competency, spread across materials, every source named.
- **U5:**
  - **"Your notes are ready"** (`/individual/scholar/study/ready?ids=…`), where every upload ends. For each material it shows:
    - read quality;
    - topics;
    - competency relationships with their clinical-status labels and named outcomes;
    - related materials and the shared topics;
    - **what to know** (partial read, AI off, still analysing, R1, AI unreviewed, notes-only);
    - Start learning (the existing material page), Practise questions, Explore competencies, View original notes;
    - rename and collection.
  - The library (My Learning) groups by collection, flags partial reads, and lets the student ask across all notes, chosen materials or a competency.

## 3. Reused Holdings and existing capabilities (no parallel engine)

- **Holdings competency-mapping engine** (`src/lib/competency/mapping.ts`): extended with an additive opt-in; Professional is untouched.
- **Holdings grounding verifier** (explanations) and **patient-identifier screen** (`src/lib/privacy`): reused, the screen now also on student topic lists.
- **S1 `loadCatalogueFor`** and the Scholar catalogue projection: catalogue version, outcomes and content status come from S1.
- **Content status** (#49, IND-007's): labels on every competency shown. No Scholar approval queue.
- **WCE / CONFIG-002 Individual policy:** the format and slide limits.
- **Postgres FTS retrieval** (372): no vectors.
- **The existing store** (`store.ts`, still the only write site), audit, release gate, consent gate, private bucket and signed links.
- **jszip:** already installed under mammoth, now a direct dependency (same version). No new library.

## 4. Migrations

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `406-individual-scholar-pptx-and-extraction-quality.sql` | `dc8963c4854ac1a5c1ff187e09aa9be5b86f3a6fd9feaeaa55934a55d7bbc09c` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2 (see below). **Not on production.** |
| `407-individual-scholar-library-collections.sql` | `f21bf9d4448f0d2f2d69618997d34bcdbab28187f74379bc165c72e2d2fdca78` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. **Not on production.** |
| `408-individual-scholar-mapping-outcomes-and-topic-corrections.sql` | `761538c76a93d61879bd6b66b3b75365ff15d5db8169ea5e9ba462233b7578c9` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. **Not on production.** |
| `409-individual-scholar-material-duplicate-key.sql` | `a689d3945d27140940bb229a9c523f712ae66cac7fe9ec09ac34957ad94e8149` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-406.sql` | `25c4acf2e2fcfc88056d65d29bd074288d321e424ca05b31eba0ea499aa4e6aa` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-407.sql` | `a6555986d8a675d214300649c9e1b4d4409566dbf2a4db95f2d4b5320b3254fe` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-408.sql` | `be0593930dc99450d46a178bce8f67e93357ff6d76e37e1c926a9eb5a01f5568` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-409.sql` | `fc61e01f7807fc46add1cdeb5e8cbcde924b79e10348b0c61196e92a34a969aa` | — | — |

- **Staging run record** (coordinating session, 2026-10-24, under the owner GO; target `ezhvpgtcqcdsgylrxgdb` at every step, guard passed, each run "ok"):
  - The bytes on disk matched the shas above before AND after the runs, for all four migrations and all four rollbacks.
  - Pre-checks: 1 material; 0 titles empty or over 120 characters; 0 duplicate (user_id, sha256) pairs; bucket types pdf, docx, text/plain.
  - Fingerprints of the `individual_scholar%` tables (columns, constraints, indexes, policies, triggers):

    | Step | Tables | Fingerprint | Bucket |
    |---|---|---|---|
    | PRE | 15 | `2dfc862aef86` | — |
    | Apply 406→409, each ×2 (F1) | 17 | `047c829cdc8c` | gains the PowerPoint type |
    | Roll back 409→406 (F2) | 15 | `2dfc862aef86` = PRE | PowerPoint type removed |
    | Re-apply, each ×2 (F3) | 17 | `047c829cdc8c` = F1 | — |

  - Triggers unchanged throughout (`118a7170`).
  - The files are now frozen: any change is a new migration. 410–412 belong to IND-007.
- **Application order:** 406 → 407 → 408 → 409.
- **Dependencies:**
  - 406 on 372 and 405;
  - 407 on 372;
  - 408 on 372 and 388;
  - 409 on 372.
- **409 is kept alone on purpose.** If a person already holds two identical materials, only it fails, and the others are unaffected. Pre-check: the (user_id, sha256) pairs that occur more than once. Staging, 2026-10-24: 1 material, 0 duplicates.
- **House rules:** all four migrations and all four rollbacks are ALL CLEAR (ASCII, LF, no function, `notify pgrst` last).
- **Fail-closed without them:**
  - PowerPoint is off in policy until HQ enables it;
  - an upload stores no quality record if 406 is absent (shown "not recorded");
  - collections, topic correction, catalogue version and outcome are offered or written only when readable (`isNotProvisioned` fallbacks).

## 5. Verification

- **Unit tests:** Vitest **873/873** (80 files). New `upload01.test.ts` covers:
  - PowerPoint slides and notes, slide citations;
  - Word versus PowerPoint by parts;
  - macro, ZIP and PDF-script screening, the slide cap;
  - the format policy, DrawingML text;
  - quality partial and full, and "not recorded";
  - v2 unchanged, outcome numbering and verification;
  - R1 states;
  - spread retrieval, topics and related materials;
  - topic, title and collection checks.
- **A real zip bomb:** 134 KB that expands to 130 MB is refused as `unsafe/expands_too_far` in 7 ms, without inflating it.
- **Static harness:** scholar-learning **116/116**.
  - New **K22**: the real kind from the bytes, a duplicate before extraction, quality stored and returned, outcomes opted in, R1 through one rule, topics screened, Start learning = the existing page.
  - Planted red **P39**: partial reported as ready, the unsafe refusal removed, R1 unsaid, topics unscreened, outcomes off.
  - F5 and K20 know 406 and the slide limit.
- **ci-harnesses:** 51/53 on this Windows checkout. The two reds, `pd-screen-doctrine` and `pui-tokens`, are known CRLF artefacts of a Windows worktree, in files this build does not touch. They pass on an LF clone, and main's CI is green (#56, 9/9 at 82a2205).
- **Build:** a real `next build`, exit 0. The new routes `/api/individual/scholar/collections`, `/api/individual/scholar/topics` and `/individual/[experience]/study/ready` compile.
- **Staging over HTTP:** `scholar-upload01-harness`, against a staging-pointed dev server, running the owner's three-resource scenario.
  - **Final run at the PR head a6a11d79: ALL GREEN, 21 passed, 0 failed.**
    - All three resources ran, the PowerPoint included.
    - The analysis proposed 17 AI links; 13 named a learning outcome, each verified to be the competency's own.
    - The one PEND is R1, which was run by the owner (below) and deliberately not re-run.
  - **Earlier run at e7afa068:** 20 passed, 0 failed, with U1b PEND, before PowerPoint was enabled.
  - **PowerPoint on staging:** the owner ran `seed-staging-scholar-pptx-format.ts` (2026-10-24 12:44 UTC). `--verify` shows `pdf, docx, pptx, text`, draft = published, actor "COMPETEN-SCHOLAR-UPLOAD-01 staging script (owner-run)", with 406 present.
  - **R1 (owner-run):** the owner ran the flagged `SCHOLAR_R1_ZZ=1` run against 3032 at e7afa068 and **reported it done**. This session cannot see its output: the harness deletes its own audit rows on cleanup. What this session verified read-only afterwards is the teardown:
    - no `zz-%` programme row remains;
    - 0 learner and 0 context rows name `zz-harness-no-catalogue`;
    - 0 `harness-upl01-*` identities are left.

    R1's behaviour is also pinned by unit tests and by static K22/P39.

  Results:

  | Check | What it proved |
  |---|---|
  | U1a | The anatomy PDF and the oxygen Word notes are kept. |
| U1b | The pneumonia PowerPoint: 3 slides, speaker notes kept with their slide, each section on its slide. |
  | U2 | The scanned page 2 is recorded (`empty_units [2]`), and the upload says partial. |
  | U1c | A duplicate gets 409, pointing at the copy, and its object is removed. |
  | U1d | A macro Word file, a zip bomb and a PDF carrying a script get 422 and are not read; their objects are removed. The first run found the Office files refused as the wrong kind, fixed in e7afa068. The PDF screen is 311d362b. |
  | U5a | "Your notes are ready" shows each material, its quality, Start learning on the existing page, and the original. |
  | U3a | Every AI suggestion has a catalogue version x.y.z and `competency-map-v3-outcomes`. Each outcome named is the competency's own: 4 of 6 named in the final run, 5 of 8 in the first. |
  | U3b | A student link with an outcome gets 200, and a bogus outcome gets 400. |
  | U3c | `framework_competencies` is unchanged. |
  | U4a | A question across the three is answered from 2 or more of them, each named. |
  | U4b | Choosing one document narrows the question to it. |
  | U4c | A competency narrows the question to its linked sections. |
  | U5b | Rename, a collection with all three, and a duplicate collection name refused. |
  | U5c | Topic correction: theirs is shown, the AI row is kept, an identifier is refused. |
  | U5d | Start learning is the existing material page. |
  | I1–I3 | Another student gets nothing through the ready page, explain, rename, shelving or topics. |
  | E1 | Erase-all leaves 0 materials, objects, collections and corrections. |
  | Z1 | Fixtures are cleaned up. |

- **No regression:** `scholar-upload-harness` 15/0, `scholar-competency-acceptance-harness` 34/0 (its two standing PENDs), on the same server.

## 6. Remaining gaps (stated, not hidden)

- **Images, scanned PDFs and audio:** refused with the reason. They need OCR or transcription, which is an owner decision on a provider. The extractor dispatch is per kind, so each arrives as one more extractor and one more format value.
- **Learning outcomes depend on the catalogue and the model.** An outcome is named only where the competency has recorded outcomes and the model finds one that fits; otherwise the link stands at competency level, and says so by naming none.
- **Lecture PowerPoints are often larger than 10 MB.** The 10 MB DB CHECK and bucket limit (372) cap them. Raising that is a separate decision, not taken here.
- **Related materials are by shared topic only:** exact topic text after normalising. Synonyms are not matched, by design: every "related" has a stated reason.

## 7. Production activation dependencies (none authorised by this build)

1. **Migrations 406, 407, 408 and 409 on production, each with its own owner GO** (Supabase SQL editor; OPS-001 recovery reference, rollback, post-application verification), after the outstanding 394, 402, 403 and 405.
   - Before 409: count duplicate (user_id, sha256) pairs in production.
   - Before 407: count titles outside 1 to 120 characters.
2. **`pptx` in `scholar_upload_formats`** in production, only after 406 is there. It is HQ configuration.
3. Everything Stage 2 already lists:
   - `individual_app`;
   - the published legal documents (AI help);
   - the Scholar catalogue allowlist and programmes;
   - an AI provider and quota.
