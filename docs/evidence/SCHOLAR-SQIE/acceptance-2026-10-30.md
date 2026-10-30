# SCHOLAR-SQIE-02 s15 -- end-to-end acceptance on staging, 30 Oct 2026

Harness: `scripts/scholar-sqie-acceptance-harness.ts` (pyelonephritis; A-E, Z). Staging `ezhvpgtcqcdsgylrxgdb` only.
Server: staging dev server on :3100 started from competen-p2 (`sqie-e2e` = 77d6590d + harness), interim legal set
`draft-2026-10-23`. Canonical run (run 5, note exactly as specified): 21 passed, 13 failed, 1 pending. AI spend $0.00
(no AI call was eligible to run). Earlier runs 1-4 were environment blocks (wrong checkout; no legal set).

## Run 7 -- after the SQIE fixes (current verdict)

Server: staging dev server on :3100 from competen-p2 `sqie-e2e` with `scholar/sqie-fixes-01` merged (790120c4:
request-scoped risk rules, key terms, recovery consistency, supportive refusal, revision formats). Note exactly as
specified (`SQIE_NOTE_WORKAROUND` off). Log: `run7.log` (session scratchpad).

**41 passed, 4 failed. All four failures are HARNESS defects, corrected in SCHOLAR-SQIE-CLOSE-01 P3; none is a product
defect.** The product behaved correctly in each, on the evidence the run itself printed:

| Check | Run 7 | Why it was the harness | Correction |
|---|---|---|---|
| A-risk | FAIL `high_risk_clinical` by `high.urgent-direction` | It classified the WHOLE note as one text with no request, so request-scoped rules (acting now) read the note. The product never sends that: it sends the note's passages as context and the learner's words as `requestText`. Every AI step on this note then ran (A2-A6 passed), which is impossible at high-risk clinical. | Classify as the product does: stored passages + a study request through the real `scholarRisk` and `resolveRiskSubject`, at the `questions` floor; expect `clinical_educational`. |
| A4c | FAIL | The suggestion "Revise the investigations required before starting antibiotics, including urine dipstick and midstream urine culture" targets the named misconception "states no tests are needed (urine dipstick, midstream urine culture ...)". The check only looked at `missing` and the rubric. | Pass when the next suggestion shares a content word with ANY named gap: missing, misconceptions or rubric key points (generic words excluded). |
| A5a | FAIL (5 of 6 steps "not eligible") | It read the activity from `plat_ai_outcomes.activity`, which is the operation label (`revision_short`, `mcq`, `exam_answer`), not the allowance activity code (`questions`, `deeper`), so no eligibility row could match. The models were the eligible ones (Opus 4.8 for questions and deeper, Sonnet 4.6 for evaluate). | Read the activity and model from the gateway's request records: `ai_usage_ledger` (activity, model per reserved request, when metering is on), else `plat_ai_requests` (model per call) with the activity its route passes to `scholarAiRunner` (`EXAM_ACTIVITY` for papers). Check against `ai_model_eligibility`. |
| A5c | FAIL (questions and deeper "empty") | Same misread labels, so no step had activity `questions` or `deeper`. | Same source; each step's model must be a route the gate picks for its activity (`activityReadiness`: published routing, keyed providers, eligibility), with questions, evaluate and deeper all exercised. |

Everything else passed, including A1 (numbered notes answer notes-like, nothing kept), A2a-d (genuine, supported
questions with rubrics), A3a-d (five-part AI feedback naming the cystitis / fluids-only misconception, nothing
invented), A4a-b, A5b (no eligibility refusal), A6a-b (paper "Check my attempt" from the notes, on Opus), B1-B3e, C0-C2,
D1a-D3b (supportive refusal of the real-patient question, identifier refused, educational case answered) and Z1-Z3.

**Cost (E).** Total AI spend for the run **$0.1314** (10 calls). Per completed revision session **about $0.10**:
scenario A $0.0979 in 6 calls -- the session's generation and verification (4 calls, Opus 4.8) plus the AI evaluation of
the mistaken answer (Sonnet 4.6) $0.0750, and the paper "Check my attempt" (Opus 4.8) $0.0229. Retrieval-only recovery:
3 runs, 0 AI requests, $0 (2 research rows, cached). "Explain using approved references": $0.0145.

The corrected harness has not been re-run (no server run under this change). Its next run is the confirmation.

## Results (run 5, before the fixes)

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
