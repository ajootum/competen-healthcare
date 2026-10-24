# COMPETEN-SCHOLAR-LEARN-01: Stage 3 Learn (build record and acceptance report)

Owner GO 2026-10-24, "COMPETEN-SCHOLAR-LEARN-01, Stage 3: Learn, Development Authorisation". It folds in the Scholar parts of COMPETEN-AI-FAIR-USE-01: §8 (Learning Artefact Library) and §7 (Learning Continuity, Scholar side).

**Status:**
- Development and staging integration only. **Production activation not authorised.**
- Scholar stays behind `individual_app` (server-enforced, default OFF).
- AI stays behind consent, the published legal documents and the allowance.

**Migrations:** 414 and 415, from the coordinator's range 414–418. 416–418 are unused.

**This GO replaces the draft definition** (closed PR #59). The parked branch `scholar/stage3-learn` (f2329369) was reused piece by piece only where it fitted current `main`. The one piece carried is the no-counting prompt rule (explain v3, modes v6). Nothing was merged or cherry-picked.

## 1. Implementation map (as reported, then built)

| Area | Existing on `main`, reused | Genuine gap, built |
|---|---|---|
| **L1 Learning context** | Ordered, cited chunks; FTS `searchCandidates` with scopes; `competencyChunks`; `spreadAcrossMaterials`; topics with student corrections; `extraction_quality`; maps with outcome and version; the 402 context | One scope type: a section, one document, chosen documents, a topic across the library, or a competency. All are resolved **only** through those reads (`learn.ts resolveScope`). No new extraction, index or retrieval. |
| **L2 Interactive tutor** | `runExplain` modes; the background split and its rules; the Holdings grounding verifier; `generate()` with person attribution; `loadTutorContext` | **`runLearn`, on the same engine** (EXPLAIN_SYSTEM's rules): Teach me, Explain this, Simplify, Go deeper, Give examples, Summarise, Ask Scholar. Each answer keeps four kinds of content apart (§4). Switching action keeps the step and its thread. |
| **L3 Guided sessions** | — | Suggested steps planned **without AI**: document order, topic grouping, up to three sections a step. The cycle is Introduce and Explain (Teach me), Illustrate (examples), Check, Clarify, Continue. Students can skip, revisit and reorder, and Ask Scholar is always open. The informal check is one grounded open question; the clarification returns a verdict (understood, partly, not yet). Explanations are pitched to the student's level (402) and chosen depth. |
| **L4 Learning history** | — | **Migration 414**: sessions, steps, events, event sources and preferences. **Structure only, no conversation.** Students can resume; Progress shows learning activity per competency, labelled "not evidence of competence". History cascades with materials and is removed by erase-all. |
| **L5 Configuration** | WCE Individual policy | **Nine policies**, versioned and audited: actions offered, starting action (Teach me), background beyond the notes, depth, steps per session, understanding checks, learning objectives, conversation turns, learning history. Security, privacy and clinical-safety rules are not settings. |
| **§8 Artefact library** | Cards, questions and cases (372, 388); sessions (414) | **Migration 415**: saved explanations and summaries, with sources, governed references as shown, provenance, and a review status pinned to `private_formative`. Deduplicated per request; "Explain it a new way" replaces the saved one. A **Saved learning** page. |
| **§7 Continuity** | Deterministic marking of stored questions and cases; reads need no AI | `scholar/ai-standing.ts`: the approved AiStanding interface, **stubbed to full** until IND-007's `src/lib/ai/allowance.ts` lands; `src/lib/ai/**` was not edited. When new AI is unavailable or the allowance refuses, Learn says so plainly and shows what is saved. `level_insufficient` says it will not use a weaker model. |
| **Workspace** | Material page, ready page, Progress | `/study/learn`: three regions from `md` up (sources and originals, the guided lesson, the Scholar assistant), and below that one column with tabs. **Start learning opens Teach Me.** My Learning gets "Continue learning" and "Saved learning"; Progress gets "Learn this competency". |

## 2. Reused Holdings and Scholar engines

- **AI:** `generate()` (person attribution, operation `individual_scholar_learn`), with consent, the allowance and the release gate unchanged. There is no Scholar AI engine and no parallel memory.
- **The Holdings grounding verifier** (`textGroundingViolations`) on every notes part, flag and check question. The background rules (`checkBackgroundText`, factored out of `checkSupplementary` unchanged). The patient-identifier screen on everything a student types.
- **Knowledge:** Stage 2's chunks, FTS, topic analysis and corrections, competency maps with outcomes, quality, and the 402 educational context.
- **The personal AI context** (`loadTutorContext`, P1), assembled per request and never grounding. It now carries the level, and still works with no catalogue.
- **CFCA:** `loadCatalogueFor` through the learner catalogue; `competencyLabels`; content status (IND-007, 395) as the review label.
- **Governance:** IND-007's `content-governance.ts` classes. Everything Learn produces is `private_formative`.
- **WCE** for every new setting; the **Scholar store** as the one write site.

## 3. The student's journey

1. **Arrive.** Start learning (on "Your notes are ready", a material, a competency on Progress, or a topic) opens the Learn workspace and runs the starting action, **Teach me** by default.
2. **The lesson.** A suggested step is taught from its sections, cited. The student can switch to Explain, Simplify, Go deeper, Give examples or Summarise; each answer joins the step's thread.
3. **Ask Scholar.** Ask at any time. It searches the session's own sections first and cites them.
4. **Check understanding.** One open question. The student answers, gets a verdict and a clarification from the notes, and the check is labelled "not an assessment".
5. **Move on.** Continue, skip, go back, or pick any step. Finish when done.
6. **Leave and resume.** The session, its step, and each step's actions and check outcome are kept (structure only). "Continue learning" brings the student back.
7. **Saved learning.** Explanations and summaries are kept and opened again without AI, alongside questions, cases, cards and sessions.

## 4. Clinical accuracy and source governance (owner GO §7)

Every answer keeps **four kinds of content apart**, each labelled where it appears:

| Kind | How it is produced | How it is checked |
|---|---|---|
| **From your notes** | Cited `[S n]` to the given sections only | Withheld if uncited, if it cites a tag it was not given, or if it adds a figure, finding or month the notes lack |
| **Governed reference** | `[R n]`: the CFCA competencies and learning outcomes the sections are linked to, with their clinical review state (395) | Grounded on their own words only; never a source of clinical facts. This is the only governed reference source on `main`, and it is labelled as that. |
| **AI explanation beyond your notes** | After `BEYOND THE NOTES:`, only where policy allows and only for Teach me, Go deeper and Examples | The background rules: no figures, units, doses, drug names, citations or identifiers. Otherwise withheld with the reason. |
| **Flagged by AI for you to check** | After `CHECK THIS:`: possible contradictions between passages, or unclear or possibly unsafe statements | Each flag must cite a given passage and add nothing; others are dropped. Shown as the AI's flag, never as a correction. |

**Unsupported or uncertain** content is refused with the reason ("Your notes do not seem to cover that"). Nothing invents a citation.

## 5. Migrations

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `414-individual-scholar-learning-history.sql` | `fe3caf7b641fdecb148b31647fdb4e47f2f14d48844685d69dabc1d5796e440e` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-LEARN-01/ROLLBACK-414.sql` | `619beee560235478ed814fa20c8e1932a1e7decf3766cdf35b9b6cd574019ec0` | — | — |
| `415-individual-scholar-learning-artefacts.sql` | `19ed8b1692c817fe548b4085c67cf46709ad6b8ca6342f52b94e6b1abf85e63a` | Low | **Applied ×2 on staging**, rolled back and re-applied ×2. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-LEARN-01/ROLLBACK-415.sql` | `39eb5754f323ec8194deffb4c83f917d135c1ef8544d72105ae6334ae4d34057` | — | — |

**Staging run records** (coordinating session, 2026-10-24; target `ezhvpgtcqcdsgylrxgdb` at every step; guard passed; every run "ok"; bytes matched before and after; triggers unchanged, `118a7170`):

| Migration | PRE | Apply ×2 (F1) | Roll back (F2) | Re-apply ×2 (F3) |
|---|---|---|---|---|
| 414 | `89d53e7f618b`, 17 tables | `26d51ff05b75`, 22 tables | = PRE | = F1 |
| 415 | `26d51ff05b75`, 22 tables | `4c18b288697a`, 24 tables | = PRE | = F1 |

- **Application order:** 414 → 415.
- **Dependencies:** 414 on 372, 003 and profiles; 415 on 372 and profiles. Both after 413 (main).
- **House rules:** all ALL CLEAR.
- **Fail-closed without them:**
  - without 414, Learn teaches and says sessions cannot be resumed;
  - without 415, nothing is saved and the Saved learning page says so.

## 6. Verification

- **Unit tests:** Vitest **898/898** (`src/lib/individual` 320/320 after the prompt fixes). New `learn.test.ts` covers:
  - step planning, coverage and titles;
  - the four-kind split;
  - the notes check with `[R n]`, invented tags and added figures;
  - flags;
  - the check question and verdicts;
  - the policy switches in the system prompt;
  - offered actions;
  - the level in the context;
  - artefact keys;
  - artefact actions;
  - the standing stub and continuity messages.
- **Static harness:** scholar-learning **122/122**. New checks, each with a planted red control:
  - **K24** (**P41**): 414 holds no conversation column; an event row is structure only; the act route keeps to policy (403), screens input, records only what was shown and stores no practice question; the context is never grounding.
  - **K25** (**P42**): an artefact is private formative and cascades with its material; a saved answer is returned before any AI; continuity is decided before the call; only reusable answers are saved; the standing has one adapter.
  - **K22** now pins Start learning to Teach Me.
- **ci-harnesses:** the two known Windows CRLF artefacts only.
- **Build:** a real `next build` passes (exit 0) on the PR head. These routes compile:
  - `/api/individual/scholar/learn/{act, preferences, sessions, sessions/[id]}`;
  - `/individual/[experience]/study/learn`;
  - `/individual/[experience]/study/saved`.
- **Staging, the owner's first acceptance journey:** `scripts/scholar-learn01-harness.ts`, run alone against a staging-pointed dev server at f72f18d7 (the code is that of the PR head), with real AI and nothing mocked. **ALL GREEN, 26 passed, 0 failed.** Materials: the Stage 2 respiratory set (an anatomy PDF, a pneumonia PowerPoint with speaker notes, oxygen therapy notes in Word). Student A's programme is `nursing-ug-diploma`; student B has no programme and no catalogue.

  | # | Owner's step | Proved |
  |---|---|---|
  | S1 | Teach Me from Stage 2 | "Start learning" on the ready page opens the Learn workspace, for each material and for all of them |
  | J1 | Select several documents | One session; its suggested steps span all three; recorded |
  | J2–J3 | Teach Me; a coherent, grounded explanation | Cited only to the step's sections, each source named, labelled AI-generated and not clinically reviewed. A governed reference was named, and background was shown apart. |
  | J4 | Simplify | Same step, same sections, cited, notes only (no background) |
  | J5 | A contextual follow-up | Ask Scholar answers from the session's own sections, cited |
  | J6 | Explore a related concept | A topic session on hypoxaemia gathers sections from more than one material, explained and cited |
  | J7 | Informal understanding check | One open question from the step's notes, labelled "not an assessment" |
  | J8 | Clarification | A verdict (understood, partly or not yet), corrected from the notes and cited. J8b: no practice question was created. |
  | J9 | Continue | The next step is taught from its own sections |
  | J10 | Leave and resume | After signing in again the session is at step two, with step one's actions (teach, simplify, ask, check, clarify) and its check outcome kept |
  | J11 | Review source references | Each reference resolves to the student's own section on its material page |
  | J12 | CFCA outcomes | Progress shows learning activity against the linked competencies, labelled "not evidence of competence", with "Learn this competency" |
  | A1–A3 | s8 library | The answer is saved (private formative, with its sources) and the same request returns it with **no new AI call**. "Explain it a new way" replaces it. Saved learning lists it with questions, cases, cards and sessions. |
  | C1–C2 | s7 continuity | With the student's own allowance used up (synthetic usage rows for that fixture only, removed after): Learn says so plainly, makes no new answer and returns the saved one. A stored question is still marked by its answer key, and saved learning, progress and the material still open. |
  | NC1 | No catalogue | Student B's session starts and Teach Me answers from the notes, cited, with no governed reference; the workspace renders |
  | I1 | Isolation | Another student gets not-found for the session, an action on it, its sections and a session over its materials |
  | H1–H2 | Structure-only history; material deletion | Events hold only action, step and verdict. Deleting a material removes its steps, sources and saved explanations, and the session keeps the rest. |
  | E1, Z1 | Erasure; cleanup | Erase-all leaves no history and no artefacts. Fixtures are gone: 0 `harness-learn01-*` identities, checked read-only afterwards. |

  **How the journey got to green, recorded:**
  1. A first run stopped mid-way when the Windows shell ran out of processes. Its fixtures were removed by the next run.
  2. A second run had 24 passed and 2 failed: Simplify was **correctly withheld** three times for "two", with J10 failing as a consequence. The prompt fix was learn v2 (a last no-counting reminder), then v3 (Simplify keeps the notes' own names: "the right and left main bronchi", not "two tubes").
  3. A third run had 25 passed and 1 failed: NC1 got a 502 from the AI call itself (a provider failure). The harness now retries a 502 once and reports it, never counting it as a pass.
  4. The final run had no 502.

  One Teach Me answer in the final run was withheld once ("reduced") and shown when asked again: the grounding check working as designed.

## 7. Remaining material gaps

1. **The switch to IND-007's metered AI is a separate PR** (owner and coordinator instruction). `scholar/ai-standing.ts` is still the stub (full AI), and `scholar/http.ts` still uses `individualAiQuota`. With PR #62 merged, the swap passes `runMeteredAi` the approved activity codes and, per owner decision D1, subject context (the sources' competency or domain and topic terms, plus the screened request text) for the engine to classify. Metering stays OFF behind its flag.
2. **Owner decision pending:** IND-007's provisional policy marks `check` as clinically sensitive (not_eligible under metering). With metering on, that would switch off Stage 3's informal understanding check, which is formative, not assessment. Under D1 the engine now classifies by subject, not activity name.
3. **The shared assistant (owner decision D3)** is Holdings'. The workspace's "Ask Scholar" will move to it, configured to default to Teach Me, when IND-007 publishes the per-product interface. Today it is the Scholar Learn route on the same engine.
4. **Governed supplementary references** have no source on `main` beyond the CFCA catalogue. Category 2 is labelled honestly as that, and no reference library was invented.
5. **AI flags (contradictions, possibly unsafe statements) are model judgements.** They are labelled "flagged by AI for you to check", each tied to a passage, and never presented as verified.
6. **Grounding strictness:** a correct but reworded answer can be withheld (for example a count, or a descriptor the notes do not use). The student is told why and may ask again. The prompts carry the rules that cut this, but it cannot be zero by design.

## 8. Production dependencies (none authorised by this build)

1. **Migrations 414 and 415 on production, each with its own owner GO** (OPS-001 recovery reference, rollback, verification), after the outstanding 394, 402, 403, 405–409 and 413.
2. **IND-007's AI-FAIR-USE-01 allowance** (`getAiStanding` and `runMeteredAi`) merged. Then Scholar's adapter (`scholar/ai-standing.ts`) and `scholar/http.ts` switch to it: two files.
3. Everything Stages 1 and 2 already list:
   - `individual_app`;
   - the published legal documents;
   - the catalogue allowlist and programmes;
   - an AI provider and quota;
   - the production global upload limit of at least 25 MB.
