# LEARNING-CLOSE-2026-11 Wave 2: CE-04 and CE-05 (SALE-2026-11 SALE-13): build and staging record

**Branch:** `scholar/ce04-05-wave2` · **Date:** 4 Nov 2026 · **Migration:** none (the timeline lives in the blueprint JSON, the debrief is computed, the attempt delete uses the cascades that 435/436/423/810/880 already define).
**Production:** not touched. Every new behaviour is behind an HQ policy key whose code default is OFF.

## What was built

| Row | What | Where |
|---|---|---|
| CE-04C | **Deterioration timeline**, authored in the case blueprint (`timeline`): events at simulated minutes change observations (only observation, examination or result facts) and may reveal a finding; escalation windows name the choices that escalate (and optionally recognise) and the minute by which escalation is expected. Simulated time comes **only from the recorded actions**: each answer (5 min default), each finding asked for (2), each question to the patient (1) and authored extra minutes on a choice (e.g. "recheck in 30 minutes"). No wall clock, no AI. Recognition and timeliness are scored by code: on time / late / missed, half for recognising, half for escalating in time (a quarter if late). | `src/lib/cases/timeline.ts` (pure), `blueprint.ts` (type, validation, `learnerView` minute + trends, `answeredView` escalation), `library.ts` (`sessionSim`, `PlaySim`) |
| CE-04C governance | Authored in Case Studio (structured JSON field with an example), checked by `validateBlueprint` on save and submission, shown to the clinical reviewer in the review content, approved with the exact version (422 content hash). A student's private case (AI-written from notes) **refuses** a timeline, and the private play never runs one. | `TimelineField.tsx`, `CaseEditor.tsx`, `CaseContent.tsx` |
| CE-04C boundary | A learner sees only the current minute, the events already passed and the changed values with their earlier values. A future event, its minute, a window and its closing minute are never in a learner projection before the escalation is answered (its own feedback) or the case ends (debrief). The patient voice speaks from the values **as they are now**, and a reply voicing a value still to come is screened out like any hidden finding. | `conversation.ts`, `case-talk.ts` |
| CE-04B | SBAR handover (#237) verified end to end on staging: four boxes, marked by code against the case's handover rubric (sections written + expected elements, part marks, pass mark), feedback after answering, kept in the 810 attempt with its rubric snapshot. Now also feeds the debrief. | existing `handover.ts`; `debrief.ts` |
| Debrief | **What went well / what was missed / what was unsafe**, built by code from the attempt: decisions and keys, safety criteria broken, handover elements found and missed, findings never asked for, escalation windows (late or missed safety-critical escalation is unsafe), key questions to the patient. Labelled formative: "not an assessment and not evidence of clinical competence". Shown on a finished private or library case and kept in the 810 attempt record. | `src/lib/cases/debrief.ts`, `clinical-play.ts`, `clinical-routes.ts`, `case-integrity.ts`, `case-client.tsx` |
| CE-04A/D | Talk to the patient (#237) verified end to end on staging with the policy on; turns kept per attempt (880) and copied into the 810 record. **New:** the learner can delete one attempt (D05): the session row is deleted by its owner and the database cascades the conversation (880) and the kept record and corrections (810). Library sessions are deleted by `library.ts` (K33: the shared delivery owns that table), private sessions by `store.ts` (A4). Turns are still read only by `store.ts`, `case-talk.ts` and `case-integrity.ts` (ADR-016 D10 exception test unchanged). | `clinical-routes.ts deletePlay`, `library.ts deleteCaseSession`, `store.ts deletePrivateCaseSession`, `DELETE /api/individual/scholar/clinical/sessions/[kind]/[id]` |
| CE-05 | Evolving scenarios (#236) verified on staging with `scholar_revision_formats` including scenario: labelled AI-written practice from the learner's notes, the first view carries no later stage, key or accepted answer, stage 2 appears only after stage 1 is answered (server-controlled HMAC progression). Governance path: an AI-generated scenario stays private, formative practice from the learner's own notes and is never offered to the shared library (`library-format.ts` refuses the scenario format). A clinically **approved** evolving scenario is a library case (staged reveal, branching, timeline) taken through Case Studio and independent clinical review, as the demo case was. | no code change |

## HQ policy keys (all default OFF, in both `policy.ts` and `policy.test.ts` defaults)

- `scholar_case_deterioration`: library cases play their approved timeline.
- `scholar_case_debrief_review`: the three-list debrief.
- `scholar_case_attempt_delete`: learners may delete a case attempt (D05).

Unchanged: `scholar_case_conversation` (off), `scholar_case_conversation_turns` (20), `scholar_revision_formats` (code default excludes scenario). Model eligibility and routing unchanged; no new AI call (the timeline, scoring and debrief are code).

## Staging walk (fixture learner, staging ezhvpgtcqcdsgylrxgdb, dev server on 3182): 25/25 PASS, 0 console errors

`walk-results.txt` and screenshots `01`-`11` in this folder.

1. A synthetic demo case (`CE0405_DEMO`, `src/lib/cases/fixtures.ts`, **not clinically reviewed**) was taken through the real path by `scripts/staging-seed-ce0405-demo.ts --publish`: Case Studio draft by a synthetic educator, publish before approval refused, approval by a different in-scope synthetic reviewer (comment: "staging exercise ... not a clinical approval"), publish by a synthetic publisher, deliverable = true.
2. Play: minute 0 labelled as simulation; nothing ahead in the payload; two questions to the patient answered and labelled simulated; d1 assess; d2 "recheck in 30 minutes" moves the clock to minute 44; events at minutes 10 and 20 listed; respiratory rate 32 with "Earlier: 22 (minute 0), then 28 (minute 10)"; new confusion revealed by the timeline; d2b escalation flagged **"Late escalation ... done at simulated minute 44, LATE (it was needed by minute 15)"**.
3. SBAR handover marked 100% with boxes and points; debrief with the three lists, the late escalation under "What was unsafe", formative label.
4. Mobile 390 px: no horizontal scroll.
5. Before delete: session 1, conversation turns 2, kept attempt 1. "Delete this attempt": session 0, turns 0, kept attempt 0.
6. CE-05: a stored two-stage scenario: labelled, no leak in the first view, stage 2 only after stage 1.

Staging state was recorded before and **restored after**: case_library switch back to OFF, the five policy rows removed (none existed before), the demo case retired, the synthetic staff appointments removed, the walk's library sessions deleted.

## CE-04A activation: what a case author must supply (the gate for production)

The conversation is offered only on a case whose **approved version** has `aiBoundary.patientVoice = true` and a sound `voice`:

1. **Who speaks:** the patient or a caregiver.
2. **Persona** (who they are, up to 600 characters) and **style** (how they speak, up to 400): plain, synthetic, no real person.
3. **What they know:** the facts of the case they can speak about (`knowsFactIds`; they can only say one once the learner has been shown it) and statements they hold from the start or from a stage (`knowsStatements`).
4. **Key questions** a good history asks, with the words that show each was asked (used by code for the debrief).
5. **What they say when they do not know** (`notKnownReply`).
6. Optionally a **deterioration timeline** (CE-04C) and an **SBAR handover** decision (CE-04B).

Then the normal path: Case Studio draft → submit → **independent clinical approval** of that exact version (422) → publish → the owner switches `scholar_case_conversation` on (and, if wanted, `scholar_case_deterioration`, `scholar_case_debrief_review`, `scholar_case_attempt_delete`) → a production walk.

## Tests and gates

- `src/lib/cases/timeline.test.ts` (19): authoring rules, private-case refusal, clock determinism, reveal/turn/option costs, learner-view boundary (no future event, window, value), event reveals at their minute, switch-off parity, on-time / late / missed / pending, the late flag in `answeredView`, the session engine end to end, voice grounding on current values and the future-value screen, the debrief lists and label.
- `scripts/scholar-learning-harness.ts` K33: the two call-shape regexes accept the optional `sim` argument; its plant P51 still turns K33 red. No other harness changed.
- Line endings: existing CRLF files were kept CRLF so the diff stays reviewable; new files are LF.
