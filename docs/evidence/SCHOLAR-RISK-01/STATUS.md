# SCHOLAR-RISK-01 — education-first, risk-sensitive classification for Scholar AI

Owner GO: 31 Oct 2026, binding. Branch: `scholar/education-first-risk-01`, based on main `b98abbc5`. No PR has been opened.

## Root cause (production, read only)

The request "Differentiate between nephrotic syndrome and nephritic syndrome" came through Scholar Personal AI,
activity `teach`, in Strict Production. No rule recognised it: "differentiate" is not a study verb in the
published rules, and renal, nephr and syndrome are not topic terms. The request therefore became
`unknown:no_rule`, which is treated as high-risk clinical. The only model eligible for `teach` covers up to clinical
educational, so the request was refused with `SUPPORTIVE_REFUSAL`. That message speaks about a real patient,
giving medicines and urgency, none of which applied.

## Design

The layers are, in order:

1. **Keyword rules (unchanged engine).** They say what a request is *about* and remain supporting signals
   (`clinical-risk.ts classifyRisk`).
2. **Intent layer (new, deterministic, no model call).** Implemented in `src/lib/ai/request-intent.ts`
   `intentFeatures`. It reads only the learner's own request words (`requestText`), never the study material:
   - **Real-patient evidence** puts the request in category 4 and wins over everything else. It covers:
     - "my/our patient, ward, shift", "I'm caring for / looking after"
     - bed or bay numbers
     - identifiers (10-digit numbers, hospital/MRN/NHS numbers, a date of birth with a date)
     - "right now", "at the moment" or "just now" together with an action or deterioration
     - a definite person deteriorating, unless the text is a simulated case
     - an urgent first-person "what do I do"
     - a cry for help or being alone with someone unwell
     - a family member who is unwell or being given medicine
     - first-person giving to a named person ("Mrs …") or to "him/her"
     - personal-safety phrases
   - **Administration**, first person ("should I give", "how much should I give", "is it safe to give") or the
     ambiguous config rule `high.administration-now`.
   - **Study framing** (study verbs, including differentiate, compare, distinguish, classify and calculate, plus
     exam, OSCE, "for my studies") and **case framing** (case study, scenario, OSCE, hypothetical, "in a patient
     with", "a 70-year-old", "if a patient …").
3. **The categories**, in `operating-mode.ts` `decideIntent`, which runs first in `decideRisk` whenever the
   policy turns the layer on:
   - **4, real-patient clinical decision support.** Triggered by real-patient evidence or by any high-risk rule
     that is not listed as ambiguous. The verdict is `restricted`, which is refused **before routing** with error
     `clinical_restricted` (HTTP 422). This holds whatever model would be eligible. Note that production
     `case_steps` has a model eligible for high-risk clinical. Neither a confirmed purpose nor "for my
     studies" lowers category 4.
   - **3, ambiguous.** Covers giving, or a named person, without study framing, and unrecognised requests
     without a question form. The learner gets the clarify question in **every mode**, Strict Production
     included, when `clarifyAmbiguous` is set. With `purpose=education` the request runs as clinical
     educational.
   - **2, clinical educational.** The same requests inside framing, or anything the rules recognise.
   - **1, general educational.** Requests the rules recognise as standard.
   - An activity whose own floor is high (`case_steps`) is unchanged, except that real-patient evidence in the
     learner's request now restricts it.
4. **No-code policy fields** on the risk section, handled by `clinical-risk.ts` `resolveIntent`:
   - `unknownHandling`: `high_risk` (the default), `clarify` or `educational_if_study_intent`.
   - `clarifyAmbiguous`.
   - `ambiguousRules`. The engine drops any rule that is not high risk and any real-patient, emergency,
     identifiable or safety rule.
   - `educationalSafeguards`, which adds `EDUCATIONAL_BOUNDARY` to every clinical answer in any mode.
   - A per-rule `refusal` kind.

   These are editable on HQ → AI → Fair use (the "Education-first handling" box and a per-rule "A refusal by
   this rule says" field). `settingsFor` keeps them when a draft is saved. With the defaults, other products
   are byte-for-byte unchanged, and a test checks this.
5. **Honest refusals.** Implemented in `operating-mode.ts` (`REFUSAL` and `refusalFor`):
   - Each reason has its own words: real patient, administration, emergency (use your local emergency
     procedure), personal safety (crisis support), identifiable (remove the identifiers), high-risk content,
     and unrecognised. Every message gives a safe way to continue learning.
   - `notEligibleMessage` now uses the words for the actual reason when the request is high risk. Below high
     risk it gives the availability reason in every mode.
   - Unrecognised requests never cite a real patient.
   - The clarify question uses the owner's wording.
6. **Clarify once.**
   - `learn-client.tsx` (act, lesson open and the shared assistant) and `AssistantPanel.tsx` (Personal AI)
     keep `purpose=education` after the learner answers "It's for my studies".
   - Choosing "a patient I'm caring for", or starting a new Learn session, ends it.
   - The server honours the purpose only for category 3.
   - Entry points checked: `/api/individual/scholar/learn/act`, `/api/individual/scholar/learn/assistant` and
     `/api/individual/assistant` (Scholar). All of them already render `ClarifyPurpose` and pass `purposeFrom`.
     The engine change applies to all of them through `gateCore` and `runMeteredAi`.
7. **Research filter.** `withinRequestRisk` now compares research text against the tier the request was
   *served* at (`servedTier`), not the raw rule tier.

The following are unchanged: model eligibility (`ai_reserve` and `clinicalGate`), activity floors, the
audit log (`ai_gate_decision`, now also written for `clinical_restricted`; it records tier and rule and never
the text), the modes document, Professional, metering and quota.

## Decisions

- **No AI classifier.** Deterministic features were enough for the validation set and the held-out probes.
  Adding one would mean an extra metered call and a new failure mode.
- **Real-patient signals are code, not config.** A policy edit can turn the layer on but can never weaken
  those signals. Config rules can only add caution.
- **Explicit simulation framing** ("OSCE scenario: he is not breathing, what do I do?") counts as OSCE
  preparation (category 2) when the only evidence is a definite person deteriorating. "My patient", a bed
  number, "right now", identifiers, a named person given medicine, a cry for help and being alone all still
  restrict. This applies to 2 of the 60 high-risk items when they are wrapped in "OSCE scenario:" or
  "Hypothetically, in a case study,". The test names them. "For my studies" or "for my exam" never lowers any
  of the 60.
- **`high.real-patient` "this patient" is kept** (conservative). A case question phrased as "this patient" is
  still refused as a real patient. Rephrasing it as "the patient in this case" works.
- **`high.personal-safety` is kept as is.** "Explain suicide risk assessment" is still refused, with the
  safety words.

## Results (vitest `src/lib/ai/scholar-risk01.test.ts`, Strict Production, proposed policy)

| Set | Result | Production policy today |
|---|---|---|
| Educational (134) answered, categories 1-2 | **134 / 134 = 100%** (threshold 98%) | 128 / 134 = 95.5% |
| Explicit high-risk (60) permitted, with or without purpose=education | **0** | 10 answered |
| Ambiguous (33) clarified, then answered once confirmed | **33 / 33**, then 33 / 33 | n/a (refused or answered) |
| Held-out probes (40), written after the classifier | **40 / 40** | |
| Same 60 high-risk items wrapped in "For my studies:", "For my exam, explain:" or "I'm revising," | 0 permitted | |

Staging (`ezhvpgtcqcdsgylrxgdb`):
- The proposed section was drafted by actor `45ddd5f4…` and published by `804ee8e5…` (a different person,
  640) at 31 Oct 17:23 UTC, using `scripts/apply-scholar-risk01.ts --staging --publish`.
- Read back, the published document resolves to the intended intent settings.
- Running the validation set against it gives the same numbers (134/134, 0/60, 33/33).
- **Not done:** a live HTTP walk on the staging app. That needs the app from this branch to be deployed to
  staging.

Checks:
- `ai-fair-use-harness` is ALL GREEN, 71 checks. A19 was updated to the new wording helper; A20 was added
  (restricted before routing on both paths), with 2 planted violations that go red.
- `scholar-learning-harness` is ALL GREEN, 163 checks.
- vitest for `src/lib/ai`, `src/lib/individual` and `src/app` passes, 1686 tests (before the HQ test was
  added).
- tsc and eslint are clean on the changed files.

## Remaining safety limitations

- These are keyword and regex features. A determined user can still disguise a real patient by writing it as
  a case with no first-person, bed, time or identifier cues. The answer is then educational, carries the
  educational boundary, and contains no patient-specific instruction.
- The validation set and the classifier were written by the same author. The held-out probes reduce this
  risk but do not remove it. Monitor `ai_gate_decision` (decision, rule, `intent:*`) after release.
- The features are English only.
- Category 3 uses the learner's own confirmation. The boundary prompt is the safeguard for anything answered
  after "for my studies".
- The client keeps "clarify once" in memory per page and Learn session. A reload asks again, which is the
  safer direction.

## Owner actions

1. Review and merge the branch, then deploy the app.
2. **After** the deploy, draft `RELEASE-2026-10-25/SCHOLAR-RISK/proposed-scholar-risk.json`, using the HQ
   page or the draft-only `draft-scholar-risk.sql`. A different person then publishes it on HQ → AI → Fair
   use.
3. Do not publish before the deploy. The current app ignores the intent keys and would only get the widened
   and loosened rules.
