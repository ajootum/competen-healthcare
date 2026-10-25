# Migration 490: flexible CPD recording, correction history, and the CPD setting (build record)

**Owner GO:** COMPETEN-PROFESSIONAL-LCPD-01, Stage 4 Learning & CPD (LCPD-2 and LCPD-5). Development, integration and staging are authorised. Production needs a separate owner GO.

**State:**
- **Authored.** Proven locally on PG17 against a 373-shaped CPD table.
- **Next:** staging ×2 by the coordinator.
- **Production:** not applied.

**Numbers:** 490–499 belong to Stage 4.

**Depends on:** 373 only, and changes no existing row value. The `(id, user_id)` key that Stage 3 references already exists, from 393.

## What it changes, and why

| | Before (373) | After (490) | Owner |
|---|---|---|---|
| Activity types | a CHECK listing 9 types | a code shape (`^[a-z][a-z0-9_]{1,40}$`). The configured list is enforced by the application. | LCPD-2: workplace learning, mentorship, quality improvement, reflective practice, "other configurable development activities" |
| Hours | NOT NULL, > 0 | optional, still > 0 and ≤ 1000 when given | LCPD-2: "require only a meaningful activity description and occurrence date" |
| CPD points | integer | `numeric(6,1)`: credits like 0.5 | LCPD-2: optional CPD credits |
| Corrections | overwritten | `individual_professional_cpd_history` by trigger, append-only, own-row read, goes only with its entry | LCPD-2: "subsequent corrections with appropriate history" |
| Requirement followed | none | `individual_professional_cpd_setting` (requirement code, cycle start), own row | LCPD-5 |

The recording date (`created_at`) and the activity date (`activity_date`) were already separate. No scope column is added (owner ruling D1).

## Files (LF, ASCII)

- `supabase/migrations/490-professional-cpd-flexible-recording.sql` (APPLY WHOLE: two plpgsql trigger functions)
- `ROLLBACK-490.sql` (APPLY WHOLE). **It refuses to run** once any entry uses a 490-only shape, because restoring 373 would reject those rows. Fix forward then.
- `VERIFY-490.sql`: A read-only, 6 true; B behaviour in a transaction that ends in ROLLBACK, 10 PASS.
- `FINGERPRINT-490.sql`: PRE / F1 / F2 / rollback / re-apply.

## Local proof (PG17, scratch database)

- **Apply ×2:** clean. An existing 373-shaped row still passes.
- **VERIFY-490 A:** 6/6 true.
- **VERIFY-490 B:** 10/10 PASS.
  - A configured type with no hours is accepted, and a non-code type is refused.
  - Hours of 0 are refused.
  - Two corrections leave two history rows; a no-content change leaves none.
  - History holds the earlier version, can't be changed or deleted directly, and goes with its entry.
  - A cycle start needs a requirement.
- **Rollback:** clean, and `hours` is NOT NULL again.
- **Re-apply:** clean.
- **Rollback is refused** once an entry has no hours.

## The application, until 490 is applied (fail closed)

`lcpdSchemaReady` probes 490's own table:
- **Absent:** 373's rule stands (the nine types, hours required, whole points). The requirement section says "not available on this environment yet". No correction history is shown.
- **Present:** the configured types, optional hours and decimal credits.
