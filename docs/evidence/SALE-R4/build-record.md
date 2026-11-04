# SALE-2026-11 R4 — Application (SALE-13, SALE-14): build record

**Branch:** `scholar/sale-r4-application` from `origin/main` `ab25a09e` (#278). **No migration.** No production write. No new table, engine, question bank, competency catalogue, learner profile or AI routing.

## Path map (targeted delta read, 4 Nov 2026)

| Need | Existing record reused | Gap closed here |
|---|---|---|
| Case outcomes | 810 `individual_scholar_case_attempt_snapshot` (one kept record per completed case: decisions with their reasoning `dimension`, `kind` handover, `safety`, marking; CE-04C `simulation.escalations`) + 810 corrections | Read into application evidence by skill; corrections applied (latest wins) |
| Case competencies | private: 435 `individual_scholar_case_competency`; library: `case_library_version_competency`, read by the case library module (`libraryVersionCompetencies`, ids only) | Linked per record, with the objective that names the competency |
| Framework version + mapping status | 990/991 `competencyProvenance` (`store.ts`), same shape as attempt snapshots | Kept on the 810 record at completion (`record.competencies`, jsonb, no schema change) when `scholar_application_evidence` is on; older records read "as it is now … not recorded when this was done" |
| OSCE | 720 `individual_scholar_osce_attempt` (finished, score, marking) + station `competency_id` | Practical-simulation record |
| Question evidence | 791/990/991 `individual_scholar_attempt_snapshot.competency_provenance` + corrections | SALE-14 learning-evidence rows |
| Learning state | R1 `learning-state.ts` A1 "Applying it" already counted OSCE | Adds `case` source for cases made from the learner's notes (additive: one union member, one word, one filter term) |
| Self-assessment | Checklist Studio S3 `loadSelfSide` / overview rows | Shown as view 1 only |
| Verified competence | Passport verifications (`verificationFacts` → overview `verification`) | Shown as view 3 only; nothing else can reach it |

## Skill mapping (transparent, from what the case author declared)
`decision`→clinical reasoning · `interpretation`→interpreting findings · `prioritisation`→prioritisation · `reassessment`→reassessing an evolving patient · `recognition`/`escalation` and every CE-04C escalation window→recognising and escalating deterioration · `kind: handover`→structured handover · no dimension→clinical reasoning · OSCE→practical simulation. A decision that broke a safety criterion counts "not yet". Evidence words reuse R1's rule: one activity is not enough evidence; the same case twice is one activity.

## Policy keys (HQ, code default OFF; `policy.test.ts` expected defaults updated)
- `scholar_application_evidence` — Progress "Applying what you learned"; cases from notes count in the learning state; a completed case keeps its competency provenance.
- `scholar_competency_evidence_views` — My Competencies three views.
Patient voice (`scholar_case_conversation`), deterioration (`scholar_case_deterioration`) and debrief (`scholar_case_debrief_review`) keep their own switches; not touched.

## Guards
- Stage guard tests (`application-evidence.test.ts`): 40 perfect formative answers + a case + an OSCE run leave the verified view exactly as the verification source gave it, and no stage word appears; a static check that the R4 modules contain no write call and no stage / progression / verification / Passport reference (proved able to fail: a planted `asmt_stage_decision` insert turned it red, then restored).
- Draft mappings are labelled on every row ("Draft mapping, publication pending: not validated competency evidence") and counted apart.
- Each profession's framework stays its own: a record links only to the competency ids its case, station or question named.
