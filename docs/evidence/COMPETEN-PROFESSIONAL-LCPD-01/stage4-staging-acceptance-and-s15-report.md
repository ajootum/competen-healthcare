# COMPETEN-PROFESSIONAL-LCPD-01, Stage 4 (Learning & CPD): staging acceptance and the §15 report

**Owner GO** (relayed 2026-10-25):
- Staging only.
- One clearly labelled synthetic Professional member.
- Run the §13 ECG journey with a planted defect.
- Then retire the identity, restore what changed, and list every row created.

**Owner decision, same day (verbatim):** "Defer the ECG Competen-course steps: IND-007 should run the rest of the Stage 4 journey, report items 2, 3 and 6 as PEND, and send the PR."

**Nothing was done in production.**

## 1. The focused staging acceptance

**Run by:** `scripts/staging-lcpd-ecg-acceptance.ts`.
- **Where:** staging `ezhvpgtcqcdsgylrxgdb`, against a local dev server running this branch over HTTP.
- **As whom:** the synthetic member's own session, through the real routes and pages.
- **What it checks:** totals are read from the database, so a re-run checks the same things.

| Run | Result |
|---|---|
| 1 | **RED 7/13.** Items 1, 7, 8, 13, 14 and 15 failed for one cause: the shell redirected every page to `/individual/welcome`, because a new member is welcomed first. The script then gained the welcome's own action (`POST /api/individual/preferences`, `completeOnboarding`). |
| 2 | **GREEN 13/13**, plus 3 PEND |
| 3 (`--plant`) | **GREEN 15/15**, plus 3 PEND. P1: the CPD page was edited to claim "Verified: N hours accepted", and item 15's check went **RED** on the served page. P2: the file was restored byte-identical, and the check went **GREEN** again. |
| `--retire` | **GREEN 2/2** |

### §13 items

| # | Item | Result | How |
|---|---|---|---|
| 1 | Open My Learning & CPD | PASS | `GET /individual/professional/cpd` returns 200 and shows "Learning & CPD" and the CPD log |
| 2 | View an existing Competen Learning enrolment or completion | **PEND** | Owner decision. A published, clinically approved, certified Competen course cannot exist on staging until Learning's author, clinical reviewer, publisher and certificate issuer are appointed. Migrations 461 and 462 refuse a published hosted version or a certificate without those independent people, so fixtures cannot stand in. Staging has 0 published versions. |
| 3 | Professional references the authoritative record | **PEND** | Same reason. Covered at library level by `learning-acceptance-harness` (A9) and the Stage 4 unit tests. |
| 4 | Add a personal reflection | PASS | `POST learning-reflections`: guided template, impact "applied". Saved through Stage 2's writer (470) and linked by 491. An unanswered prompt is left out. |
| 5 | Link to a development goal and a CFCA outcome | PASS | The CPD entry carries the goal (373 `goal_id`). `POST mappings` adds CF-CR-001, `source = person`, self-declared. The Stage 3 activity link is the follow-up in section 3. |
| 6 | View the certificate and evidence status | **PEND** | Same reason as item 2. The evidence status of CPD entries is shown under items 9, 10 and 15. |
| 7 | CPD hours or credits under a configured requirement | PASS | The member chooses the synthetic requirement (`PUT cpd/requirement`). The page shows "N of 20 hours" and "N of 2 credits" exactly as computed from the database, with the requirement's source and review status. |
| 8 | Record an external or independent activity | PASS | Mentorship (a 490 type) with no hours and 0.5 credits. It counts as credits, and as one entry "with no hours recorded". |
| 9 | Add evidence without duplication | PASS | A PDF added by `PUT` to the same entry. Still one entry (now source-linked), no second CPD row, and the earlier version kept in `individual_professional_cpd_history`. |
| 10 | Selectively share through Passport | PASS | No live link existed before the member made one. `/verify/<token>` then shows their CPD, each entry with its evidence class. |
| 11 | Private reflections stay private | PASS | The reflection text is on no link. It is unreadable without a session and readable in the member's own session (RLS). |
| 12 | Works without AI | PASS | `plat_ai_requests` for the member: 0 before and 0 after |
| 13 | Works without a competency catalogue | PASS | The mentoring entry has no competency and is still counted. None of the LCPD routes or libraries reads a catalogue. The shared Professional allowlist was **not** emptied, so other sessions on staging were not disturbed. |
| 14 | Historical learning preserved after entitlement or context changes | PASS | Ending Professional refuses new writes (403) and keeps every entry and its history. A new entitlement shows the same records. |
| 15 | Self-reported learning not presented as verified competence | PASS | Impact "verified" is refused (400). Entries are only self-declared or source-linked. The requirement says "Not verified", with the reason. The CSV export says "Self-declared" and contains no "verified". The link says "not verified by Competen or by any organisation". |

