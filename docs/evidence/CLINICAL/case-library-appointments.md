# The case educator and the case-library publisher: appointment package (PREPARED, NOT RUN)

**Status:** prepared only, by owner direction (25 October 2026): "Prepare appointments for one clinical reviewer (framework scope CF-FOUND), one case educator, one case-library publisher. Await the owner's named nominees."
- Nobody is appointed on staging or in production, and no placeholder person exists.
- The reviewer's package is `first-nursing-reviewer-appointment.md`. This file covers the other two.
- **Shared case publication stays DISABLED** (owner, 25 October). It is gated by the `case_library` platform flag, which is OFF unless written. These appointments are prepared so they can be made when that changes. Making them does not switch anything on.

**Authority this rests on:**
- migrations 395, 422 (case library, its two capabilities and the educator position), 423 and 424;
- the existing HQ appointment workflow (`/super-admin/users/appointments`, `POST /api/hq/appointments`, owner-only).

**Production state:** 422 to 424 are not applied in production, so neither position below exists there yet. Production appointments wait for those migrations and their own GO.

## 1. The people (OWNER TO CONFIRM)

| | Case educator | Case-library publisher |
|---|---|---|
| Full name | ______________________ | ______________________ |
| Professional registration | ______________________ | ______________________ |
| Competen account email | ______________________ | ______________________ |
| Competen profile id | ______________________ | ______________________ |
| Term end (optional) | ______________________ | ______________________ |
| Confirmed by the owner (name, date) | ______________________ | ______________________ |

**Independence:** three different people. The reviewer, the educator and the publisher must not be the same person.
- The database already refuses any author or editor of a case version approving it (395 and 422).
- Separating the publisher from both is a governance choice the database does not enforce, so the owner should keep it.
- The owner cannot appoint themselves.

## 2. Case educator: position `clinical_case_educator` (Quality space, migration 422)

**Grants exactly:**
- `hq.quality.case.author`: the case studio at `/super-admin/cases` and `POST /api/hq/cases` (author actions);
- `hq.platform.home.view`: the HQ home.

**May:**
- Read the candidate queue of de-identified cases students chose to offer: no student name, no source, no uploads, no histories (423).
- Take, release, decline or promote a candidate.
- Create a case, edit a draft in the no-code editor, start a revision or variation, delete an unsubmitted draft, and submit a draft for independent clinical review.
- Draft a case with AI, charged to a platform budget, never to a student. This stays refused until a platform budget funds `case.educator_develop`, which is not set up.

**May not (enforced by the database):**
- Approve any case. Educators hold no `hq.quality.clinical.approve`, and anyone who authored or edited a version is refused by the 395 independence rule even if later appointed as a reviewer.
- Publish or retire a case (that needs `hq.quality.case.publish`).
- Change a submitted version: it is frozen, and a change means a new draft and renewed approval.
- See who offered a candidate, or anything of a student beyond the de-identified case.
- Change clinical approval counts, reviewer scopes or the case policy.

## 3. Case-library publisher: position `quality_council_member` (existing, Quality space)

**Why this position:** `hq.quality.case.publish` is granted only to the Quality Council Member (422). No narrower position holds it today.

**⚠ It is the WHOLE Quality space, not only publication.** It grants:
- `hq.quality.case.publish`: publish an approved case version, retire a case, and set the case policy;
- `hq.quality.clinical.govern`: clinical review governance, meaning reviewer scopes and the required approval counts;
- `hq.quality.assurance.view`, `.intelligence.view`, `.governance.view`, `.regulation.view` and `.policy.view`;
- `hq.practice.risk.accept` and `hq.practice.governance.view` (migration 311);
- `hq.platform.home.view`.

**Owner option** (a decision, not built): if a publisher should hold ONLY publication, a narrower position (for example `case_library_publisher`, granting `hq.quality.case.publish` and the HQ home) is one small migration in IND-007's range, under its own GO.

**May:**
- Publish a version only when its exact version is clinically approved. The database refuses otherwise (`case_library_publish`). The previously published version is then superseded.
- Retire a case: it is no longer offered, and its record stays.
- Edit the case policy (CONFIG-002): retention, queue window, offer limit and variations. It is versioned and audited.

**May not (enforced):**
- Approve content (that needs `hq.quality.clinical.approve`).
- Publish anything not approved for its exact version, or anything while `case_library` is OFF.
- Turn on case contribution or publication. That is the owner's `case_library` switch.

## 4. HQ steps, staging (OWNER RUNS, when nominees are confirmed)

1. Confirm each person has a staging account (`/super-admin/users/appointments`).
2. **Educator:** in the Quality space, at "Clinical Case Educator", choose the person and appoint (`POST /api/hq/appointments { "person_id": "<profile id>", "position_code": "clinical_case_educator" }`).
3. **Publisher:** in the Quality space, at "Quality Council Member", choose the person and appoint (`position_code: "quality_council_member"`).
4. Run the post-check (section 6).

## 5. HQ steps, production (OWNER RUNS, under its own GO)

These come only after 422 to 424 are applied in production. The steps are the same, with production ids. Read first, read-only:

```sql
select code, is_active from hq_position where code in ('clinical_case_educator', 'quality_council_member');
select position_code, capability_code from hq_position_capability
 where position_code in ('clinical_case_educator', 'quality_council_member') and effective_to is null order by 1, 2;
```

## 6. Post-check (read-only, staging or production)

```sql
-- the appointments: active, the right positions
select id, person_id, person_name, role, status, term_end from ogs_office_appointments
 where role in ('clinical_case_educator', 'quality_council_member') and person_id in ('<educator id>', '<publisher id>');
-- the educator holds exactly hq.platform.home.view and hq.quality.case.author
select capability_code from hq_position_capability where position_code = 'clinical_case_educator' and effective_to is null order by 1;
-- three different people across reviewer, educator and publisher (expect 3)
select count(distinct person_id) from ogs_office_appointments
 where status = 'active' and role in ('clinical_content_reviewer', 'clinical_case_educator', 'quality_council_member')
   and person_id in ('<reviewer id>', '<educator id>', '<publisher id>');
```

Then each person signs in. The educator reaches `/super-admin/cases` and is refused `/super-admin/cases/publication`. The publisher reaches `/super-admin/cases/publication`.

## 7. Evidence already on record (staging, synthetic, removed)

`case-intelligence-acceptance-harness` (`docs/evidence/CASES/423-staging-record.md`, `424-staging-record.md`), with synthetic people appointed and removed:
- an educator took, promoted, edited and submitted a case;
- the same educator, holding an in-scope reviewer appointment, was refused approval (J5);
- nothing published before an independent scoped reviewer approved, and a Quality Council Member then published (J6).

23/23 on 25 October 2026, and 24/24 under metering ON.
