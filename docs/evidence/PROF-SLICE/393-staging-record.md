# COMPETEN-HOLDINGS-SHARED-ENGINES-01, Professional slice: migration 393, staging record

**Authority:** the owner authorised migrations 393–395 to staging. The main session applied 393 from competen-ind-007 with the guarded runner (target ezhvpgtcqcdsgylrxgdb, guard passed). OPS-001 s8 tier: Medium (a new trigger function), so a rollback rehearsal was run.

**Fingerprint tool:** `npx tsx scripts/ind007-staging-schema-check.ts --prof393` (read-only).

| Step | Result |
|---|---|
| PRE (absent) | a153e47971e13849fd40cb0f103cbfc4ab2aeebcb807de24c8f29a724a4764e5 |
| Apply ×2 | both ok. F1 = f82b3dc059705c5953d9f7d03573a15e4e08d95e515f26627a3336b42f5d1d75 |
| Rollback (ROLLBACK-393.sql, a9fef426, run-staging-sql.mjs) | committed. F2 = a153e479… = PRE |
| Re-apply ×2 | both ok. F3 = f82b3dc0… = F1 |

**Files:**
- 393-individual-professional-competency-mapping.sql: sha256 27a845baf6bbe0796d455310a26c03c8dff9487d1841dc8a0ecf5ebed69c6aff
- ROLLBACK-393.sql: sha256 a9fef42689d7877df338cc3d56579cc708d72eee99788b77980f54234e03a691

**Post-state:**
- Two tables, individual_professional_competency_map and individual_professional_competency_decision.
- 12 constraints, 10 indexes and 2 own-row SELECT policies.
- The append-only trigger and its function, individual_professional_decision_append_only.
- Two (id, user_id) unique indexes on individual_professional_cpd and individual_professional_evidence.
- No existing row is changed.

**Dependencies and order:** 393 depends on 373 (the Professional record tables) and on `framework_competencies`. It shares nothing with Scholar's 387–391. It can be applied after 373 in any position relative to 384–392.

**Acceptance on staging** (`individual-professional-acceptance-harness`, 55/55; group K covers 393):
- **K0:** with the allowlist empty, nothing is offered, a link is refused and coverage is Not measured.
- **K1–K3:** a link the person makes is accepted at once. Only offered competencies are allowed, only on the person's own entries, and the composite FK refuses another person's entry.
- **K4:** the schema refuses an AI row without its provenance, a person row with it, and a row with two subjects.
- **K5–K7:** a proposal counts for nothing until the person accepts it, and only the person can decide.
- **K8–K9:** decisions are append-only, and a later decision wins.
- **K10:** deleting an entry cascades through the trigger.
- **K11:** RLS gives a person their own rows only, and they can't write them from the browser.
- **K12:** the allowlist is restored, and links keep their names.

**Production:** not authorised. `main` may carry 393 before production does. Every reader treats the tables as absent until then: they are "not provisioned", so a reader returns no links and the pages hide them. Professional itself stays behind the Individual release gate, and its allowlist is empty.