### PRE values and their restoration

| Shared row | PRE | During | After |
|---|---|---|---|
| `individual_app` | ON (note "COMPETEN-IND-004 staging acceptance") | read, not written | ON, identical |
| `learning_app` | no row (OFF) | **not written**: no remaining item needed it | no row |
| `learning_commerce` | no row (OFF) | not read, not written | no row |
| `workspace_config_overrides` `individual.professional_lcpd` | absent | the one labelled fixture (see below) | absent (deleted after every run) |

**The one fixture besides the member.**
- **Why it was needed:** item 7 needs a configured requirement. Its only door is the HQ policy route, which needs an HQ-appointed actor that the GO does not allow.
- **What each run wrote:** the LCPD configuration row only, draft and published.
  - It was validated by `checkLcpdDraft`.
  - It holds one requirement, `synthetic_stage4_ecg`: "SYNTHETIC Stage 4 ECG requirement (not a regulator rule)", body "No real body, a staging fixture", unreviewed.
  - `updated_by_name` labels it.
- **What it did not do:** it did not call `publishScope`, which would have published every other draft in the scope.
- **Afterwards:** the row was deleted after each run. Its ids were dd9b645a, b65a3f73 and 869d03ed, all deleted.

### The identity and every row created

- **Identity:** `c4acfaa4-c2aa-4479-8620-d319bdb162bd`, `stage4-ecg-professional@staging.competen.invalid`, named "SYNTHETIC Stage 4 ECG professional (IND-007, staging, retire after)".
  - Professional only, through `grantIndividualAccess`, with no Scholar row.
  - The password was generated per run, kept in a scratch file outside the repository, and never printed.
- **Retired and kept**, as with the CF-FOUND curator:
  - entitlements cancelled and membership revoked;
  - sessions revoked (sign-out ran before the ban);
  - banned until 2126-10-01;
  - sign-in refused and the old session refused.

Every row the identity has. All are kept as the record, and all are labelled SYNTHETIC where they carry a title.

| Table | Rows |
|---|---|
| auth.users / profiles | 1 / 1 |
| individual_membership | 1 (revoked, onboarded) |
| individual_entitlement | 4, all cancelled: one grant, plus item 14's regrant in each of the 3 runs |
| individual_professional_goal | 3 |
| individual_professional_cpd | 6 (3 workshops, now source-linked; 3 mentorship entries with no hours) |
| individual_professional_cpd_history | 3 (by trigger) |
| individual_professional_cpd_setting | 1 |
| individual_professional_reflection / _learning_reflection | 3 / 3 |
| individual_professional_competency_map | 3 (person, CF-CR-001) |
| passport_share_tokens / individual_professional_share | 3 / 3, all revoked |
| individual_professional_share_learning | 0 |
| storage `individual-professional-evidence/<id>/` | 3 synthetic PDFs |
| audit_log (actor = member) | 35 |
| notifications, plat_ai_requests, learning_record | 0, 0, 0 |

## 2. The §15 report

**Reused functionality.**
- **Competen Learning, read by reference and never written:** `loadLearningRecords`, `myRecords` and `learningEnabled`.
- **Stage 2:** its reflection writer `saveReflection` (470).
- **CPD log:** 373's CPD log and its generated evidence class.
- **Competency mapping:** 393 (`addPersonMapping`).
- **Passport:** `passport_share_tokens` (122) and the public `/verify` page, plus 453's per-link choice.
- **Configuration:** WCE / CONFIG-002 (`/api/hq/individual/config`, action `lcpd`).
- **Duplicate notification:** the cpd-duplicates refusal and notification ("we don't post this and send a notification to the user").
- **Foundation:** guard, terms and grants.
- **No new mechanism** was added for sharing, configuration, reflections or the course record.

**LCPD-1 to LCPD-6.**
- **LCPD-1 (workspace):** the Learning & CPD page, with anchors, Continue learning, Explore courses, requirements, hours by year, Record CPD, the log with corrections, Completed on Competen Learning, history and export.
- **LCPD-2 (flexible recording, 490):**
  - configured activity types;
  - only a description and a date are required;
  - credits can be decimal (0.5);
  - corrections are kept as history.
