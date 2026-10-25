# The first Nursing clinical content reviewer: appointment package (PREPARED, NOT RUN)

**Status:** prepared only, by owner direction (24 October 2026, re-confirmed in CONSOLIDATED PRODUCTION READINESS: "Await the owner's named nominee. Do not grant clinical approval authority automatically"). **Nobody has been appointed on staging or in production.** No placeholder person exists. No scope has been granted, and no content has been approved. Every step below is for the **owner** to run, in their own HQ session, once they have confirmed the person.

**The authority, in one line:** position `clinical_content_reviewer` (Quality space), granting exactly `hq.quality.clinical.approve` and `hq.platform.home.view`, deciding only within scope `framework` = CF-FOUND (required for CF-FOUND) and, if the owner wants it, `profession` = Nursing.

**Authority this rests on:**
- Owner decision D2 and migration 395 (clinical content approval).
- The existing HQ appointment workflow.
- 395 is applied on staging and in production (OPS-001 §11c).

---

## 1. The person (OWNER TO CONFIRM)

| | |
|---|---|
| Full name | ________________________________________ |
| Professional registration (body and number) | ________________________________________ |
| Competen account email (the profile to appoint) | ________________________________________ |
| Competen profile id (from the appointment board) | ________________________________________ |
| Term end (optional, YYYY-MM-DD) | ________________________________________ |
| Confirmed by the owner (name, date) | ________________________________________ |

The person must already have a Competen account. Appointment attaches a position to an existing profile; it never creates one. **The owner cannot appoint themselves.** The route refuses it, and another platform owner would have to.

## 2. The position

- **Position:** `clinical_content_reviewer`, "Clinical Content Reviewer", in the **Quality** space (migration 395).
- **What it grants, and nothing else:**
  - `hq.quality.clinical.approve`, to record an approval or a rejection;
  - `hq.platform.home.view`, to open the HQ home.

  Proven on staging (rehearsal R1).
- **Made through the existing workflow:** `/super-admin/users/appointments` and `POST /api/hq/appointments`. That route is owner-only, derives the office from the position's space, and never takes a capability from the request.

## 3. The scope

A reviewer decides only within an active scope on their appointment (`clinical_reviewer_scope`, checked by `clinical_scope_covers` in the 395 decision trigger).

| Scope | Kind and record | What it covers |
|---|---|---|
| **Nursing** | `profession` = the Nursing profession term | Shared frameworks whose `profession_term_id` is Nursing (on staging: NUR-RESP, SCH-RESPCARD) |
| **CF-FOUND** | `framework` = the CF-FOUND framework | All competencies of Competen Foundational |

⚠ **The CF-FOUND framework scope is required, not optional, for CF-FOUND review.** CF-FOUND is the foundational, cross-professional layer, and its `profession_term_id` is **null**. `clinical_scope_covers` matches the profession scope on `f.profession_term_id`, so a Nursing profession scope covers **none** of CF-FOUND. Proven on staging (rehearsal R2): the profession scope covered NUR-RESP and 0 of 8 CF-FOUND competencies. The framework scope then covered all 8 (R3).

Whether a Nursing reviewer should review cross-professional foundational content is the owner's call. The framework scope is the mechanism if so.

## 3a. What is waiting for the reviewer (staging, read 24 October 2026)

CF-FOUND's eight competencies were put forward on staging under the owner's Option B GO (`cf-found-staging-review.md`). Read-only re-check, target ezhvpgtcqcdsgylrxgdb, after migration 422 was applied there:

- All eight are **In clinical review**: CF-CM-001, CF-CM-002, CF-CR-001, CF-CR-002, CF-IP-001, CF-IP-002, CF-PS-001 and CF-PS-002.
- Each latest version is a competency version.
- Each hash still equals the competency's current content hash, so none is stale.
- Each needs one approval and has **0 decisions**.
- No reviewer appointment exists (any status), so no appointment covers them yet.

