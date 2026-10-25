# COMPETEN-SCHOLAR-PROGRESS-01: Progress, Stage 8 of 8 (build record)

Owner GO 2026-10-25, "COMPETEN-SCHOLAR-PROGRESS-01, STAGE 8 — LONGITUDINAL LEARNING PROGRESS" (coordination notes,
`OWNER-GO-STAGE8-PROGRESS-01.md`). It is the last stage of the eight-stage Scholar architecture: Join, Upload, Classify,
Learn, Revise, Apply, Evaluate, Progress.

**Status:**
- Development and staging only. **Production activation not authorised.**
- Scholar stays behind `individual_app`.
- Progress is the student's own educational development. It is never verified competence.

**Migrations:** 427, from the coordinator's range 425–429. It depends on 426 (Evaluate, EVALUATION-01).

## 1. What existed, and is reused

| Capability | Existing | Reused for |
|---|---|---|
| The Progress page | per-material practice accuracy, an 8-week trend, S4 competency progress, the S5 Learning Intelligence panel, Passport study choices | kept as the detail **below** the new workspace (P1) |
| Evaluate (Stage 7) | the six dimensions over any scope, evidence read in place, CFCA levels, confidence, limitations, recommendations; 426 records | the current picture, the explore page and history |
| Evidence | 372, 391, 414, 416, 417, 425, 435 | P2 periods |
| Educational context history | 402 (`contextHistory`) | programme periods |
| Classification | topics (`libraryTopics`) and competency links (`sectionLinks`, 388) | unclassified-material steps; P3 topics |
| The Passport | study achievements (375, self-directed); organisation-issued and verified competencies; the shared Passport page used by both Scholar and Professional; share links through `/verify/[token]` | P5: the middle tier added |
| Configuration | the WCE Individual policy | six keys (§7) |

**Not built, on purpose:** a Progress database, engine or AI service. Progress is computed when it is opened, from records
that already exist. The only new table is the Passport choice (427).

## 2. P1–P5 as built

| | Built |
|---|---|
| **P1 Workspace** (top of `/study/progress`) | **My learning progress** comes first: context, last studied, confidence, and **Recommended next steps**.<br>**Then:** Knowledge coverage, Understanding, Retention, Application and clinical reasoning, Learning engagement and Evidence confidence. Each card says why it reads as it does and links to the evidence.<br>**Never one number.** Engagement is labelled activity, not understanding; coverage is labelled not what you know.<br>One column below `md`, larger touch targets on coarse pointers. |
| **P2 Longitudinal** (`progress-history.ts`) | **Periods:** by week, by month or by educational context (402). Each period shows new questions (first-try accuracy on items first answered then), practice on items already seen (apart), recall held, new case decisions, activity and kept evaluations.<br>**Trends** compare first-try accuracy on new items only.<br>**Thresholds:** below the minimum a period shows counts, not a percentage.<br>**History is not rewritten:** a context change starts a new period, and kept evaluations keep their catalogue snapshot (426). |
| **P3 Competency development** (`/study/progress/explore`) | The CFCA tree (domain › practice unit › competency › learning outcome) links each competency and outcome to an explore page.<br>**On each page:** the relevant materials and sections, topics explored, revision and reasoning evidence, how it was marked (independent / AI-evaluated / self-reported / informal), the separate indicators, gaps, next steps, and earlier evaluations of the same area.<br>**No catalogue:** a material view, and a topic view by URL. |
| **P4 Recommendations** (`progress-next.ts`) | Deterministic, each from a recorded finding, each opening the activity with its context:<br>- a gap → Teach Me on the section, then Revision on its material;<br>- recall that did not hold → spaced review;<br>- weaker reasoning or safety points → a clinical case on the section;<br>- too little evidence → a fresh knowledge check;<br>- an unclassified material → its topics;<br>- strong repeated performance → harder questions on that material (Revise opens preset).<br>No finding, no step. No AI. |
| **P5 Passport** (427, `passport-evaluations.ts`) | **Three tiers kept apart:**<br>1. self-directed study (375);<br>2. **educational evaluation**: a kept evaluation the student chooses to show, labelled *formative, not verified*, with dimension bands, confidence and the count of limitations, and no percentage;<br>3. organisation-issued or verified competence (unchanged).<br>**Nothing is shown unless chosen.** A share link shows chosen evaluations only when it carries the person's own records, read fresh on every view.<br>**One identity:** the same Passport in Scholar and Professional. |

## 3. CFCA and no-catalogue progress

- **With a catalogue:** results are grouped by the CFCA where the student's notes are linked. Expected level is shown beside observed practice; verified competence is never set.
- **Without one:** progress is by material and by topic. Nothing is nursing-specific.

## 4. Longitudinal learning history

- **Computed** from 372, 391, 414, 435, 426 and 402 at view time. Genuine improvement is first-try accuracy on new items; repeated exposure is counted apart.
- **Context changes:** a change of programme or level (402) is its own period. Earlier evaluations are kept as made.

## 5. Evidence confidence and recommendations

- **Confidence** is Evaluate's: class and reasons, everywhere it appears.
- **Next steps:** at most `scholar_progress_next_max`, from the rules the policy allows, each with its reason.

## 6. Passport and Scholar-to-Professional continuity

- **One Individual identity and one Passport,** read by both experiences. Scholar's tiers appear in Professional's view and share links on the same terms.
- **Educational context history** (402) survives a change of programme or level.

## 7. No-code configuration

`scholar_progress_sections`, `scholar_progress_period`, `scholar_progress_periods`, `scholar_progress_next_rules`,
`scholar_progress_next_max`, `scholar_passport_evaluations`. Confidence policies and performance bands are Evaluate's
keys. Passport study eligibility is the existing `passport_achievement_kinds`. AI-supported explanations are not offered:
Progress uses no AI.

## 8. Focused staging acceptance

`scripts/scholar-progress01-harness.ts`, the owner's journey steps 1–15, plus isolation and erase-all. **Pending:** 427 on staging.

## 9. Genuine remaining gaps

To be completed with the acceptance run.

## 10. Production dependencies (none authorised by this build)

- **426, then 427,** each with a separate owner GO and the OPS-001 safeguards. 427 depends on 426.
- **Flags:** `individual_app` and `ai_fair_use` OFF.
