# COMPETEN-SCHOLAR-01 S5: Learning Intelligence, build record

| | |
|---|---|
| **Owner GO** | COMPETEN-SCHOLAR-01: development authorised, production activation not. S5 is owned by this session. |
| **Branch** | `ind-scholar-s5/learning-intelligence`, cut from `main` at `705cd18d`. |
| **Migration** | **391** (`individual_scholar_review`). **Staging only. Not authorised for production.** 392 is unused. |
| **Classification** | **Low** under amended COMPETEN-OPS-001 §8: one new Individual-owned table with its own RLS, plus one additive index and one widened CHECK. |

## 1. What it does
Four measures of a Scholar learner's own study, **tracked separately and never blended into one score**:

| Measure | From | Shown as |
|---|---|---|
| **Competency coverage** | S1 catalogue + S2 question mappings, through `competency-sources.ts` interfaces | Practised / practised with a right answer / gaps. "Practised", never "achieved". |
| **Learning engagement** | attempts (full history) + review log (391) | Study days and active weeks; answers and reviews in the window; last studied; cards due |
| **Knowledge performance** | practice questions (MCQ) only, plus recall from the review log | Right on latest try, right first time, put right later, mean recall grade (0–5) |
| **Clinical reasoning** | practice scenarios (case questions) only | Right on latest try, right first time, put right later |

**Every measure is in one of three states:**
- `measured`;
- `insufficient` ("Too little practice to say", with how much there is and how much is needed);
- `not_measured` (with the reason).

A measure is never shown as a blank or a 0 when nothing was measured.

**Insights and recommendations:** insights are one true sentence per measure. Recommendations are ranked, each with its reason and a link:
- review due cards;
- pick up again after 7 days;
- revisit the weakest material (below 70%, with enough answers);
- write practice questions from a material that has none;
- continue a material with unanswered questions;
- try scenarios;
- practise more scenarios when reasoning lags knowledge by 15 points or more;
- answer N more questions or scenarios to reach the threshold;
- practise the competencies not yet touched.

**Configuration-first:** two thresholds are Individual policy (CONFIG-002 engine, not a new system), clamped, and editable on the HQ Individual Policy page:

| Policy | Default | Range | Meaning |
|---|---|---|---|
| `scholar_insight_min_answers` | 5 | 3–50 | answers needed before a figure is shown |
| `scholar_insight_window_days` | 28 | 7–90 | the engagement window, in days |

**Passport:** revision is a third self-directed achievement on the **existing** 375 path (`revision_reviews`).
- **What it shows:** a count of reviews on one material, derived at render time, for example "8 revision reviews of own notes".
- **What it never shows:** the recall grade.
- **Offered by default:** policy offers it like the existing kinds.

