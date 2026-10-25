# COMPETEN-PROFESSIONAL-PLAN-01: Professional Stage 3, Personal Development Planning (build record)

**Authority:** owner GO "COMPETEN-PROFESSIONAL-PLAN-01, Stage 3: Personal Professional Development Planning". It covers development and staging only. Production deployment and activation need a separate owner GO.

**Branch:** `prof/plan-01-stage3`, cut from `origin/main` 9325cb7f (Stage 2 merged).

**Migration:** 480, staging only.

## 1. Existing functionality reused (not rebuilt)

| Existing | Reused for |
|---|---|
| 373 `individual_professional_goal`, the goals route, and the Needs & plan page | THE goal record and page. 480 widens the goal and keeps the MVP route paths unchanged. |
| 470 goal ↔ need join (`needs-store` `linkGoal`) | Goals and needs, many to many. |
| 470 private reflections | A goal's source, and evidence. Only the id is referenced, and reflections are never read by plan code. |
| 450 profile aspirations | A goal's source. |
| Learning catalogue and records (460–464): `publishedCatalogue`, `loadLearningRecords`, `learningEnabled`, `findLearningHref` | Finding courses, adding a course to the plan, and referencing a completed learning record. Nothing is extended, enrolled or purchased. |
| 373 CPD log (Stage 4 owns its writer) | The record of what happened. An activity references it and never copies it. |
| Professional catalogue allowlist and CFCA library (384 / 394 / 395), `versionOf` | Competency and outcome links, with the framework version kept. |
| WCE Individual policy (076 / CONFIG-002) | All Stage 3 configuration: 17 new policies. |
| Holdings Personal AI through `askProfessionalAssistant` (the legacy quota or metering rule, and the identifier screen) | Planning help. There is no gateway change. |
| The append-only trigger pattern (402 / 450 / 470) and the composite-key pattern | Goal and activity history, reviews, and link history. |

## 2. P1–P6

| | Built |
|---|---|
| P1 | **My development plan** inside Needs & plan, with no new navigation. Views: Open, Deferred, Addressed and retired, All. A goal opens with `?goal=`. **Only "What do you want to achieve?" is required, and the target date is optional.** Optional, configured fields: type, why it matters, intended outcome, priority, needs, competencies, expected evidence, start/target/review dates. A goal can be created directly or from a need, a competency, a learning opportunity, an aspiration, a reflection or an evaluation (`created_from`, with the source id). Templates (SMART and an outcome template by default) are optional, applied from the goal, with answers kept by prompt. |
| P2 | Activities: Competen, partner and external courses; workshop; independent study; mentorship; learning at work; supervised practice; teaching; research; QI; reflective practice; other (configurable). Statuses are planned, active, completed, deferred and cancelled. Activities are ordered within a goal (move up/down), can depend on another activity, and can link to many goals. They can also be unplanned, and an existing activity or record can be linked to a goal later. **No plan is required before recording learning.** |
| P3 | Many to many throughout: needs ↔ goals, goals ↔ activities, goals and activities ↔ competencies and outcomes, with the version kept. Competencies matching the goal's words are offered as deterministic suggestions only. Everything works without a catalogue, and only offered (approved) catalogues are ever shown. |
| P4 | Optional start, target and review dates; optional milestones (configurable types); ideas taken from the goal's own dates; ordering and dependencies; in-app reminders (no email); trigger-written history, so a revision never overwrites silently. |
| P5 | Evidence comes through the goal's activities (the referenced CPD entry or completed learning record, each with its own class) and through direct links to evidence items and private reflections. The class is shown as the source holds it: self-reported, document-supported or verified. **Completing an activity does not achieve the goal, and addressing a goal verifies nothing.** |
| P6 | A private, append-only review with five optional questions (configurable). Decisions: continue, revise, reprioritise (choosing a new priority), addressed, defer, retire, reopen (subject to the reopen rule). Addressed is the person's own judgement: the goal becomes done. |

## 3. The Stage 3/4 contract (agreed with IND-007, Stage 4, 25 Oct)

- **The records of what happened.** The CPD entry (373, extended by Stage 4) and the Holdings `learning_record` are the records of what happened. A Stage 3 activity is planned or intended work that references one of them through `cpd_id` / `learning_record_id`, composite FKs `(x, user_id)`, `on delete set null`.
- **Nothing stored on the activity.** An activity has no completion, hours, credits, evidence or actual-date columns.
- **Completed needs a record.** `completed` is possible only with a reference, enforced by a CHECK. A plain update to completed is refused. When the record is removed, a trigger returns the activity to planned.
- **One activity per record.** Each record has at most one activity (unique indexes), and that activity can serve many goals. CPD reaches a goal only through an activity.
- **Exports from `plan-store.ts`, the single writer.**
  - `linkCpdToGoal`: retrospective linking, idempotent. It copies the record title as an editable label only.
  - `attachRecordToActivity`.
  - `goalsForRecord`: read-only.
- **No ordering dependency.** 480 uses 393's `(id, user_id)` indexes and repeats them idempotently, so 480 and 490 can land in either order.

## 4. Privacy

