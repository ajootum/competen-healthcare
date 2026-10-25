# Migration 491: reflections on learning, and sharing chosen learning (build record)

**Owner GO:** COMPETEN-PROFESSIONAL-LCPD-01, Stage 4 (LCPD-3, LCPD-4, LCPD-6). Development, integration and staging are authorised. Production needs a separate owner GO.

**State:**
- **APPLIED and verified on staging** (ezhvpgtcqcdsgylrxgdb), ×2 with the rollback rehearsed: see `491-staging-record.md`. Committed byte-identical.
- **Staging fingerprint:** PRE empty/0, F1 = F2 = 5849f02e/12, rollback = PRE (490 and 470 unchanged), re-apply = F1.
- **Production:** not applied. It needs its own owner GO.

**Depends on:**
- 470 (`individual_professional_reflection`), now on staging, main and production (the owner applied it on 25 Oct).
- 373 and 393 (CPD and its `(id, user_id)` key), 453 (`individual_professional_share`) and 462 (`learning_record` and its key).

**Independent of 490.**

## What it adds

| Table | What it is | Why it can't go wrong |
|---|---|---|
| `individual_professional_learning_reflection` | A private reflection (Stage 2's own row, written by Stage 2's `saveReflection`), linked to ONE CPD entry or ONE learning record, with the impact the person reports: completed, understood or applied | **Exactly one subject** (CHECK). Impact is **completed, understood or applied only**: there is no value for "verified", so verified practice impact cannot be self-reported. Composite FKs keep everything the same person's. It goes with its reflection, CPD entry or learning record. Own-row read. |
| `individual_professional_share_learning` | The completed learning records a person ticked for ONE Passport link | Composite FKs to the person's own link (453) and learning record (462). None by default. Own-row read. **No path for reflections.** |

There are no scope columns and no plpgsql.

## Files (LF, ASCII)

- `supabase/migrations/491-professional-learning-reflections-and-sharing.sql`
- `ROLLBACK-491.sql`: drops only the two link tables. Reflections, CPD entries, learning records and links all stay.
- `VERIFY-491.sql`: A read-only, 4 true; B in a transaction that ends in ROLLBACK, 7 PASS.
- `FINGERPRINT-491.sql`

## Local proof (PG17)

| Step | Fingerprint | Items |
|---|---|---|
| PRE | `d41d8cd9…` (empty) | 0 |
| apply #1 | `5849f02e…` | 12 |
| apply #2 | `5849f02e…` | 12 |
| rollback | `d41d8cd9…` | 0 |
| re-apply | `5849f02e…` | 12 |

**VERIFY B, all PASS:**
- a reflection on one CPD entry, impact "applied";
- "verified" is refused;
- a second subject is refused;
- another person can't attach;
- the link goes with its CPD entry, and the reflection stays;
- a shared item needs the person's own link and record.