## 2. S1 and S2: coded against interfaces, not waited on
- **Interfaces:** `CompetencyCatalogueSource.competenciesFor` (S1) and `CompetencyMappingSource.mappingsFor` (S2), in `src/lib/individual/scholar/competency-sources.ts`.
- **Placeholders:** both answer `{ ok: true, value: null }` ("not available"), so coverage renders **Not measured**, with the reason "No competency framework is connected to your study yet".
- **Failed reads:** a failed source read is `ok: false`, and renders as "could not be read just now". It is never computed.
- **S1 is connected (#39):** `S1_CATALOGUE` reads `loadCatalogueFor(admin, "scholar")`, the Scholar allowlist applied to the shared library. An empty allowlist means "no framework connected"; unreadable means "could not be read". Staging L8 proves it is live: with CF-FOUND allowlisted, coverage turns from "no framework connected" to "questions not yet linked". The harness restores the prior allowlist afterwards.
- **S2 is not connected yet:** IND-004 388 (accepted maps only) follows in a small PR once it is on main. It means replacing `mappings` in `COMPETENCY_SOURCES`.

## 3. Migration 391: the four states
| State | Status | Evidence |
|---|---|---|
| 1. Authored | Done | House rules: ALL CLEAR. One warning: a quoted value in a comment, as in 375. No plpgsql. |
| 2. Applied and verified on staging | **Done.** Applied by the owner with `apply-migrations --only 391` | **Pre-application** (19:19Z, read-only): `individual_scholar_review` absent; card indexes without an owner index; the passport CHECK listing two kinds; 0 passport items. **Post-application** (19:32Z, read-only, `judgeDbTarget`-guarded): the 7 columns; composite FKs to card and material (cascade); the values CHECK; two indexes; RLS with policy `individual_scholar_review_read_own` (SELECT); 0 rows; `ux_individual_scholar_card_owner` present; the passport CHECK listing three kinds. **Second, confirming run:** by the main session, under the owner's authorisation for staging applies of 384–392: `npx.cmd tsx scripts/apply-migrations.ts --only 391` from competen-ind-002. The target was `ezhvpgtcqcdsgylrxgdb`, the guard passed, the working copy was CRLF `E90CD0D1…`, and the output was "391-individual-scholar-review-log.sql ... ok". It was a no-op by construction: every statement is IF NOT EXISTS or drop-then-add. |
| 3. Merged into `main` | Not yet (PR) | The code fails closed while the table is absent: the review insert is skipped, `reviewRows` returns null, and recall and reviews render "Not measured". A revision achievement can't be eligible, because there are no reviews. |
| 4. Applied to production | **Not authorised** | — |

**Checksums:**
- LF, as git stores it: `6747df1a46b300cf4b10aae403f48015943be675e4ad23e105ea8f78b8606c6b`, verified on the committed blob.
- CRLF working copy: `e90cd0d1b574edc77c2eac94937189420fd424a66448bc8a91935db66e7071f6`.

**Dependencies:** 372 and 375 only. **Application order:** any time after 375.

**Rollback SQL** (staging, or production if ever applied):
```sql
alter table individual_scholar_passport_item drop constraint if exists individual_scholar_passport_item_achievement_check;
delete from individual_scholar_passport_item where achievement = 'revision_reviews';
alter table individual_scholar_passport_item add constraint individual_scholar_passport_item_achievement_check
  check (achievement in ('practice_questions', 'practice_scenarios'));
drop table if exists individual_scholar_review;
drop index if exists ux_individual_scholar_card_owner;
notify pgrst, 'reload schema';
```
The rollback deletes every review row, and every `revision_reviews` Passport choice. Study history (attempts, cards) is untouched.

## 4. Verification
- **Unit tests:** `intelligence.test.ts` 15. They cover:
  - each state of each measure;
  - knowledge and reasoning kept separate;
  - latest, first-try and corrected figures;
  - recall present or absent;
  - engagement days;
  - the coverage interfaces, including the unreadable case;
  - recommendations;
  - revision in the Passport;
  - the policy clamps.

  The full Vitest run passes 746 tests.
- **Typecheck and lint:** `tsc` clean, `eslint src` clean.
- **Foundation harness: 60/60.** The new check 12p says revision reaches the Passport as which material and when, never the grade, and only `reviewCard` writes the log. Planting a grade read turns it red.
- **Other harnesses:** `individual-config` 36/36, `scholar-learning` 77/77, `auth-boundary` green.
- **Staging HTTP:** `scholar-intelligence-harness` 8/8 (L8: S1 live). It uses a real sign-in, real answers through the attempts API and a real review through the cards API:
  - Not measured before any answers;
  - "Too little practice to say", with how many so far;
  - knowledge and reasoning in separate panels with their own figures;
  - coverage Not measured until S1/S2 are connected;
  - one review-log row, counted by engagement;
  - revision chosen for the Passport, shown as a count with no grade;
  - recommendations with reasons.
- **Defect caught on staging:** the first run found no recommendation for a learner just short of the scenario threshold. A "work through N more" recommendation was added, with its own test.
- **Screenshots:** `docs/evidence/COMPETEN-SCHOLAR-S5/` (desktop and mobile).

## 5. Boundaries kept
- **Self-directed study only:** nothing is called mastery or competence, and nothing is visible to an organisation.
- **D1:** no estate learning table is read or written.
- **Owner-only access:** every read is keyed on the session's own user id.
- **The Passport:** shows only counts and dates, never accuracy or a recall grade.
- **No AI call:** S5 adds no AI call.
