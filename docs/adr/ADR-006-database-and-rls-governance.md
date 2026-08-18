# ADR-006 — Database & RLS Governance

**Status:** Accepted
**Enforced by:** `scripts/migration-house-rules.ts`; append-only trigger pattern (`pg_trigger_depth() > 1`
cascade allowance); typed-parent CHECK pattern for polymorphic references

## Context

Every schema change in this codebase is a hand-applied migration, applied by the repository owner
directly in the Supabase SQL editor — there is no automated migration runner in CI or in an agent's
hands. This makes two things load-bearing: the migration file must be correct and complete *before* it's
handed over (there's no fast "oops, patch it" cycle), and it must survive being pasted into a SQL editor
that splits naively on `;` if the file's own construction doesn't guard against that.

Separately, this codebase has repeatedly discovered the same two schema bugs in different tables: (1) an
append-only trigger that refuses every `DELETE`, including the cascade from a parent being deleted,
leaving a child row that can never be removed by anyone; and (2) a polymorphic reference (a `type` column
plus a bare `uuid`, no foreign key) that can't cascade and can't be validated, leading to orphaned or
mislabeled rows.

## Decision

- **Every migration passes `scripts/migration-house-rules.ts` before being sent to the owner.** This
  checks: ASCII-only (no smart quotes or em-dashes that survive copy-paste badly), no semicolon inside a
  comment (the owner's runner splits on `;` literally), no partial unique indexes, `notify pgrst, 'reload
  schema';` as the final statement, and an `APPLY THIS FILE WHOLE` banner in the first 15 lines for any
  file containing `$$`, `plpgsql`, or `create or replace function`.
- **Append-only tables allow a `DELETE` only when it arrives via cascade**, checked with
  `pg_trigger_depth() > 1` in the trigger function — a direct `DELETE` is refused, a cascading one from a
  deleted parent is allowed. This is now the standard shape for any new append-only trail; it should be
  used from the start, not discovered again after a fixture proves the trail can't be cleaned up.
- **A reference that could point at more than one kind of parent is typed, not polymorphic.** Several
  nullable foreign keys (one per possible parent type) plus a `CHECK` that exactly one is set, rather than
  a `record_type` text column plus a bare `uuid`. This is what makes the reference both cascadable and
  validated at the database level.
- **Prefer making an invalid state unrepresentable over enforcing a rule only in application code.**
  Where practical, omit a column a service layer would otherwise use to encode a derived fact (a status
  flag, a cached score) and derive that fact at read time instead — a `NOT NULL` constraint or a missing
  column that a service layer would need in order to violate a rule is a rule that survives being
  forgotten by a future author; a comment asking nicely does not.

## Consequences

- A migration that fails `migration-house-rules.ts` is not ready to send, regardless of how confident the
  SQL looks.
- A new append-only table needs the cascade-allowance trigger from day one if anything will ever
  reference it with `ON DELETE CASCADE` — retrofitting it after the first orphaned row is discovered is
  the expensive path, and this codebase has taken that expensive path more than once.
- A new polymorphic-shaped relationship (this record can belong to one of several kinds of thing) should
  default to typed nullable foreign keys with an exactly-one `CHECK`, not a type-tag-plus-uuid pair.

## Do not

Do not hand a migration to the owner without running `migration-house-rules.ts` first. Do not build a new
append-only table without the cascade-depth allowance if it will ever have a child. Do not model "this
belongs to one of several kinds of parent" as a bare `uuid` plus a type string when a small number of
typed nullable foreign keys would do.