- **LCPD-3 (reflection and impact, 491):** quick, guided and detailed templates. The impact is the person's report: completed, understood or applied, never verified.
- **LCPD-4 (Learning integration):**
  - by reference;
  - a course already in the record is refused as a duplicate and the person is notified;
  - "Completed on Competen Learning".
  - Its live journey is PEND, items 2, 3 and 6.
- **LCPD-5 (requirements and reporting, 490):**
  - a requirement is counted against, never "met";
  - recorded and potentially eligible totals, mandatory categories, and the cycle rolling forward;
  - a formula-safe CSV export.
- **LCPD-6 (evidence, Passport and continuity, 491):** completed learning is shared only when ticked, re-checked when the link is shown, and never shown with a reflection. History outlives the entitlement.

**Learning-record integration.**
- **Read-only:** Stage 4 never writes `learning_record` (unit test) and never copies a course into its own tables.
- **Links:** a reflection or a share points at the record with a composite key `(id, user_id)`, so another person's record is unrepresentable.
- **Live check:** PEND on staging for the reason above. `learning-acceptance-harness` covers the record and Professional reading it.

**CPD recording and reflection:** items 4, 8 and 9 live on staging; `lcpd.test.ts` (11 tests) and `lcpd-slice2.test.ts` (9 tests); W1 pins every writer.

**Requirements and reporting:**
- items 7 and 8 live;
- no requirement is seeded and none names a regulator;
- the export is item 15.

**CFCA and plan relationships:**
- **Shipped and shown live:** the goal link (373) and person-made CFCA links (393), item 5.
- **Not yet:** the Stage 3 activity link (480 `individual_professional_activity`), section 3.

**Evidence and Passport:** items 9 to 11 and 15 live. The learning part of the Passport choice is unit-tested and its live check is PEND, because no completed course exists.

**No-code configuration:** activity types, templates, requirements and which evidence classes may be shared are set in the HQ form editor (`LcpdEditor`). Its writer is pinned to `checkLcpdDraft` (individual-config-harness W3).

**Checks on this branch** (after merging `origin/main` dd571877):
- tsc clean;
- vitest 1313/1313;
- individual-professional-harness 100/100;
- individual-config-harness 43/43;
- plane-boundary 35/35;
- learning-harness 23/23;
- individual-foundation-harness 74/74;
- migration house rules clear.

## 3. Bounded follow-ups

1. **Stage 3 goal links.** Stage 3's branch has not merged: `src/lib/individual/professional/plan-store.ts` is not on `origin/main` (dd571877). Once it merges:
   - Stage 4 calls `linkCpdToGoal`, `attachRecordToActivity` and `goalsForRecord`, gated on their not-provisioned answer while 480 is absent;
   - and stops offering the legacy `cpd.goal_id`.

   The contract was agreed with Stage 3 and is unchanged. It is one small change to the CPD form, the edit form and the CPD page.
2. **The Learning journey, items 2, 3 and 6, on staging.** Needs:
   - Learning's author, clinical reviewer, publisher and certificate issuer appointed (an owner decision);
   - then a free hosted ECG course;
   - then the three items on one member.
3. **The ECG run of item 10 for learning.** It needs a completed course, so it goes with follow-up 2.

## 4. Production dependencies

- **Migrations:** 490 and 491 are applied on staging (twice, each with its rollback rehearsed), committed byte-identical, and **not applied in production**. Each needs a separate owner GO with its recovery reference, rollback SQL and verification.
  - **490** depends on 373 only.
  - **491** depends on 470 (now in production), 373, 393, 453, and **462 (`learning_record`, Competen Learning)**. 462 must be in production before 491; its production state is in the Learning lane's own record.
  - 490 and 491 are independent of each other.
- **Staging rollback note:** this acceptance left 490-shaped rows on staging (3 mentorship entries with no hours). `ROLLBACK-490` now refuses on staging, by design. Fix forward instead.
- **Until they are applied, the code fails closed:**
  - `lcpdSchemaReady` keeps 373's rule (nine types, hours required);
  - the requirement section says "not available on this environment yet";
  - reflections on learning and sharing of learning are absent;
  - nothing implies they exist.
- **`learning_app`** stays OFF in production until its own GO. While it is off, nothing reads a learning record.
- **No configuration** is needed for production. The defaults hold no requirement; a requirement is an HQ decision with a named source.
