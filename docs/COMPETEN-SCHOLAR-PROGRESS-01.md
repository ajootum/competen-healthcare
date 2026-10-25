# COMPETEN-SCHOLAR-PROGRESS-01: Progress, Stage 8 of 8 (build record)

Owner GO 2026-10-25, "COMPETEN-SCHOLAR-PROGRESS-01, STAGE 8 — LONGITUDINAL LEARNING PROGRESS" (coordination notes,
`OWNER-GO-STAGE8-PROGRESS-01.md`). It is the last stage of the eight-stage Scholar architecture: Join, Upload, Classify,
Learn, Revise, Apply, Evaluate, Progress.

**Status:**
- Development and staging only. **Production activation not authorised.**
- Scholar stays behind `individual_app`.
- Progress is the student's own educational development. It is never verified competence.

**Migrations:** 427, from the coordinator's range 425–429. It depends on 426 (Evaluate, EVALUATION-01).

| File | sha256 (LF) | Tier | State |
|---|---|---|---|
| `427-individual-scholar-passport-evaluation.sql` | `586d2f8cfdb270ea96b1e8e78c18bb65e5dfed3df2623fff8cc8fe12bc04dfcb` | Low (one table, no function, no trigger) | **Applied ×2 on staging**, rolled back and re-applied. Frozen. **Not on production.** |
| `docs/evidence/COMPETEN-SCHOLAR-PROGRESS-01/ROLLBACK-427.sql` | `81c63a340644a0542f962c0d2136cce2eecc0756cdb99d261f52cc84a305099d` | — | — |
| `docs/evidence/COMPETEN-SCHOLAR-PROGRESS-01/VERIFY-427.sql` | `27553f101cf105a50c77e9c4ec60c7a6cdb60e1001256645e43070f92c61dbc2` | read-only | — |

**Staging run record** (coordinating session, 2026-10-25, guarded runner, after 426, target `ezhvpgtcqcdsgylrxgdb`):

| Step | Fingerprint (`individual_scholar%`) |
|---|---|
| PRE | `24b9364c77d6` (34 tables) |
| 427, run 1 (F1) | `1bcc03e37776` (35 tables) |
| 427, run 2 | `1bcc03e37776` (idempotent) |
| ROLLBACK-427 | `24b9364c77d6` = PRE |
| Re-apply | `1bcc03e37776` = F1 |

Triggers were unchanged throughout (`3c9f9528`). VERIFY-427 after both runs:
- 5 columns;
- the check, `eval_fk`, the primary key and `user_id_fkey`;
- the indexes: the primary key and `ux_…_one`;
- RLS on, with one own-row SELECT policy;
- 0 triggers and 0 rows.

The bytes applied are the files above. Production follows 426, with its own GO.

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

`scripts/scholar-progress01-harness.ts`, the owner's journey steps 1–15, plus isolation and erase-all. It ran alone over
HTTP against staging, with 426 and 427 applied, metering OFF.

- **Run 1** (on Evaluate's base, before #99): **ALL GREEN, 18 passed, 0 failed.** Real AI wrote the questions and the case. Step 12 PEND.
- **Run 4** (on the integrated branch, with main and #99): **ALL GREEN, 18 passed, 0 failed.**
  - #99 refuses AI writing of clinical questions and cases until a model is eligible ("This needs an AI model approved for clinical content, and none is approved for it yet").
  - So the journey seeds six structured questions for the fixture and answers them through the real routes. The case part is said as refused.
  - Progress reads evidence; how questions are written was shown in run 1 and by the stage harnesses.
- **Step 12 PEND in both runs:** staging offers one programme with one level, and the programme configuration is shared configuration this journey never writes. The context periods are pinned by `progress.stage8.test.ts` (a level change keeps the earlier period), and kept evaluations are immutable (426, Evaluate step 12).

**How it got there:**
- **Run 2:** with #99, nothing could be written, so steps 2, 7, 8, 9 and 11 had nothing to read. Seeding was added for when no model may write.
- **Run 3 (15/3):**
  - The workspace did not state the verified-competence boundary when there was little evidence. Fixed: "Observed practice on your own notes: not verified competence." is shown always.
  - One seeded question per section was below the two needed for a gap. Fixed: two per section.
  - Step I met a session-refresh redirect. Fixed: one retry, then the page must say "could not be opened".
- **Run 4:** 18/0.

**Tests:**
- Unit: `progress.stage8.test.ts` (6); Individual suite 413/413.
- `scholar-learning-harness` 158/158, with K41 and plant P59 (five plants red).
- `individual-config-harness` 41/41; `individual-foundation-harness` 74/74 (12p unchanged); `next build` exit 0.

## 9. Genuine remaining gaps

- **(a) AI writing of clinical content on staging waits on model routing.** It is not a Progress gap, but it limits what a pilot student can generate. #99 refuses `questions` and `case_steps` until a model is eligible (Opus `questions` eligibility is recorded; the heavy routing is not yet published at HQ). Progress, Evaluate and stored learning work regardless.
- **(b) Context-change history (step 12)** was not exercised live, because staging offers one programme with one level. It is covered by the unit tests and by 426 immutability.
- **(c) AI-supported explanations** in Progress are not offered. Progress uses no AI, by design. The contract allows AI only where it materially helps.
- **(d) A topic explore page** exists by URL (`kind=topic`) but is not linked from the workspace. Materials and CFCA areas are linked.
- **(e) Sharing beyond the existing Passport link** (for example, granting an educator access) is not built. The contract keeps Progress private by default, with governed sharing only. The existing student-controlled share link carries the chosen tiers.

## 10. Production dependencies (none authorised by this build)

- **426, then 427,** each with a separate owner GO and the OPS-001 safeguards. 427 depends on 426.
- **Flags:** `individual_app` and `ai_fair_use` OFF.
