# Migrations 465 and 466: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), with the guarded runner, each file applied whole.
- FINGERPRINT-465-466, VERIFY-465 and VERIFY-466 part A ran with the read-only runner.
- VERIFY-466 part B (DO block inside begin…rollback) ran whole with the notice runner.

| File (LF, 0 CR) | sha256 |
|---|---|
| 465-competency-author-capability.sql | 1e04e6a9bbbf275fdd6a3c197d6f2fd7abf1429847edb2c508e6704a219831f9 |
| 466-cfca-publication-requires-clinical-approval.sql | 0685b6358d29737bdc9266369efcdbaa1ab5eb213fc01674e3968f98185e64a0 |
| ROLLBACK-465.sql | 99907de4ea2035c3842dd339fc115882e395514fb434c86e956f5edf091252be |
| ROLLBACK-466.sql | af33156ba3dd0abeaeff8d196c2aec11d0fa2665edaabdd64c089dfa8e54c6eb |
| VERIFY-465.sql | 82e8da65c6e58ed94f533ac436a5de800789d971de33610abf9117e32abe7b13 |
| VERIFY-466.sql | 98baaee23d7472d2f55206ec73c7e41f71309eeccad5627790e98f5fe000cff9 |
| FINGERPRINT-465-466.sql | 591d957d4c54cf22c666caa1c7c57d5c9f58412fb0942675d373f495765a6c40 |

## Step 0: the superseded 438 removed from staging

438 had been applied ×2 on staging earlier the same day; see `notes/438/438-staging-record.md`. It added the same capability with a different position, `competency_curator`. Before this run:
- ROLLBACK-438 was applied.
- The fingerprint over all HQ capability, position and grant rows returned to **b62dfec5a588ae252c826ccd7c7ecc5b, n=201**, the pre-438 state exactly.
- 438 is now **superseded and absent from staging**. It is not to be committed.

## 465 and 466

| Step | 465 (md5, items) | 466 (md5, items) |
|---|---|---|
| PRE | d41d8cd9… (empty), 0 | d41d8cd9… (empty), 0 |
| Apply #1 | 7e949ae3925f109e6e67444c7b7c1a19, 4 | 98bba20a4973b48857f29994a5624f58, 3 |
| Apply #2 | 7e949ae3…, 4 (idempotent) | 98bba20a…, 3 (idempotent) |
| ROLLBACK-466, then ROLLBACK-465 | empty, 0 = PRE. All HQ rows: b62dfec5, n=201 = pre-438/465 | empty, 0 = PRE |
| Re-apply. **The current staging state.** | 7e949ae3…, 4. All HQ rows: 31236bc37d27c0408834ee425fd6cbe2, n=205 | 98bba20a…, 3 |

**VERIFY-465** (after apply #2 and after the re-apply): all 6 checks true.
- The capability exists, and so does the position.
- It is granted to no existing position.
- The position holds exactly author + home.
- It carries no clinical approve or publish right.
- Nobody is appointed.

**VERIFY-466:**
- **Part A:** all 3 true (the predicate, the guard function and the trigger on frameworks).
- **Part B:** 6/6 PASS.
  - A draft with an unapproved competency exists.
  - Publishing a CFCA framework with an unapproved competency is refused.
  - The review and approval states are not blocked.
  - A layered framework that owns no competencies is not blocked.
  - An unlayered shared framework is unchanged.
  - The predicate is false for unapproved content.
- It left no rows behind: 0 frameworks named VERIFY-466.

## Production impact of 466 (read-only, production, 25 Oct 2026)

- Production has 15 shared frameworks, and all 15 are unlayered (`competency_layer` null). 466's trigger therefore applies to none of them.
- It will only govern CFCA-layered frameworks authored from now on, such as CF-FOUND.
