# HQ-USERS-B: migrations 382 and 383, staging record

Owner GO 2026-10-23, verbatim: "GO for staging migrations 382 and 383. Apply each twice using the established migration process and verify the resulting schema and capability records. For migration 383, complete the Medium-risk staging rollback and reapplication rehearsal. Verify concurrent reset requests cannot exceed the configured limits."

**Target:** staging only, ezhvpgtcqcdsgylrxgdb. The guard passed on every run. Applied with `scripts/apply-migrations.ts --only 38x` from competen-ind-007. The rollback ran with `run-staging-sql.mjs`.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --reset` (read-only).

| File | sha256 |
|---|---|
| 382-hq-chief-executive-users-view.sql | 958d96cba099c00e3b126fe562c4adb3609e20f6a4094ae434242626fde36073 |
| 383-hq-password-reset-reservation.sql | a9f5f0ed62e57474aec13cbbd70293c482cabe55384a3b2220dd6427e52272ec |
| ROLLBACK-382.sql | 8ccdd7d52dfaec23da6e8a05f3a881666021c0c3837b9c6bf066304357ffe516 |
| ROLLBACK-383.sql | 51f7c523482b90d5d98b34e6f0e119af37c33349fbc850aeaf6b4a893aeeb03e |

## 382 (Low)

**Before:** chief_executive held 10 open grants, including hq.platform.users.reset and not users.view.

**After two applications:** 11 open grants, now including hq.platform.users.view. No duplicate open grant anywhere in the catalogue. No account-write capability was added.

## 383 (Medium): rollback rehearsal

| Step | Fingerprint |
|---|---|
| Pre-state (function absent) | 15c5675d50beeb4b477b8a36560c3859575c88349fdbcd3c347afad2eff54737 |
| F1, after applying twice | ac47f3b4cb6b6b36c471c339698e495298761b0b6a0521df37d09a61bf60468a |
| F2, after ROLLBACK-383 | 15c5675d50beeb4b477b8a36560c3859575c88349fdbcd3c347afad2eff54737 (= pre-state) |
| F3, after re-applying twice | ac47f3b4cb6b6b36c471c339698e495298761b0b6a0521df37d09a61bf60468a (= F1) |

Function state at F1 and F3:
- prosecdef false;
- search_path=public;
- definition md5 ffdbe09eba2f289d618f791dee8382d4;
- EXECUTE held only by postgres and service_role.

## Acceptance (`hq-users-reset-acceptance-harness`, `--staging --only`, HTTP, HQ_OWNER_FIXTURE_GO under the owner GO): 22/22

- **L3:** 8 simultaneous requests for one person: exactly 3 reserved, all answered neutrally.
- **L4:** 25 simultaneous requests by one administrator: exactly 20 reserved, exactly 5 refused (429).
- **L1 and L2:** the seeded per-person and per-administrator limits hold.
- **C0–C3:** the Chief Executive holds users.view and users.reset, opens the directory with no owner-only controls, makes a permitted reset, and is refused (403) suspend, role change, create and delete.
- **O1 and O2:** a super-admin account is refused to the Chief Executive (neutral, owner_target audited) and passes the owner rule for an owner. The temporary owner was then retired (Z0): no roles, no membership, banned, its old session refused.
- **M1–M3, PEND:** Supabase rejects the reserved .test fixture address, so no mail is sent from staging.

**Planted control:** the reservation was replaced, in application code, by the old count-then-insert. It reserved 7 of 8 (limit 3) and 24 of 25 (limit 20), so L3 and L4 went red. That proves the race is real and that the function closes it. The code was restored.

**Production:** not applied. Each migration needs a separate owner GO.
