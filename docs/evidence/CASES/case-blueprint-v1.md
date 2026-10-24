# The shared clinical case blueprint, `case-blueprint/1`, and the case interfaces: FOR AGREEMENT

**Status:** **AGREED** by IND-004 on revision 2 (7114f987), with two runtime fixes, R1 and R2, which are in (below). IND-004 needs no further review. The contract is the type, validator and projections in `src/lib/cases/blueprint.ts`, with its tests in `blueprint.test.ts` (24/24, and 9 planted violations each go red).

## One structure, two profiles

- **One blueprint** for a student's private AI-generated case, an educator-authored case, and a governed library case.
- **The profiles** differ only in what a case must carry, never in shape:
  - `private` is the minimal form;
  - `library` adds the patient, CFCA-linked objectives, a debrief and the rights it rests on.
- **Clinical approval is not inside the blueprint.** It is a fact of the governance record about ONE exact version (`clinical_content_version`, kind `case`, migration 422).

| Part | Holds | Governed (approved with the version) |
|---|---|---|
| `summary`, `learnerIntro` | `summary`: catalogue and educator text, **server-side only** (B2). `learnerIntro`: the optional spoiler-free opening a learner sees | yes |
| `facts[]` | Every finding and its value: id, kind, label, value, unit, `revealedAt` ("start", a stage, or "request": only when asked for or a consequence), `safetyCritical`, optional `aliases` a typed request may use (N1) | yes |
| `stages[]` | Ordered stages: title, the facts each reveals automatically, its decision points, an optional `narrativeHint` | yes (the hint is guidance for AI phrasing, not a fact) |
| `decisionPoints[]` | Prompt; kind `single`, `multiple` or `free_text`; the reasoning `dimension` (B7); options each with the deterministic key `correct` and a `rationale`; an optional decision-level `rationale` (B6); `permittedReveals` (facts the learner may ask for at THIS point); an optional governed `hint` for guided mode (N2); `expectedResponse` and `rubric` (each criterion with its `dimension`) for free text; `sourceRefs`, private only (B8) | yes |
| `progression[]` | Deterministic transitions: from a stage, on options (or the one default), to a stage, revealing `consequenceFactIds`. Empty means the stages run in order | yes |
| `learningObjectives[]` | Text, the CFCA competency ids each serves (the original identifiers), optional measurable `outcomes` (N4) | yes |
| `safetyCriteria[]` | Machine-checkable: a decision point plus `mustSelect` and/or `mustNotSelect` option ids | yes |
| `feedback`, `assessment` | Debrief, the safety-event message, the rubric and pass mark | yes |
| `variation.rules[]` | Which non-safety-critical facts may vary, and to what values or range | yes (the boundaries) |
| `aiBoundary` | What AI may do around the facts: `patientVoice`, `phraseReveals`, `explain` | yes |
| `metadata` | Level, complexity 1–5, risk (`standard` is the engine tier `clinical_educational`, `high` is `high_risk_clinical`: N3), profession, specialties (several: one case, no copies across specialties), CFCA domains and CPUs, and provenance (kind, candidate, parent version, rights, attestation version) | yes |

## IND-004's review, adopted

- **Governed facts are kept apart from AI narrative.** AI never invents a finding, a value or a consequence. Progression is `nextStage()`, deterministic.
- **Reveals are permitted per decision point** (`permittedReveals`), in addition to stage reveals.
- **Safety-critical criteria are machine-checkable.** `safetyEvents()` decides from the answer, never an AI judgement.
- **Expected responses stay server-side.** `learnerView()` is the only projection a browser receives. It carries no key, no rationale before answering, no expected response, no rubric, no consequence, no safety flag, and no unrevealed fact. A test plants all of these and proves none leaks.
- **One structure for private and library cases,** including Scholar's existing S4 cases as they are (below), with no data migration.
- **A variation inside the rules is still the approved version** (`variationWithinBounds`). A safety-critical fact never varies. Anything else is a new version, with renewed approval.

## IND-004's second review, adopted (B1 to B11 blocking, N1 to N4)

