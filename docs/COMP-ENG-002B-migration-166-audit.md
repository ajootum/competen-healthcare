# COMP-ENG-002B §7 — Migration 166 full-object audit

**Read-only, 2026-08-19.** Every object migration `166-access-governance.sql` declares was measured, not
just the three policies flagged as MISSING (§7: *"Do not investigate only the three missing policies"*).

## Result

| Object class | Declared | Present | Verdict |
|---|---|---|---|
| Tables | 4 | **4** | `access_reviews`, `access_review_items`, `sod_rules`, `sod_exceptions` |
| Indexes | 4 | **4** | all present (`plat_index_registry()`) |
| RLS enablement | 4 | **4** | all `on` |
| Policies | 4 | **1** | `sod_exceptions_read` present; the other three absent |
| Functions / triggers / types / grants | none declared | — | 112-line migration; it declares none |

## ⚠ It was NOT a partial application

The suspicion was that migration 166 stopped part-way. **The evidence rules that out:**

- **Structure is 100% present** — every table, index and RLS enablement landed.
- **The policy that survived is the LAST statement in the file** (line 110). The three that are absent are
  at lines 104, 106 and 108 — *before* it.

Execution stopping mid-file would leave everything *after* the stopping point missing. Here the final
statement landed and three earlier ones did not. That is the opposite pattern.

All four are also **structurally identical**:

```sql
create policy <name> on <table> for select to authenticated using (true);
```

So no per-statement failure explains it either — there is nothing about the first three that would fail
where the fourth succeeds.

**And nothing in the repository drops them.** Searched every `.sql` under `supabase/`: no `drop policy`
for `access_reviews_read`, `access_review_items_read` or `sod_rules_read` outside migration 166's own
idempotent drop-then-create pair.

**Conclusion: the divergence arose outside the repository.** Something removed three policies after the
migration ran, and it was not tracked SQL. **Provenance is not established, and this audit does not
guess it** — consistent with the standing instruction to treat absence as unresolved.

## ⚠ The more interesting finding: the surviving policy is the one to question

`using (true) to authenticated` grants **every authenticated user** read access to the table, **with no
hospital or tenant scoping whatsoever**.

- The three **absent** policies would have exposed `access_reviews`, `access_review_items` and
  `sod_rules` — access-governance and separation-of-duties data — **across every tenant**, to any
  signed-in account.
- The one **present** policy, `sod_exceptions_read`, does exactly that **today**.

So the security impact runs opposite to the intuition that missing policies are the problem:

| | Impact |
|---|---|
| **Absence of the three** | **Fail-closed.** Those tables are service-role-only, so the feature is broken for ordinary clients — but nothing leaks. |
| **Presence of `sod_exceptions_read`** | **Cross-tenant read exposure** of SoD exception data to any authenticated user, live now. |

⚠ **Re-creating the three policies to "restore" migration 166 would introduce three new cross-tenant
read exposures.** That is precisely the outcome COMP-ENG-002A §6 forbids — replaying declared intent
without asking whether the intent was right.

## Recommended dispositions

| Policy | Disposition |
|---|---|
| `access_reviews_read` | **Do not restore as written.** If the feature needs client reads, author a *tenant-scoped* replacement. Provenance of the removal remains unresolved. |
| `access_review_items_read` | Same. |
| `sod_rules_read` | Same. |
| `sod_exceptions_read` | ⚠ **Review for removal or tenant-scoping.** It is live, unscoped, and inconsistent with the other three regardless of how they came to be absent. |

**Whoever removed the three may have been fixing exactly this problem and missed the fourth.** That
reading is consistent with every measurement here — but it is a hypothesis, not provenance, and it is
recorded as such.

## What this does to the canonical end state

§10's gate requires all 20 MISSING to have an evidence-based disposition. **Three now do**, and their
disposition is *not* "re-create". It also removes migration 166 from the "suspected partial application"
column of the reconciliation matrix — the migration applied; something later diverged from it.

**No migration written.** §10 remains unmet: policy bodies and roles are measured, 166 is audited, but
the remaining 17 MISSING, triggers and storage policies are not.
