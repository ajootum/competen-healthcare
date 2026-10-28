# HQ-USERS-CLASSIFY-01: migration 650 build record

Owner GO, 28 Oct 2026, verbatim at `RELEASE-2026-10-25/HQ-USERS-CLASSIFY-01/DIRECTIVE.md`. The work separates genuine human
accounts from demo, test and system accounts in HQ Users.

| State | Status |
|---|---|
| 1. Authored | Done. The local rehearsal is below. |
| 2. Applied and verified on staging ×2 | **PASS 28 Oct** (coordinator, staging `ezhv…`): sha256 matches. FINGERPRINT went from 0|0|0|0 to 1|3|3|1 on both applies. The access digest `2d613135…` was unchanged throughout. VERIFY rows 1-8 were true. Rollback gave 0|0|0|0 and the re-apply gave 1|3|3|1. Record: `RELEASE-2026-10-25/PENDING-15/STAGING-RECORD-650.md`. Staging REPORT 1: 27 test rows and 6 unclassified rows, with no demo rows (the AMU cohort is not on staging). In the coordinator's notation those are test 27/15 and unclassified 6/6. One synthetic marker sits on a non-test address and was left Unclassified. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** The owner applies it by hand, with a separate GO. |

**sha256 of the file to stage:** `1c03cecfcc3c1a464a89b7d1b80945857ee8c5f659c870dcdbfc48ced18b92c6` (LF, ASCII, 332 lines).

Companions:
- ROLLBACK-650: `b4bf1484`
- VERIFY-650: `d4edc0fd`
- FINGERPRINT-650: `b3250036`

**Application order.** Apply after 641, or anywhere after 500. It needs only 001, 040, 178, 264 and 500, all in production. It is additive and idempotent. It grants nothing and overwrites no classification.

## What it adds

- **`hq_account_classification`**: one row per classified profile. No row means Unclassified.
  - CHECK on the five types.
  - `basis` is `manual` or `provenance`. A provenance row must carry `source_ref`.
  - The reason is required.
  - Row-level security is on with no policy, so only the service role can use it.
- **`hq_config.users_default_view`**: the default HQ Users view, `active_humans`, with a CHECK on the eight views. It lives in the existing HQ configuration row; no new admin system.
- **Audit trigger `trg_hq_account_classification_audit`**: every insert, change and removal writes one `audit_log` row whoever the writer is. The row holds `old_value.account_type`, `new_value` (type, reason, basis, source), actor, time and trace.
- **`hq_account_classify(...)`**: owner only (`hq_actor_is_owner`, from migration 500), callable only by the service role.
  - Takes 1 to 500 accounts and refuses an unknown account.
  - Does nothing for an account that already has the requested type.
- **`hq_users_default_view_set(...)`**: owner only, audited, callable only by the service role.

Classification grants and revokes nothing. VERIFY-650 row 6 proves that no other function or policy reads the table. FINGERPRINT-650's ACCESS DIGEST covers auth.users, profiles roles, platform and individual memberships, HQ appointments and competency decisions. It must be identical before and after.

## The evidence-based seed (section 5 of the file)

Accounts are classified only where a repository script provably created them. The match is on the whole address the script writes (anchored, lower case), never on a domain alone. Each row names its source in `source_ref`.

- **Demo**: the 25 exact addresses of the AMU cohort cast list in `scripts/seed-cohort.mjs:77-116`.
  - No migration creates users. `seed-cohort.mjs` is the only creator of `@amu.competen.demo` accounts, and its seed sets no metadata marker.
  - A different address on the same domain stays Unclassified (probe A2).
- **Test**: the fixed addresses, or exact address rules, of the fixture and harness scripts named in the file:
  - `create-test-admin`, `functional-test`, `interaction-test`, `coe-test`, `coe-shift-test` and `workforce-test`;
  - the identity, membership, signup and publication harnesses;
  - the staging fixtures;
  - the acceptance and Scholar harnesses;
  - the disposable HFE fixture student.
- **Test, by marker**: `raw_user_meta_data.synthetic` or `synthetic_automation_account`, which the fixtures write at creation.
  - A user can edit their own user_metadata, so the marker counts only together with a reserved, undeliverable test domain (`.test` or `.invalid`).
  - A marker on any other address stays Unclassified (probe A6). VERIFY-650 reports how many such accounts there are.
- **Not classified**, so they stay Unclassified for review:
  - random-looking self-service sign-ups;
  - accounts with no creating script in the repository;
  - real people that `seed-storyline.mjs` and `seed-skill-scores.mjs` update but did not create;
  - the owner;
  - every account with no evidence.
  - Nobody is classified Human or System by the migration. No System or service account creator exists in the repository.

## Local rehearsal (postgres:17, LOCAL-ONLY-STUB-650 = the minimum of 001/040/178/264/279 and the real 500 owner function)

- **FINGERPRINT-650:**
  1. PRE `0|0|0|0`
  2. apply #1 `1|3|3|1`
  3. apply #2 the same, with identical seed output (2 Demo, 4 Test, 6 audit rows)
  4. ROLLBACK `0|0|0|0`, audit rows kept
  5. re-apply `1|3|3|1`
- **VERIFY-650:** 8/8 true after apply #2 and after the re-apply.
- **ACCESS DIGEST:** identical before and after every probe (`d84c4a02…`).
- **Probes (`LOCAL-ONLY-PROBES-650.sql`):** 30 pass, 0 fail, on a fresh database.
  - **Seed:** cast list is Demo; a domain-only address stays Unclassified; a test domain without a script address stays Unclassified; a random sign-up stays Unclassified; a self-set marker on a real domain stays Unclassified; nobody is Human or System.
  - **Function:**
    - a non-owner, a null actor, a blank reason, an unknown type and a missing account are each refused;
    - two changes give two audit rows with before, after, who, when, reason and trace;
    - re-classifying to the same type changes nothing and audits nothing;
    - Demo to Human is recorded and becomes manual;
    - a direct table write is audited too.
  - **Default view:** default, owner-only, invalid refused, audited change, CHECK.
  - **Red-proofs:** with the trigger disabled a change is not audited (so the trigger is the control); with the owner check planted open a non-owner classifies (so the owner check is the control).
  - **Data preserved:** memberships, appointments, decisions and auth users are unchanged.

## Staging ×2 (for the coordinator)

1. Run FINGERPRINT-650 and record both rows. Expect `0|0|0|0` and an access digest.
2. Apply 650, the whole file. Record the three result sets.
3. Apply 650 again. Expect the same rows and no new audit rows.
4. Run FINGERPRINT-650. Expect `1|3|3|1`, with the **access digest equal to step 1**. Concurrent staging writes by other sessions would change it; if they do, re-run both while nothing else is writing.
5. Run VERIFY-650. Rows 1 to 8 must be true. Record REPORT 1 and REPORT 2.
6. Optional: ROLLBACK-650, then FINGERPRINT (`0|0|0|0`), then re-apply.

## The app without 650

`loadClassifications` answers `available: false` on any read error, so:
- every account reads Unclassified;
- HQ Users opens on All Accounts (today's screen) with a banner;
- the Classify control is hidden;
- the API answers 503 and changes nothing;
- the analytics cards keep their old label and subline.

No server gate is needed beyond the existing owner gate, because nothing is writable without the two functions.
