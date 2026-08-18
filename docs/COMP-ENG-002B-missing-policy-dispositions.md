# COMP-ENG-002B §9.3 — Dispositions for the 20 MISSING policies

**Read-only, 2026-08-19.** Each disposition is evidence-based per §9; nothing is presumed intentional.
**No canonicalisation migration written.**

## Summary

| Class | Count | Disposition |
|---|---|---|
| Unscoped `using (true)` — restoring creates exposure | 5 | **Do not restore as written** |
| Superseded by a server-mediated route | 1 | **Do not restore** — encode removal as supersession |
| Renamed in-database, body preserved | ~11 | **Adopt the live name forward** |
| Genuinely absent, properly scoped | 1 | **Real functional gap** — see below |
| Unresolved, owner decision | 1 | `profiles :: Super admin reads all profiles` |
| Repo declares RLS for a non-existent table | 2 | `products`, `practice_practitioner_profile` — declaration is stale |

## ⚠ The systemic finding: `using (true) to authenticated` appears 139 times

Measured across numbered migrations: **139 policies are declared
`for select to authenticated using (true)`** — read access for *any signed-in account*, with **no tenant,
hospital or ownership predicate whatsoever**.

That pattern is **correct** for reference and catalogue data (scoring scales, form templates, AI
configuration) and **wrong** for tenant-scoped operational or clinical data. Both kinds are in the list.

⚠ **This reframes the MISSING set.** Five of the twenty are absent instances of this pattern, and their
absence is the *safe* state:

| Policy | Table holds | If restored |
|---|---|---|
| `op_observations_read` | **clinical observations** | ⚠⚠ every authenticated user reads all clinical observations, all tenants |
| `access_reviews_read` | access-governance records | cross-tenant read |
| `access_review_items_read` | access-review detail | cross-tenant read |
| `sod_rules_read` | separation-of-duties rules | cross-tenant read |
| `adm_profile_read` | unit profile (no other policy on the table) | cross-tenant read |

**`op_observations` is the most serious**: clinical data, and `using (true)` grants it to any signed-in
account regardless of hospital.

⚠ **A full classification of all 139 is NOT done.** Which are legitimate reference data and which are
tenant-scoped is a per-table judgement and a substantial piece of work. What is established: the pattern
is widespread, it is inappropriate in at least the cases above, and **the canonical end state cannot be
derived by replaying declarations that use it.**

## Per-policy dispositions

### Do not restore as written (5)

The five above. **Recommended:** if the feature needs client reads, author a *tenant-scoped* replacement;
otherwise leave the table service-role-only. Provenance of each removal remains unestablished — but
provenance no longer decides the action, because restoring is wrong either way.

### Superseded (1)

`assessments :: Educator validates assessments` — nothing in the codebase updates `assessments`; the
workflow lives at `api/educator/ai-validate` with `getCaller` + `isEducator` + `assertCycleScope` + an
audit row. Full analysis: `docs/COMP-ENG-002B-educator-validation-policy.md`.

### Renamed in-database, body preserved (~11)

Migration 009's family, renamed to shorter names and never written back. **Confirmed exemplar:**

- repo `checklist_responses :: "Assessor manages checklist responses"`
- live `checklist_responses :: "Manage checklist responses"`
- bodies **semantically identical** (`exists (select 1 from assessments a where a.id = assessment_id and (a.assessor_id = auth.uid() or exists (... p.role in ('educator','hospital_admin','super_admin'))))`)

Same shape across `assessment_evidence` (2), `competency_scores` (2), `cycle_frameworks`,
`domain_scores` (2), `framework_scores` (2), `policies`, `workflow_templates`.

**Disposition: adopt the live names forward.** ⚠ Each pair should be body-confirmed individually before
canonicalisation — `npx tsx scripts/rls-body-audit.ts --table <name>` prints both sides. One exemplar
confirmed is not eleven confirmed, and this document does not claim otherwise.

⚠ These bodies also rely on `p.role in ('educator','hospital_admin','super_admin')` — role-name
authorization that **ADR-008 has retired**. Canonicalising them forward re-commits to a primitive the
architecture is migrating away from. That tension needs an owner decision, not a mechanical copy.

### Genuine functional gap (1)

`departments :: Group admin reads org departments` — **properly scoped**:

```sql
hospital_id in (select h.id from hospitals h join profiles p on p.id = auth.uid()
                where p.role = 'group_admin' and h.organisation_id = p.organisation_id)
```

Unlike the five above, this grants only an organisation's own departments to that organisation's group
admins. Its absence means group admins cannot read org departments through an ordinary client —
fail-closed, but a real functional gap if that path is still expected. `departments` retains two other
policies, so the table is not unprotected.

**Disposition: candidate for restoration** — the only one in the set. ⚠ It also uses a role-name check
(`p.role = 'group_admin'`), so restoring it verbatim conflicts with ADR-008; a capability-based
equivalent is the better forward form.

### Unresolved (1)

`profiles :: Super admin reads all profiles` — held UNRESOLVED per instruction. Restoring re-creates the
documented RLS recursion; confirming its absence needs provenance neither the repo nor the database
supplies.

### Stale declarations (2)

`products` (mig 105) and `practice_practitioner_profile` (mig 217) — the repo declares RLS for tables
that **do not exist**. Nothing to restore; the declaration is the error.

## What this means for §10

**All 20 now have an evidence-based disposition**, satisfying that clause of the canonicalisation gate.
The conclusion is uncomfortable but consistent: **only one of the twenty should be restored as written.**

Three independent lines of evidence now say the same thing — the repository's declarations are older
than the architecture:

1. Migration 166's grants would create cross-tenant exposure.
2. The educator policy grants a write path the product removed.
3. The 009 family encodes role-name authorization ADR-008 retired.

**§10 remains unmet:** triggers and storage policies are still unmeasured, and the canonical end state
must be *approved*, not derived.
