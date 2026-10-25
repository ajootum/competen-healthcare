# Migrations 460–464 (Competen Learning): staging record

**Authority:**
- Owner GO "COMPETEN-LEARNING-01 Phase 2 — Implementation & Staging" (25 October 2026): development, staging migrations, integration and staging acceptance. Production, real charging and activation need separate GOs.
- Owner continuation: "Accept the successful staging application and integrity checks for migrations 460–464 ... commit and continue the existing Learning implementation."

**Who and where:** the coordinating session applied the package on 25 October 2026 to staging project ezhvpgtcqcdsgylrxgdb. Order: 460, then 461 (after CKRI 442, already applied and frozen), then 462, 463 and 464. **Never production.**

**OPS-001 s8 tiers:**
- 460, 462 and 464: Low.
- 461: Medium. It replaces the shared 395 review guards and the subject CHECK, carrying 442's competency, case and resource branches byte-identical.
- 463: Medium. It widens `individual_checkout`.

## Fingerprints (coordinator; learning, checkout, clinical and HQ objects, buckets excluded)

| Step | Result |
|---|---|
| PRE | 5f5ae8b2ea115bae4c4a597f7a385264 (117 items) |
| First apply ×2 (the earlier 462/463) | c65c4917… (423). The revised 464 was swapped in through ROLLBACK-464, then the new file ×2: c65c4917 again. |
| Corrected rollback 464 → 460 | Every step "Done", none refused. **F2 = 5f5ae8b2… = PRE exactly.** |
| Apply the CURRENT 460–464, each ×2 | **F1 = 01e0dc0724469c0872674817e4a55b80 (418).** It is lower than 423 because the governance actor FKs are gone. |
| Third apply of all five | 01e0dc07… (418): idempotent |

**VERIFY-460-464.sql: every expectation met.**
- 11 tables, RLS on; 0 rows; four review kinds; the resource and learning guard branches present.
- `individual_checkout` columns as designed; the experience CHECKs unchanged.
- 8 functions, service-role only.
- 4 capabilities, 4 positions, 8 grants, 0 appointed.
- 2 private buckets; both live views `security_invoker`.

The coordinator also diffed 461's guards against the frozen 442 bodies independently: the ONLY change is the added learning branch.

## Files (committed byte-identical to what was applied)

| File | sha256 |
|---|---|
| 460-learning-offering-catalogue.sql | 4a5ba91ea3d374e950221d33e01159aa129730a4607af832c2b43729f5341aec |
| 461-learning-on-clinical-approval.sql | 74544e0ebecf8b02d35c1affc9134ff0282c5d815b70ef2d64e2b0e9abce5511 |
| 462-learning-record.sql | 83ae6daa8d3e4c94cbe66b77d7d7a044974228682b68b8f3d1149912443f7b62 |
| 463-learning-course-commerce.sql | 252afd6c99a8eccefe9af4f5ec19943d68291ca787f0c75a44e78d5e3c56f614 |
| 464-learning-capabilities.sql | a0b44736e2a74c2b769cf50e944fc5fc62b0fcc85ed3eaf7da885da861a5837e |
| ROLLBACK-460.sql | 8fd36a19aca5fb45836c72a791243bf900b28e8631114d7cce45161ed77b41df |
| ROLLBACK-462.sql | cb622d60c4c244daadfeb932ff898f36569a7b2273516b440260d78eaed4feeb |

ROLLBACK-461, 463 and 464 and VERIFY-460-464 are in this folder, unchanged from the package.

## ⚠ Buckets after any rollback

ROLLBACK-460 and ROLLBACK-462 do **not** delete the `learning-content` and `learning-evidence` buckets, because Supabase refuses SQL deletes on `storage.*`.
- Each script refuses while its bucket holds any object.
- After a rollback, **a person removes each empty bucket through the Supabase Storage API or the dashboard.**
- A bucket holding files is never deleted automatically.
- An empty bucket left behind is inert: private, with no policies.

## Local proof before staging

On a throwaway Postgres 17, over stubs plus the real 370, 395, 399, 422 and 442 §4:
- 460–464 applied twice;
- **63/63** planted-failure assertions in LOCAL-TEST-460-464.sql (destructive: never run it on staging);
- the rollback fingerprint was identical with buckets excluded, re-applying passed, and each rollback refused once records existed.

**Defects found and fixed before staging:**
- a Postgres regex repetition over 255;
- a CHECK that passed on NULL;
- governance actor FKs that would block account deletion;
- an HQ seed the hq-guard parser could not read;
- SQL bucket deletes, which only staging refuses.

**430 (portable clinical hash, staging-held):** independent of 461. Its provenance CHECKs allow NULL, and 461 neither sets nor restates them, nor touches the import functions or `competency_content_hash`.
