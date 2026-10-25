# COMPETEN-PROFESSIONAL-COMPETENCY-01: Professional Stage 5, Competencies, Evidence & Verification (build record, C1–C4, C6, S9–S12)

- **Authority:** owner GO "COMPETEN-PROFESSIONAL-COMPETENCY-01, Stage 5". It authorises development and staging only. Production deployment, migrations, clinical verification activation and assessor appointments each need a separate owner GO.
- **Split:**
  - This branch builds C1–C4, C6 and the Professional, Scholar and Passport integration.
  - C5 (the Verification Studio, assessor authority, and the request/decision/expiry records) belongs to COMPETEN-IND-007, migrations 510–519.
- **Branch:** `prof/competency-01-stage5`, cut from `origin/main` 365062ba.
- **Migration:** 520, staging only.

## 1. Reused, not rebuilt

| Existing | Used for |
|---|---|
| CFCA catalogues through the Professional allowlist (`loadCatalogueFor`, 384/394/395) | C1 exploration and entries: domain, competency and learning outcomes, the expected level, and the content status. Unapproved content is labelled. |
| `scoring_scales` / `scoring_levels` (007, 384 `expected_level_id`) | C2 levels. The scale of the expected level is used, else the default scale. No scale is hard-coded. |
| 373 `individual_professional_evidence` | C3 additional evidence: observations, feedback, teaching, research, QI and assessments are typed in the **same** record (520 adds the type and author). |
| 373 CPD, 462 `learning_record`, 450 profile items, 470 reflections, 375 Scholar Passport items | The portfolio is a **view** of these. A link names the record by composite key and never copies it. |
| 470 needs and 480 plan (`createNeed`, `linkCompetency`, `createGoal`, `linkPlanCompetency`) | S9: a need or goal from a competency, written by those stages' own writers. |
| 453/491 per-link share pattern, `/verify` | S11: the competencies, and which parts of them, one Passport link carries. |
| Holdings Personal AI via `askProfessionalAssistant` | S12: AI help. The gateway is unchanged. |
| WCE Individual policy (CONFIG-002) | 9 new policies. |
| 393 competency mapping | Stays as the competency-level link from goals, CPD and evidence. 520 adds outcome-level links with versions and relations, which 393 does not have. |

## 2. Delivered

