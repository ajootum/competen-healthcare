# The shared clinical case blueprint, `case-blueprint/1`, and the case interfaces: FOR AGREEMENT

**Status:** proposed by IND-007 for IND-004's review (Stage 5 case interface approval s2). Nothing is built on it until it is agreed. The contract is the type and validator in `src/lib/cases/blueprint.ts`, with its tests in `blueprint.test.ts` (8/8).

## One structure, two profiles

- **One blueprint** for a student's private AI-generated case, an educator-authored case, and a governed library case.
- **The profiles** differ only in what a case must carry, never in shape:
  - `private` is the minimal form;
  - `library` adds the patient, CFCA-linked objectives, a debrief and the rights it rests on.
- **Clinical approval is not inside the blueprint.** It is a fact of the governance record about ONE exact version (`clinical_content_version`, kind `case`, migration 422).

| Part | Holds | Governed (approved with the version) |
|---|---|---|
| `facts[]` | Every finding and its value: id, kind, label, value, unit, `revealedAt` ("start" or a stage), `safetyCritical` | yes |
| `stages[]` | Ordered stages: title, the facts each reveals automatically, its decision points, an optional `narrativeHint` | yes (the hint is guidance for AI phrasing, not a fact) |
| `decisionPoints[]` | Prompt; kind `single`, `multiple` or `free_text`; options each with the deterministic key `correct` and an approved `rationale`; `permittedReveals` (facts the learner may ask for at THIS point); `expectedResponse` and `rubric` for free text | yes |
| `progression[]` | Deterministic transitions: from a stage, on options (or the one default), to a stage, revealing `consequenceFactIds`. Empty means the stages run in order | yes |
| `learningObjectives[]` | Text, plus the CFCA competency ids each serves (the original identifiers) | yes |
| `safetyCriteria[]` | Machine-checkable: a decision point plus `mustSelect` and/or `mustNotSelect` option ids | yes |
| `feedback`, `assessment` | Debrief, the safety-event message, the rubric and pass mark | yes |
| `variation.rules[]` | Which non-safety-critical facts may vary, and to what values or range | yes (the boundaries) |
| `aiBoundary` | What AI may do around the facts: `patientVoice`, `phraseReveals`, `explain` | yes |
| `metadata` | Level, complexity 1–5, risk, profession, specialties (several: one case, no copies across specialties), CFCA domains and CPUs, and provenance (kind, candidate, parent version, rights, attestation version) | yes |

## IND-004's review, adopted

- **Governed facts are kept apart from AI narrative.** AI never invents a finding, a value or a consequence. Progression is `nextStage()`, deterministic.
- **Reveals are permitted per decision point** (`permittedReveals`), in addition to stage reveals.
- **Safety-critical criteria are machine-checkable.** `safetyEvents()` decides from the answer, never an AI judgement.
- **Expected responses stay server-side.** `learnerView()` is the only projection a browser receives. It carries no key, no rationale before answering, no expected response, no rubric, no consequence, no safety flag, and no unrevealed fact. A test plants all of these and proves none leaks.
- **One structure for private and library cases,** including Scholar's existing S4 cases as they are (below), with no data migration.
- **A variation inside the rules is still the approved version** (`variationWithinBounds`). A safety-critical fact never varies. Anything else is a new version, with renewed approval.

## The minimal form: Scholar's existing private case (S4)

2 to 5 single-choice steps, a deterministic key, a rationale, no reveals. `privateCaseSnapshot` converts individual_scholar_question rows to this and drops `source_quote` (C-b).

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

The full library example (patient, facts with reveals and a safety-critical finding, explicit progression with a consequence, a CFCA-linked objective, a machine-checkable safety criterion, a variation range) is `LIBRARY` in `blueprint.test.ts`.

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
  - The server keeps the full blueprint, and the browser gets `learnerView()`.
  - **D-a:** a superseded or retired version is returned, labelled "no longer current", only when that student already has a session on that exact version.
- **D-c:** live AI with a stored case uses `resolveOwner(admin, "case.live_with_stored", "scholar", { userId })` and `runOwnedAi`, with the same request-id derivation (`:verify`, `:retry`) and the same `risk` subject on every call of one action. Replay is `case.replay_stored`: no AI, no charge.

## Production dependencies (not authorised)

- Migrations 410–412, 420, 421 and 422 onward, under their own GO.
- **A legal review of publishing student-derived cases.** The attestations are self-attestations, and student uploads can contain third-party lecture material that a derived case may still carry.
- An appointed, in-scope clinical reviewer.
