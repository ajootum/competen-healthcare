# COMP-ENG-002B §8 — `Educator validates assessments` (UPDATE): disposition

**Read-only, 2026-08-19.** §8 asks whether educators validate assessments through an ordinary
RLS-governed client, a server-mediated authorized route, or whether the workflow was superseded —
*"absence is a defect only if the approved workflow still requires that policy and no compensating
enforcement exists."*

## What the policy declares

`supabase/migrations/009-assessment-engine.sql:240`

```sql
create policy "Educator validates assessments"
  on assessments for update
  using (exists (select 1 from profiles p
                 join competency_cycles cy on cy.hospital_id = p.hospital_id
                 where p.id = auth.uid() and p.role = 'educator' and cy.id = cycle_id));
```

An educator may UPDATE assessments belonging to a cycle in their own hospital, through an ordinary
client.

## The decisive measurement

**Nothing in the codebase updates the `assessments` table. At all.**

Every write to `assessments` across `src/` is an INSERT:

| Site | Operation |
|---|---|
| `api/assess/submit/route.ts:110` | `.insert(...)` |
| `api/assessments/route.ts:19` | `.insert(...)` |
| `api/osce/exams/route.ts:133` | `.insert(...)` |

There is **no UPDATE path** — not through an ordinary client, not through the service role. The policy
grants an access route the product does not offer.

## The workflow exists, and it is server-mediated

Educator validation is real and lives at **`src/app/api/educator/ai-validate/route.ts`**, with
enforcement that is *stronger* than the RLS policy would have been:

| Control | Evidence |
|---|---|
| Enters the approved auth boundary | `getCaller()` (line 17) |
| Role check | `isEducator(c)` → `forbidden()` (line 19) |
| **Tenant scope check** | `assertCycleScope(c, cycle_id)` **called** at line 37 — resolves the cycle's `hospital_id` and refuses out-of-scope (`api-auth.ts:161`) |
| Privileged reads server-side only | `c.admin` |
| **Audited** | writes an `audit_log` row with `trace_id` (line 99) |

It validates **`competency_scores`**, reading `assessments` for context. It never updates `assessments` —
which is consistent with there being no UPDATE path at all.

## Disposition: **absence is NOT a defect. Do not restore.**

§8's own test is met in the negative: the approved workflow does **not** require this policy, and
compensating enforcement **does** exist and is stronger.

⚠ **Restoring it would weaken the current posture, not repair it.** It would open a direct client-side
UPDATE path to `assessments` that:

- the application deliberately does not offer,
- **bypasses the `audit_log` row** the server route writes on every validation, and
- relies on `p.role = 'educator'` — a role-name check on `profiles.role`, which ADR-008 has retired as an
  authorization primitive.

**Recommended:** classify as **superseded**. Encode its removal in the eventual canonicalisation as a
deliberate supersession (§6 requires each canonicalisation migration to state what it supersedes), not
as a restoration.

## Pattern note

This is the **second** MISSING policy whose restoration would make things worse, after migration 166's
three (whose `using (true)` grants would have created cross-tenant read exposure). Both point the same
way: **the repository's declarations are older than the architecture**, and a canonicalisation that
replays them faithfully would reintroduce access paths the product has since moved away from.

That is the strongest argument yet for §10's gate — a canonical end state has to be *approved*, not
*derived* from what the migrations happen to say.

**4 of 20 MISSING now have evidence-based dispositions.** No migration written.