**The browser boundary (B1 to B5).** The server keeps the blueprint and the session state; a browser only ever receives these two projections.
- `learnerView(b, { reachedStageIds, revealedFactIds }, salt, { hints? })`.
  - **B1:** it returns only the stages REACHED, in order, and their decision points. Nothing ahead, and nothing on a branch the student did not take.
  - **B2:** it shows `learnerIntro` (or the presenting complaint), never `summary`.
  - **B3:** every fact, stage, decision and option leaves the server as an opaque per-view token (`viewToken`: sha256 of salt, kind and id, truncated). An option is keyed by its decision point too, because option ids repeat between decisions.
    - The server resolves tokens with `resolveToken` and `resolveOptions`. `resolveOptions` refuses a token that is not one of THAT decision's options.
  - **B4:** the visible facts are derived (`visibleFacts`): the start facts, and those a reached stage reveals (by `revealedAt` or the stage's `reveals`). On top of these come `revealedFactIds`, which the server adds to only when a reached decision permitted asking for the fact, or when an answer made it a consequence. A `"request"` fact is never revealed by reaching a stage.
- **B5:** `answeredView(b, decisionPointId, chosen, salt)`, after an answer, returns that decision's rationale, each option's key and rationale (and whether it was chosen), and the texts of the safety events the answer broke. It returns nothing about any other decision.

**The S4 form and the reasoning dimensions (B6 to B8).**
- **B6:** a decision may carry one `rationale`, which is how Scholar stores S4.
  - In a private case, an option's own rationale is then optional.
  - A library case still explains every option.
- **B7:** `dimension` is one of recognition, interpretation, prioritisation, decision, reassessment or escalation (`DEFAULT_DIMENSIONS`), and applies to decisions and rubric criteria.
  - The set is policy: `validateBlueprint(b, profile, dimensions)`.
  - A library case names every dimension. A private case may leave them out, because Scholar's existing S4 cases carry none and stay valid as they are. When a private case does give one, it is validated.
- **B8:** `sourceRefs`, opaque references to the student's own sections, are valid in a private case only.
  - The library profile rejects them.
  - `privateCaseSnapshot` strips them before an offer (C-b).

**Validation (B9 to B11),** all in `validateBlueprint`:
- **B9:** a decision's `stageId` must be the one stage that lists it.
- **B10:** with explicit progression, every stage is reachable from the first, at least one stage ends the case, and there is no cycle (a case always moves forward to an end). A stage with option transitions needs a default, or a transition for every one of its options.
  - No progression means the stages run in order, which is always sound.
- **B11:** one option never leads to two stages. Because a transition names options by id, option ids must not repeat between the decision points of one stage.
- **R1:** with explicit progression, a stage with no outgoing transition ENDS the case. `nextStage` reads this the same way as the validator, so a terminal branch stage placed mid-array never runs on into the next stage in the array. The in-order fallback applies only when `progression` is empty.
- **R2 (option a: unrepresentable, not documented):** an answer chooses a branch only where it is ONE choice. Option-keyed transitions are allowed only from a stage with exactly one decision point, and that decision must be `single`.
  - A stage with several decisions, or with a `multiple` or `free_text` one, moves on by its default only.
  - So array order never decides a branch.

**Non-blocking, folded in now so the contract changes once:**
- **N1:** fact `aliases`.
- **N2:** the decision `hint`, shown only in guided mode.
- **N3:** the risk mapping to engine tiers (above).
- **N4:** objective `outcomes`.

**The leak tests** (`blueprint.test.ts`, the browser boundary) use a branching case, `BRANCH`, with distinctive ids and planted secrets: the summary, the rationales, the expected response, the rubric, the safety text, and future and off-path titles, prompts, options and facts.
- They check, at the start, on the key path and off it, that no id and nothing server-only appears in the serialised view.
- They also cover: a requested reveal; tokens that differ per view, are distinct per option and resolve only with the salt; hints only in guided mode; and the answered view.
- Two further tests cover R1 (a terminal branch stage that is not last in the array) and R2 (a `multiple` decision, and a stage of two decisions, with keyed transitions).
- **Each control was proven by planting the violation:** showing every stage, exposing the summary, unscoped option tokens, raw ids, auto-revealing a request fact, dropping the cycle check, dropping the overlap check, the old in-order fall-through (R1), and keyed transitions from any stage (R2). Each turns tests red (3, 3, 1, 3, 2, 1, 1, 1 and 1 failures), and all pass again once restored.

## The minimal form: Scholar's existing private case (S4)

2 to 5 single-choice steps, a deterministic key, a rationale, no reveals, no dimension. `privateCaseSnapshot` converts individual_scholar_question rows to this, with the step's rationale as the decision `rationale` (B6), and drops `source_quote` and `sourceRefs` (C-b, B8). Both the per-option form below and the one-rationale-per-step form (`S4_STEP_RATIONALE` in the tests) validate as `private`.

```json
{
  "schema": "case-blueprint/1",
  "title": "Breathless after surgery",
  "facts": [], "progression": [], "learningObjectives": [], "safetyCriteria": [], "references": [],
  "stages": [
    { "id": "s1", "title": "Step 1", "reveals": [], "decisionPointIds": ["d1"] },
    { "id": "s2", "title": "Step 2", "reveals": [], "decisionPointIds": ["d2"] }
  ],
  "decisionPoints": [
    { "id": "d1", "stageId": "s1", "kind": "single", "permittedReveals": [],
      "prompt": "A patient is breathless two days after surgery. What do you assess first?",
      "options": [ { "id": "a", "text": "Airway and breathing", "correct": true, "rationale": "Assess A then B first." },
                   { "id": "b", "text": "Wound dressing", "correct": false, "rationale": "Not the priority." } ] },
    { "id": "d2", "stageId": "s2", "kind": "single", "permittedReveals": [],
      "prompt": "Respiratory rate is 30. What next?",
      "options": [ { "id": "a", "text": "Escalate using SBAR", "correct": true, "rationale": "A rate of 30 needs urgent review." },
                   { "id": "b", "text": "Recheck in an hour", "correct": false, "rationale": "Delays care." } ] }
  ],
  "variation": { "rules": [] },
  "aiBoundary": { "patientVoice": false, "phraseReveals": false, "explain": true },
  "metadata": { "level": "foundation", "complexity": 1, "risk": "standard", "professionTermId": null, "specialtyTermIds": [],
    "cfcaDomainIds": [], "cpuIds": [], "provenance": { "kind": "private", "rights": "student_private" } }
}
```

The full library example is `LIBRARY` in `blueprint.test.ts`. It has:
- a patient, a learner intro, and facts with reveals, aliases and a safety-critical finding;
- dimensions, and explicit progression with a consequence;
- a CFCA-linked objective with outcomes;
- a machine-checkable safety criterion and a variation range.

The branching example is `BRANCH`.

## Governance: 395 generalised (migration 422, owner Stage 5 approval s3)

There is no second approval engine.
- `clinical_content_version` gains `content_kind` (`competency` | `case`) and a typed subject: `competency_id` OR `case_version_id`, exactly one, enforced by a CHECK.
- The content hash is chosen by kind: `competency_content_hash` for a competency, and the case version's database-computed hash for a case.
- The existing 395 triggers apply unchanged to both kinds:
  - independence;
  - position and scope (for a case, every CFCA competency it names must be covered);
  - version-exact staleness;
  - append-only decisions;
  - required approvals for higher risk.
- The case library owns only the case content and its own lifecycle: draft, then submitted and in clinical review (via 395), then approved (via 395), then published, then superseded or retired.
- **Publication is a separate act. It requires an approved 395 version whose hash matches the exact case version.**

## The interfaces, revised (IND-004 C-a to C-e and D-a to D-e adopted)

**Capture (C1),** `src/lib/cases/candidates.ts`. No AI call, and nothing is charged to the student.
- `grantCaseCandidacy(admin, { userId, attestation: "own_notes" | "licensed_to_share", attestationVersion })` and `revokeCaseCandidacy(admin, { userId })`.
  - **C-d:** the attestation text version is recorded with the grant. Granting offers nothing on its own.
- `offerPrivateCase(admin, { userId, snapshot: Blueprint })` returns `{ ok, candidateId, status: "eligible" | "ineligible", reasons[] }`.
  - **C-a:** Scholar builds the snapshot with its own `privateCaseSnapshot(admin, userId, caseId)`. Holdings never reads Scholar's tables.
  - **C-b:** no verbatim note text. Scholar supplies the verbatim-overlap check, and Holdings re-runs the patient-identifier screen over every field as a **deterministic eligibility gate**, not an AI verdict.
  - **C-c:** it is called only from an explicit, per-case student action.
  - The snapshot must validate as `private`, and is stored de-identified.
- **C-e:** user_id is kept internally for revocation and erasure only. Revoking, deleting the source material, or erasure withdraws every unpromoted candidate. user_id never reaches an educator surface.

**Delivery (C4),** `src/lib/cases/library.ts`. No AI, no AI-standing check, no charge (D-e).
- `findLibraryCases(admin, { competencyIds?, topic?, context?, level?, excludeVersionIds?, limit? })` (D-d).
  - It works with no competencyIds.
  - It returns ONLY versions that are published AND hold an approved 395 record for that exact version (both, or nothing).
- `loadLibraryCase(admin, versionId, { resumeFor?: userId })` returns `{ versionId, approval: { state, approvedAt }, risk, current: boolean, blueprint }` (D-b).
  - The server keeps the full blueprint and the session state. The browser gets `learnerView(b, state, salt)` and, after each answer, `answeredView()`. Its answers and reveal requests come back as tokens, resolved on the server (B1 to B5).
  - **D-a:** a superseded or retired version is returned, labelled "no longer current", only when that student already has a session on that exact version.
- **D-c:** live AI with a stored case uses `resolveOwner(admin, "case.live_with_stored", "scholar", { userId })` and `runOwnedAi`, with the same request-id derivation (`:verify`, `:retry`) and the same `risk` subject on every call of one action. Replay is `case.replay_stored`: no AI, no charge.

## Production dependencies (not authorised)

- Migrations 410–412, 420, 421 and 422 onward, under their own GO.
- **A legal review of publishing student-derived cases.** The attestations are self-attestations, and student uploads can contain third-party lecture material that a derived case may still carry.
- An appointed, in-scope clinical reviewer.