| | |
|---|---|
| C1 | **My competencies**, a new Professional module (`competencies`). Competencies come from any offered catalogue, not only the person's current role, or are written in the person's own words when no catalogue is offered. Entries are grouped by layer or by a configured group, can be marked as development interests, and can be removed and brought back with history. An **Explore** view shows outcomes and expected proficiency, labelled when the content is not clinically approved. |
| C2 | **Self-assessment.** A level from the CFCA scale, optionally for one learning outcome, with confidence (words), an optional private reflection and a development interest. **Self-reported by construction** (a 520 CHECK) and append-only: a reassessment is a new row. It is never reduced or rejected for want of evidence; neither the parser nor the route reads evidence. |
| C3 | **Evidence portfolio.** CPD, Competen Learning, evidence and credentials, profile records, reflections (private, never shared), and Scholar study the person chose for their Passport. Each keeps its own class. Additional supporting evidence is added to the existing evidence record, typed. Nothing is duplicated. |
| C4 | **Outcome-level mapping**, many to many: one record can serve several outcomes, and one outcome can have several records. Each link keeps the framework version and a relation (knowledge, application, practical performance, experience, verification, all configurable). It records who established it: the person, or an AI suggestion the person accepted, with model and prompt. A link is unlinked once and never rewritten or deleted. Deterministic suggestions match shared words. |
| C6 | **History** on each competency, combining: entry history (trigger), every self-assessment, links made and unlinked, and C5 requests and decisions as read from the Studio. Framework versions are kept on every row. |
| S9 | A need or a goal can be created from a competency. A plan is never required before self-assessment or mapping. |
| S10 | Scholar study enters only through the student's own Passport selection (375). It is labelled "Educational, formative (not a verified competency)" and is never converted into competence. |
| S11 | The share page offers, per competency, the self-assessment (labelled self-reported), the evidence (never reflections) and the assessed outcomes (C5, current only). `/verify` shows them as separate, labelled parts. |
| S12 | AI can explain a competency, offer reflection questions, suggest mappings (added only on the person's click) and summarise evidence. AI never verifies. Only the competency, its outcomes and the titles of shareable records are sent. |

**The four never merge.** On every surface, expected, self-assessed (self-reported), evidence (not verification) and independently verified (C5 only) are separate panels.

## 3. The C5 interface (proposed to IND-007; awaiting their acknowledgement)

- **Professional hands over.** `competency-store.evidenceForVerification` returns a `CompetencyRef` (framework, competency, version, outcomes) and `EvidenceRef[]` (cpd, learning record, evidence, profile item or study, each with its own class). It covers **catalogue entries only, and never a reflection**.
- **Professional reads back.** `competency-verification.ts` is an adapter to the Studio's `requestVerification` and `listVerifications`. Until the Studio registers itself, it answers "not provisioned". The page then says verification is not available yet, rather than showing an empty "never verified".
- **Professional writes no request, assessor, decision or expiry.** The harness pins this (V1).

## 4. Configuration (no code, WCE)

| Setting | Kind |
|---|---|
| Competency groups | options |
| Personal competencies allowed | choice |
| Self-assessment template, in order | sequence |
| Confidence words | options |
| Reassessment suggestion | int, 30–730 days, default 180 |
| Evidence classifications | options |
| Mapping relationships | options |
| What may be shared on a Passport link | set |
| AI help | choice |

Proficiency scales are the CFCA scales themselves. Verification methods, rubrics, assessor scopes, workflows, outcomes and validity are C5's.

## 5. Migration 520 (staging only)

**File:** `supabase/migrations/520-individual-professional-competency-portfolio.sql`, **APPLY WHOLE**.

**sha256 (LF):** `f3f5aa882cb569cc6b05e374bd33ea1c71d2548adba498eabeb37156e6b5fa9d`

**Depends on:** 373, 393, 450, 453, 462, 470, 375, 007 and 003. Independent of C5 (510–519), 480 and 490/491.

**Evidence files** (`docs/evidence/COMPETEN-PROFESSIONAL-COMPETENCY-01/`):

| File | sha256 |
|---|---|
| ROLLBACK | `cf155b98…22b1` |
| VERIFY | `6b26af05…ca8d` |
| FINGERPRINT | `5fa86f2e…33dd` |
| staging record | `520-staging-record.md` |

**Local rehearsal** (postgres:17):
- Applied twice: idempotent.
- 37 probes, all as designed.
- Rollback returned to the PRE fingerprint, and the re-apply matched.

**Staging** (coordinating session, guarded runner, file applied whole):

| Step | FINGERPRINT-520 | Items |
|---|---|---|
| PRE | `1a0462b37ca29b530a15e2aa20869f35` | 698 |
| Apply #1 = apply #2 | `c1a53e8334763b155f660047fab6089e` | 822 |
| Rollback | = PRE | |
| Re-apply | = apply #1 (**current staging state**) | |

**VERIFY-520,** after apply #2 and again after the re-apply:

| Section | Result |
|---|---|
| §1 | 3 |
| §2 | five tables, each t\|1\|1 |
| §3 | four triggers |
| §4 | three functions |
| §5 | 0 |
| §6 | t |
| §7 | the Scholar index |

**Production:** not applied. Production only on separate owner GO.

## 6. Verification

| Check | Result |
|---|---|
| `tsc`, eslint | clean |
| vitest `src/lib/individual` | 536 / 536 (new `competency.test.ts`; nav and policy defaults extended) |
| `professional-competency-harness` (new, in the CI list) | **34 / 34**, including 19 planted reds |
| `individual-professional-harness` | 100 / 100. W1 went red on the new writes, which were then pinned. |
| `professional-needs`, `professional-plan`, `professional-profile`, `individual-config`, `individual-foundation` | all green |
| **Staging journey, GO §15 items 1–16** (`professional-competency-acceptance-harness`) | **17 / 17**, including cleanup. Three planted product defects turned items 5 and 16 red: confidence dropped, reflections let onto a link, and reflection text in the portfolio. The source was restored and the journey was green again. |

## 7. Bounded follow-ups

- **C5 wiring.** Done, see section 8.
- **393 versus 520.** Competency-level links (393) on goals, CPD and evidence remain. The Progress page still counts them. Folding them into outcome-level links would be a separate decision.
- **Study evidence.** Study evidence exists only for achievements the student put on their Passport. Other Scholar records need a governed consent read and are not built.

## 8. C5 wiring (after the Studio, #128)

**Branch:** `prof/c5-adapter-wiring`, cut from `origin/main` 20ace7a1. No migration.

**What changed:**
- **The adapter** (`competency-verification.ts`) now reaches the Studio through `src/lib/competency/verification.ts`. It takes its labels from the Studio's pure config. It uses the person-side functions only: list, request, methods, further evidence and withdraw.
- **Decisions** carry `outcomeClass` and `standing`. "Independently verified" is `verifiedNow`: current, of class verified, at a level. The per-method outcome code is never read.
- **A request** carries the method the person chose from those C5 offers, or the only one when one is offered. Before this, the Studio refused every request, because none named a method.
- **Further evidence** sends only the links the request does not already hold. C5 adds whatever it is handed. It is accepted only on the person's own request.
- **Withdrawal** is recorded by C5 as an event. Nothing is deleted.
- **The competency page** shows:
  - the method choice;
  - the request state;
  - each decision's standing;
  - the one-assessment sentence;
  - Withdraw, and "Send newly linked evidence".

**Verification:**

| Check | Result |
|---|---|
| `professional-competency-harness` | V2 added, with 4 planted reds |
| `individual-professional-harness` | E6 admits the adapter only while it touches no table, with a plant |
| vitest | the mapping is pinned; a plant turned it red |
| **Staging journey** (`professional-c5-wiring-acceptance-harness`, over HTTP) | **8 / 8** |

The staging journey checks:
- methods offered;
- the request, read back;
- the page;
- further evidence sent once;
- another person's request refused;
- withdrawal;
- a revoked verified decision never current.

A planted resend turned W3 red. The synthetic identity was deleted with its requests.

Items 17–22 themselves were accepted by IND-007 (`c5-staging-acceptance-record.md`). A new assessor decision needs fresh owner appointments and is not repeated here.