- **Plan tables are read only by Professional code.** No AI grounding, Passport, share link or `/verify` reads them; the harness pins this.
- **Plan AI.** It sends only the goal's title and intended outcome. It never sends reflections, and it saves nothing: each suggestion is added only on the person's click.
- **No employer access, no auto-publishing, no credential.** Nothing gives an employer access or auto-publishes. Goal completion never becomes a credential.
- **No scope, verified or score column anywhere.**

## 5. Configuration (no code, WCE): `professional_goal_*`, `professional_activity_*`, `professional_milestone_types`, `professional_plan_*`

| Setting | Kind |
|---|---|
| Goal types | options |
| Goal priorities | options |
| Planning templates | options ("Name: prompt \| prompt") |
| Optional goal fields and order | sequence |
| Goal statuses | sequence, planned fixed |
| Reopen rule | choice |
| Activity types | options |
| Activity statuses | sequence, planned and completed fixed |
| Milestone types | options |
| Evidence kinds | options |
| Review questions | sequence |
| Review interval | int, 14–365, default 90 |
| Reminder lead time | int, 1–90, default 14 |
| Competency links | choice |
| Learning recommendations | choice: by competency, + by words, off |
| Planning AI | choice |
| Reflections in planning AI | choice, fixed to never |

The defaults are neutral: no profession, country, timeline or compulsory template.

## 6. Migration 480 (staging only)

- **File:** `supabase/migrations/480-individual-professional-development-plan.sql`. **APPLY WHOLE** (plpgsql).
- **sha256 (LF):** `7d7496106059cff97a2f65a877762602af315203ec76227f163d2b3f79c64f3d`.
- **Depends on:** 373, 393 (indexes, repeated), 450, 470, 460/462, 003. It is independent of 451–453, 465/466 and 490.
- **Evidence files** (`docs/evidence/COMPETEN-PROFESSIONAL-PLAN-01/`):
  - ROLLBACK `8c85a074…079d`
  - VERIFY `62a2ae89…d6ca`
  - FINGERPRINT `0d9b5c23…32ad`
- **Local rehearsal** (postgres:17):
  - Applied twice; it is idempotent, and the backfill ran.
  - 43 behaviour probes and 7 count checks came out as designed.
  - Fingerprints: PRE `2b314e8f…` = after ROLLBACK; apply #1 = #2 = re-apply `40069e74…` (537 items).
  - ROLLBACK restores the 373 status CHECK and `target_date NOT NULL`. Deferred goals go back to planned, and goals with no target date take their creation date.
- **Staging** (coordinating session, guarded runner, file whole, LF bytes as above):
  - Applied twice, then rolled back and re-applied. **Final state: APPLIED on staging** (ezhvpgtcqcdsgylrxgdb).
  - Full record: `docs/evidence/COMPETEN-PROFESSIONAL-PLAN-01/480-staging-record.md`.
  - Pre-application: `individual_professional_goal` had 0 rows.

    | Step | FINGERPRINT-480 | Items |
    |---|---|---|
    | PRE (470 applied) | `a0812a5017bfcfb6f49a0d2142d07b55` | 443 |
    | Apply #1 = apply #2 (idempotent) | `1ed4a8ec7b9a163877bbdaeeaa3f3ff0` | 631 |
    | Rollback | = PRE | 443 |
    | Re-apply | = apply #1 | 631 |

  - VERIFY-480, after apply #2 and again after re-apply:
    - §1: 18 | YES.
    - §2: 8 tables, each RLS t|1|1.
    - §3: 8 triggers.
    - §4: 5 functions.
    - §5: 0 | 0.
    - §6: 0.
    - §7: the status CHECK includes deferred.
    - §8: both 393 indexes.
- **Production:** not applied. Production only on separate owner GO.

## 7. Verification

| Check | Result |
|---|---|
| `tsc`, eslint | clean |
| vitest `src/lib/individual` | 493 / 493 (new `plan.test.ts`; policy default test extended) |
| `professional-plan-harness.ts` (new, CI credential-free list) | **42 / 42**, including 26 planted reds |
| `individual-professional-harness` | 100 / 100. W1 went RED on the new unpinned writes, which were then pinned. U1 had weakened: the plant swapped only one of two "Add a goal" panels. It was tightened to check every panel, and the plant is red again. |
| `professional-needs`, `professional-profile`, `individual-config`, `individual-foundation`, `hq-guard` | 33 · 59 · 41 · 74 · 51, all green |
| **Staging journey, GO s15** (`professional-plan-acceptance-harness`) | **15 / 15**: items 1–14 plus cleanup. Two planted product defects (goal source forced to "direct"; attaching a record not completing the activity) turned items 1 and 7 RED. The source was restored and the journey was green before and after. |
| Staging UI walk-through (synthetic identity, deleted after) | Plan section → a goal saved with only its description → listed → detail with every optional field "Not recorded" → an independent-study activity added and listed. No horizontal scroll at 375 px. |

## 8. Bounded follow-ups (not built)

- **Learning-record attach on staging.** It is exercised only where a completed learning record exists. The composite-key refusals were probed locally.
- **Stage 4 adoption.** Stage 4 offers "supports goals" on its CPD page through `goalsForRecord`. The 373 `cpd.goal_id` remains legacy, and plan code does not read it.
- **Plan sharing.** A plan-sharing option is not built, because plans are private by GO. Any sharing would be a separate owner decision.