They are decidable by an appointed reviewer holding the CF-FOUND framework scope. The rules are proven by `clinical-review-acceptance-harness`, 16/16, re-run on staging with 422 in place.

The submitter, and the only author, of all eight is the retired synthetic curator `324636db`. Independence therefore bars nobody real, but the nominee must not be anyone who edits these competencies before deciding. An edit makes the version stale, and the edited content needs a new version.

## 3b. If migration 422 is applied: clinical cases (on main and staging, not in production)

The case educator and the case-library publisher are prepared in `case-library-appointments.md`. Shared case publication stays disabled (owner, 25 October 2026).


Migration 422 (COMPETEN-SCHOLAR-CLINICAL-REASONING-01, case interface approval s3) extends this same approval process to clinical case versions. There is no second approval engine. It is on main (#72) and applied on staging. It is not applied in production.

Where 422 is applied, **the same appointment and the same scopes** also decide case versions:

- A case version is in scope only if an active scope of the appointment covers **every** CFCA competency the case teaches. A case naming no competency cannot be decided.
- A case is stale if its content changed after it was put forward, as for a competency.
- Independence, append-only decisions and the configured approval count apply unchanged.

**A CF-FOUND framework scope therefore also covers any case that teaches only CF-FOUND competencies.** That is a widening the owner should know about when granting it.

The reviewer still may **not** author, edit or publish a case:
- authoring is `hq.quality.case.author` (position `clinical_case_educator`);
- publishing is `hq.quality.case.publish` (`quality_council_member`).

Publication is a separate act that requires an approval of that exact version.

## 4. What the reviewer may and may not do

**May:**
- Open `/super-admin/clinical-review` and see the competency versions awaiting review that their scope covers.
- Approve a version, or reject it with a comment saying what needs to change (a rejection without a comment is refused).
- Record one decision per version, under their own active appointment.

**May not (enforced by the database, not by the screen):**
- Review anything they authored, edited or put forward. **Independence:** the 395 trigger refuses a decision by the version's submitter or by anyone in its `authored_by` (*not independent*).
- Decide outside their scope (*out of scope*), or under an appointment that is not their own and active (*not authorised*).
- Approve content that changed after the version was put forward (*stale*). A changed competency needs a new version and renewed approval.
- Edit, rewrite or delete a decision, a version or a scope. All three are append-only.
- Change competency content, publish or archive frameworks, or curate catalogues. The position grants none of that.
- Author, edit or publish a clinical case (where 422 is applied, §3b).
- Grant themselves scope, change how many approvals content needs, or appoint anyone. Those belong to the Quality Council Member (`hq.quality.clinical.govern`) and the platform owner.
- Make content "approved" by their decision alone where the configured count is higher. The count is `holdings.clinical.required_approvals` (CONFIG-002, scope platform / holdings_clinical). It is unpublished on staging today, so the default of **one** independent approval applies.

**The independence rule, in one line:** nobody approves what they wrote, edited or submitted. A curator who puts CF-FOUND forward can therefore never approve it, and the reviewer must not be its author or submitter.

## 5. HQ steps, staging (OWNER RUNS)

Staging today: nobody holds Clinical Content Reviewer, Quality Council Member, Platform Director or Chief Executive. The owner passes every HQ gate as owner (`allow_owner`), so the owner runs all steps.

1. **Confirm the person has a staging account.** Sign in as the owner at the staging deployment and open `/super-admin/users/appointments`. If the person is not listed, they sign up on staging first.
2. **Appoint.** In the Quality space, at "Clinical Content Reviewer", choose the person, set the term end if any, and appoint.
   The request is `POST /api/hq/appointments { "person_id": "<profile id>", "position_code": "clinical_content_reviewer", "term_end": "<optional>" }`.
3. **Grant the scope.** Open `/super-admin/clinical-review/governance` and, for the new appointment, add:
   - profession: **Nursing** (staging term `315bcfb4-2ac0-4eb2-935c-d12b6594dce3`);
   - framework: **CF-FOUND** (staging framework `d5944ae0-a6eb-499f-92dd-99fd3b74aaf2`), if CF-FOUND is to be in their remit.

   The requests are `POST /api/hq/clinical-review/governance { "action": "add_scope", "appointmentId": "<appointment id>", "kind": "profession", "ref": "<term id>" }`, and the same with `"kind": "framework"`.
4. **Run the post-check** (§7).

## 6. HQ steps, production (OWNER RUNS, under its own GO)

Same steps, in production, with production ids, which differ from staging's. Read them first, read-only, in the SQL editor:

```sql
select t.id, t.value from taxonomy_terms t join taxonomies x on x.id = t.taxonomy_id where x.kind = 'profession' and t.value = 'Nursing';
select id, code, profession_term_id from frameworks where hospital_id is null and code = 'CF-FOUND';   -- returns NO ROW today: CF-FOUND is not in production
select id, office_type, status from ogs_offices where office_type = 'hq_quality';                     -- the office the appointment is made in
select code, is_active from hq_position where code = 'clinical_content_reviewer';
```

1. Confirm the person has a **production** account, then open `/super-admin/users/appointments`.
2. Appoint them to Clinical Content Reviewer, as on staging.
3. At `/super-admin/clinical-review/governance`, add the **Nursing** profession scope. Add the **CF-FOUND** framework scope only after CF-FOUND exists in production (`docs/evidence/CLINICAL/cf-found-to-production.md`). Until then there is no CF-FOUND record to name, and the trigger refuses a scope that does not name one.
4. Run the post-check (§7).

## 7. Post-check (read-only, staging or production)

```sql
-- the appointment: active, the right position
select id, person_id, person_name, role, status, term_end from ogs_office_appointments
 where role = 'clinical_content_reviewer' and person_id = '<profile id>';
-- what the position grants: exactly hq.platform.home.view and hq.quality.clinical.approve
select capability_code from hq_position_capability where position_code = 'clinical_content_reviewer' and effective_to is null order by 1;
-- the scopes: the ones intended, open
select scope_kind, scope_ref, ended_at from clinical_reviewer_scope where appointment_id = '<appointment id>';
-- coverage: true for a competency of each intended framework
select clinical_scope_covers('<appointment id>', '<a CF-FOUND competency id>');
-- independence: the reviewer is not the submitter or an author of anything queued for them
select count(*) from clinical_content_version where submitted_by = '<profile id>' or '<profile id>' = any(authored_by);   -- expect 0
-- nothing decided yet
select count(*) from clinical_review_decision where reviewer_id = '<profile id>';                                          -- expect 0 at appointment
```

Then the reviewer signs in. `/super-admin/clinical-review` must open and list the versions in their scope. Every other HQ area must refuse them.

## 8. Rehearsal evidence (staging, synthetic, removed)

`scripts/rehearse-nursing-reviewer-scope.ts`, 24 October 2026, target ezhvpgtcqcdsgylrxgdb: **7/7**. The reviewer was a synthetic profile, labelled "REHEARSAL Nursing reviewer (synthetic, IND-007, removed after)", appointed directly as the service role to the HQ Quality office.

| Check | Result |
|---|---|
| R1 | The position grants exactly `hq.platform.home.view` and `hq.quality.clinical.approve`. |
| R2 | A Nursing profession scope covers NUR-RESP and **0 of 8** CF-FOUND competencies. |
| R3 | The CF-FOUND framework scope covers all 8. |
| R4 | A wrong-kind scope (a framework id given as a profession) is refused. |
| R5 | An ended scope stops covering. |
| R6 | No decision was recorded. |
| Z1 | The profile, its appointment and its scopes are gone. |

The review rules themselves (independence, authority, scope, staleness, counts, append-only) were proven on fixture content by `clinical-review-acceptance-harness` (395 staging record).
