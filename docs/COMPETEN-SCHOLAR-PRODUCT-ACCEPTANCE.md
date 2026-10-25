# Competen Scholar: integrated product acceptance summary (Stages 1–8)

IND-004, 2026-10-25. Owner instruction, "COMPETEN SCHOLAR — STAGE 8 ACCEPTANCE AND CLOSURE": one concise summary from the
existing Stage 1–8 evidence, with **no stage re-run and no new verification cycle**. It reports only the genuine
remaining pilot blockers and the minimum activation dependencies. Each stage's detail stays in its build record.
Stages follow the canonical eight-stage architecture (`docs/COMPETEN-SCHOLAR-PRODUCT-ARCHITECTURE.md`).

## 1. The eight stages, as accepted

| # | Stage | Build record | Staging acceptance (recorded) | State |
|---|---|---|---|---|
| 1 | Join | `COMPETEN-SCHOLAR-JOIN-01-stage1-join.md` | J1–J3 harnesses, the authenticated HQ walkthrough, no-catalogue learner (§7) | Closed. R1 fixed in UPLOAD-01. V4/V5 email checks are production-only. |
| 2 | Upload | `COMPETEN-SCHOLAR-UPLOAD-01.md`, `…-stage2.md`, `…-limits.md` | upload01 **21/0**; upload **15/0** | Accepted |
| 3 | Classify | `COMPETEN-SCHOLAR-01-competency-learning.md` (387–390); outcome links (408, #92) | competency acceptance **32/0** (1 PEND by design) | Continuous, in use. The optional "My Knowledge & Competencies" view is not authorised. |
| 4 | Learn | `COMPETEN-SCHOLAR-LEARN-01.md` | learn01 **26/0** | Accepted |
| 5 | Revise | `COMPETEN-SCHOLAR-REVISION-01.md` (416, 417, 425) | revision01 **24/0**; revision-hold **17/0** (after the routing publish) | Closed, with bounded follow-ups |
| 6 | Apply | `COMPETEN-SCHOLAR-CLINICAL-REASONING-01.md` (435, 436; IND-007's 422–424) | clinical01 **14/0**; integrated Stage 4/5 journey **14/0** | Closed, with bounded follow-ups. The case library and contribution are OFF for the pilot. |
| 7 | Evaluate | `COMPETEN-SCHOLAR-EVALUATION-01.md` (426) | evaluation01 **19/0** (steps 1–15) | Accepted. Closed on merge (#114). |
| 8 | Progress | `COMPETEN-SCHOLAR-PROGRESS-01.md` (427) | progress01 **18/0** ×2 (steps 1–15; step 12 PEND) | Accepted with bounded follow-ups. The Stage 8 PR follows #114. |

**Across the stages:**
- **Isolation and erasure:** every journey above proves isolation between students and erase-all.
- **Continuity:** stored learning stays available when AI is not. Revise R13, Apply C18, the integrated J8, Evaluate 13 and Progress 14 all show it.
- **Static rules:** scholar-learning pins the honesty and safety rules as K-checks, each with a planted control that goes red (158/158 on the Stage 8 branch).
- **What holds throughout:**
  - formative learning is never verified competence;
  - no single score;
  - CFCA where it applies, and every surface works without a catalogue.

## 2. Genuine remaining pilot blockers

There is **no open code defect** on the pilot path. What still stands between the pilot and students is the activation
in §3. One item there is a hard functional prerequisite, not paperwork:

- **AI routing and model eligibility in production.** #99, live in production, refuses clinical AI with no eligible model. Until the routing published on staging (`ai.model_routing` 6776306d: Scholar `questions` and `case_steps` → claude-opus-4-8, Sonnet not clinical-approved) is published in production, with the eligibility it relies on recorded there:
  - Revise cannot write questions for a new student;
  - Apply cannot write a case.

  Only stored learning would work. Teach Me depends on its own recorded eligibility (`teach`, `ask`).

  Short-answer marking and case-reasoning feedback stay OFF by code default ("self"), per D5-v2. That's intended, not a blocker.

## 3. Minimum activation dependencies (each a separate owner decision)

1. **Migrations in production**, each with its own owner GO and the OPS-001 safeguards (recovery reference, rollback, verification).
   - Production holds the earlier Scholar migrations through 436, plus 425, per the coordinating session's production record.
   - **Outstanding: 426, then 427** (427 depends on 426, and 426 on 417).
2. **AI in production** (§2): the model routing and its eligibility for Scholar's clinical activities, and an AI provider.
   - `ai_fair_use` (metering) stays as the owner sets it.
   - The Individual quota applies while metering is OFF.
3. **`individual_app` ON** in production: the Individual release gate.
4. **Pilot access:** HQ grants or invitations for the pilot students.
   - `individual_self_registration` stays OFF unless the owner opens it.
   - If opened, it needs the legal acceptance of self-declared 18+, plus the V4/V5 email checks (JOIN-01 §5).
5. **Legal documents published** in production, for AI consent: the Holdings and Scholar operator terms and privacy notice.
6. **HQ configuration in production:**
   - the programmes and their catalogues (the Scholar programmes page);
   - the programmes, levels and institutions offered (Individual policy);
   - `pptx` in `scholar_upload_formats` (after 406);
   - a global upload limit of at least 25 MB.
7. **Kept OFF for the pilot:** `case_library` and student case contribution.

## 4. Bounded follow-ups (recorded, not blocking the pilot)

| Stage | Follow-up |
|---|---|
| Revise | Evidence weighting; matching items need three stated pairs (by design). |
| Apply | A separate contribution switch; AI case drafting (unfunded); the HQ Case Studio browser check; metered case cost; library context matching; library AI debrief. |
| Evaluate | Configurable evidence weighting; a time-based retention setting; clinical-context sources beyond cases; library-case evidence. |
| Progress | The programme/level transition check, when a second genuine educational context exists (no test programmes are created for it). AI-supported explanations not offered (by design). Sharing beyond the student-controlled Passport link (private by default). |
| Classify | Versioned re-analysis and mapping history through catalogue change (architecture note, not a defect). |
| Upload | OCR or transcription for images, scans and audio; PowerPoints over 10 MB. |
