# SCHOLAR-SQIE-02 s15 -- end-to-end acceptance on staging, 30 Oct 2026

Harness: `scripts/scholar-sqie-acceptance-harness.ts` (pyelonephritis; A-E, Z). Staging `ezhvpgtcqcdsgylrxgdb` only.
Server: staging dev server on :3100 started from competen-p2 (`sqie-e2e` = 77d6590d + harness), interim legal set
`draft-2026-10-23`. Canonical run (run 5, note exactly as specified): 21 passed, 13 failed, 1 pending. AI spend $0.00
(no AI call was eligible to run). Earlier runs 1-4 were environment blocks (wrong checkout; no legal set).

## Results (canonical run)

| | Result | Evidence |
|---|---|---|
| A1 study as paper | PASS | 200 `notesLike: true`, 0 paper rows, 0 question rows |
| A2-A6 generation, feedback, paper check | FAIL (D-1) | revision 404 and paper "Check my attempt" 503 `not_eligible`: "AI help isn't available for this yet..." |
| A5 models | FAIL | no AI call ran; refusals were `not_eligible` (the harness's first A5b missed HTTP refusals -- fixed) |
| B1 Learn on thin note | PASS (vacuous) | nothing shown, but because Ask was refused (D-2), not because of a grounding withhold |
| B2 paper, unsupported | PASS | `withheld: no_evidence`, attempt returned, no content, no AI call |
| B3 recovery | FAIL (D-3, D-4) | paper key terms `["question","1",...]`; Learn notes_only recovery took the student's own paper as "notes" and said `sufficient` |
| C0 setup | PASS | pubmed/openalex/crossref Active via lifecycle, Basic workflow operational, recovery external=offer |
| C1 references | PASS | 5 refs, all PMID/DOI re-verified at PubMed/Crossref, all "abstract only", none full text, 0 AI calls |
| C2 explain | FAIL (D-2) | Ask with recovery refused before any call (continuity "AI help isn't available") |
| D1 real patient | FAIL (D-5; confounded by D-1) | refused, nothing clinical answered, but generic "not available yet, try again later" wording, not supportive |
| D2 identifier | PASS | 422 "That looks like it identifies a patient" in Learn and Personal AI, 0 AI rows |
| D3 educational case | FAIL (D-1/D-2) | refused, not answered |
| E cost | PASS (trivially) | $0.00 total; 3 recoveries, 0 AI rows, 6 research rows ($0) |
| Z restore | PASS | 7 config paths removed (none existed before), engine not operational, fixtures gone |

## Defects (evidence)

- **D-1 (risk rules, published config).** The specified lecture note is classified `high_risk_clinical` by
  `high.urgent-direction` ("What to do now, in a clinical situation"): its term groups match ACROSS the whole text --
  "urgent*" (line 7, "Escalate urgently if there are signs of sepsis") AND "patient*" (line 5, "if the patient is
  unwell"). No model is eligible at that tier, so every AI action on this note (questions, deeper, ask, teach) is
  refused `not_eligible`. Rule match has no proximity/sentence scope (`src/lib/ai/clinical-risk.ts` ruleMatches over
  `subjectText`), and the gate classifies the passages sent, so ordinary teaching notes trip it.
- **D-2 (routing config).** `ai.model_routing` has no `scholar.ask` entry, so Ask falls to the legacy reasoning tier
  (Sonnet 4.6), which is not eligible for `ask` (only Opus 4.8 is). Result (`activityReadiness`): ask has no route at
  clinical_educational. Ask Scholar on any clinical subject, and "Explain using approved references" from Ask, is refused.
- **D-3 (recovery).** For a paper question the recovery's key terms include the numbering ("question", "1"), so a
  recovery can never be `sufficient`/cover them (`paperQuestionForRecovery` text into the keyword step).
- **D-4 (recovery).** Outside the paper route, recovery searches all the learner's materials including a prepared exam
  paper: the paper's own wording of the question was returned as "Your notes" evidence and judged `sufficient`,
  `canExplain: true` (state still `unanswered`, an inconsistent pair). Circular evidence.
- **D-5 (wording).** A real-patient refusal under the default Scholar mode returns the generic availability text
  ("isn't available for this yet ... try AI help again later"), not `SUPPORTIVE_REFUSAL` (which only modes with
  `educationalBoundary` use, `src/lib/ai/allowance.ts` gateCore). It invites retrying a patient-care question.
- **Observation (C1).** An OpenAlex "Acute Pyelonephritis management through Ayurveda - A Case Study" was accepted as
  grounding evidence (`evidence: true`) alongside clinical reviews; and one IDSA asymptomatic-bacteriuria guideline.

## Staging changes (all restored in Z, verified exactly by Z1)

`platform/individual`: scholar_short_answer_marking=ai_then_self, scholar_recovery_external=offer,
scholar_recovery_providers=pubmed,openalex,crossref, scholar_learn_source_modes=notes,library,research.
`platform/research`: registry (3 sources Active with recorded checks), workflows (basic Active), published. None of these
had an override before; Z removed them. History rows (versions/audit), plat_ai_outcomes and plat_research_requests rows
(codes and counts only) remain by design.

## Workaround run

`SQIE_NOTE_WORKAROUND=1` changes "Escalate urgently" -> "promptly" and "if the patient is unwell" -> "if unwell" to get
past D-1 and exercise generation, five-part feedback, the paper check and routing. Its results are recorded separately
(run 6); they do not replace the canonical verdict above.
