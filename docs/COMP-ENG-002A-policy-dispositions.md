# COMP-ENG-002A §7 — Body-level RLS semantic comparison and per-policy dispositions

**Tool:** `scripts/rls-body-audit.ts` (new, version-controlled). Reads deployed `qual`/`with_check` via
`plat_rls_registry()`; parses authored bodies from numbered migrations with balanced-paren extraction and
DROP tracking. **Read-only. No canonicalisation migration written.**

**Owner instruction honoured:** the three `profiles` recursion policies are treated as **UNRESOLVED**, not
intentionally absent; the seven other MISSING as **suspected drift** until provenance proves deliberate
removal.

## Results

| Verdict | Count | Meaning |
|---|---|---|
| EQUIVALENT | **176** | exact match after conservative normalisation |
| EQUIVALENT-MODULO-PARENS | **79** | identical once Postgres's re-parenthesisation is removed |
| RENAMED-ONLY | **25** | same body, different name |
| REVIEW-BODY | **12** | named match, bodies differ textually |
| REVIEW-UNPAIRED | **25** | deployed, pairs with no authored body |
| MISSING-BODY | **20** | authored, no deployed counterpart |

**280 of 317 deployed policies (88%) are semantically confirmed** against the repo.

⚠ **Two tool defects were found and fixed before these numbers were trusted** — both would have
overstated risk. Deleting parentheses welded tokens together (`auth.uid()or` → `auth.uidor`), leaving 88
identical policies in review; parens now become whitespace. And ignoring `DROP POLICY` counted every
historical CREATE as live intent, reporting 73 missing against the existence audit's 10. Both are
documented in the script header.

## THE FIDELITY FINDING — a clean build diverges in *both* directions

§8 asks whether a clean build reproduces production security semantics. **It does not**, and the body
audit now shows the second half of the mechanism:

**Direction 1 — the numbered chain CREATES what production dropped.** `migrations/005` creates
`"Super admin reads all profiles"`; the loose recursion fix dropped it; production lacks it. A clean
build re-creates the RLS recursion.

**Direction 2 — the numbered chain OMITS what production has.** Verified by grep:

| Live policy | Numbered migrations | Actual source |
|---|---|---|
| `course_enrollments :: Users see own enrollments` | **0** | `supabase/schema.sql` |
| `cpd_logs :: Users manage own CPD` | **0** | `supabase/schema.sql` |
| `nurse_competencies :: Users see own competencies` | **0** | `supabase/schema.sql` |

**These protect user-owned data and exist in production only because an unnumbered file created them.**
A staging build from `supabase/migrations/` would have those tables RLS-on with *fewer* policies —
fail-closed, so not a leak, but ordinary users lose access and every test of those flows behaves
differently from production. That is the false assurance §3 describes, in the safe direction.

## Dispositions by category

### REVIEW-BODY (12) — assessed benign; **no change recommended**

All twelve differ by the same three Postgres rewritings, none semantic:

1. outer-table qualification inside subqueries (`cycle_id` → `assessments.cycle_id`)
2. `p.role in ('a','b')` → `p.role = ANY (ARRAY['a'::text,'b'::text])`
3. `FROM a JOIN b ON x` → `FROM (a JOIN b ON (x))`

`assessments :: Assessor views hospital assessments` · `audit_findings :: findings_select_involved` ·
`cycle_frameworks :: Hospital admin manages cycle frameworks` · `osce_candidates`/`osce_exams`/
`osce_results`/`osce_stations` `:: *_select_involved` · `pathway_items :: Nurse reads own pathway items`
· `pathway_items :: Nurse updates own pathway items` · `profiles :: Users update own profile` ·
`skill_scores :: Assessor manages skill scores` · `skill_scores :: Nurse views own skill scores`

**Security impact: none.** Each grants exactly what its declaration grants. **Disposition: retain, no
migration.** ⚠ The normaliser could be taught outer-qualification stripping, but that risks equating
`a.id` with `b.id` — deliberately not done. Twelve is a readable number; a looser tool is not worth a
false EQUIVALENT.

### REVIEW-UNPAIRED (25) — two distinct classes

**(a) Renames whose counterpart is in MISSING-BODY (~14).** `assessment_evidence` (2),
`checklist_responses`, `competency_scores`, `cycle_frameworks`, `domain_scores` (2),
`framework_scores` (2), `policies`, `workflow_templates` — e.g. repo `"Nurse views own competency
scores"` vs live `"Nurse views competency scores"`. Renamed in-database and never written back.
**Security impact: low, pending body confirmation per pair** (they did not body-match, so the rename may
carry an edit). **Disposition: confirm each pair's body, then canonicalise the live name forward.**

**(b) Production-only, created by unnumbered files (~11).** `course_enrollments` (4), `cpd_logs` (2),
`nurse_competencies` (4), `hospitals` (1) — the fidelity finding above. **Security impact: HIGH for
staging fidelity, none for production** (production is correct; the repo is incomplete).
**Disposition: encode forward as new numbered migrations** — this is the clearest canonicalisation case
in the whole gate, and the one that most directly unblocks staging.

⚠ `profiles :: users_read_own_profile` is **not** a rename pair — it stands alone and belongs with the
unresolved `profiles` set below.

### MISSING-BODY (20) — all UNRESOLVED per owner instruction

**`profiles :: Super admin reads all profiles`** (mig 005) — **UNRESOLVED.** Dropped by
`fix-super-admin-rls-recursion.sql` for RLS recursion. ⚠ Do not encode either state until provenance is
established: re-creating it restores a known recursion fault; confirming its absence needs proof the
drop was intended and complete.

**Migration 166 group (3):** `access_reviews`, `access_review_items`, `sod_rules` `:: *_read` —
**suspected partial application of migration 166.** No loose script drops them. **Check 166 first**; if
it did not fully apply, other objects from it may also be absent, which is a larger question than these
three.

**Migration 009 group (~11):** `assessment_evidence` (2), `assessments :: Educator validates
assessments`, `checklist_responses`, `competency_scores` (2), `cycle_frameworks`, `domain_scores` (2),
`framework_scores` (2) — most pair with a renamed live policy (class (a) above), so these are **likely
renames rather than absences**. `assessments :: Educator validates assessments` (UPDATE) has **no live
pair** and is the one to examine: an absent UPDATE policy means educators cannot validate assessments
through an ordinary client.

**Remaining singletons:** `departments :: Group admin reads org departments` (mig 008) ·
`adm_unit_profile :: adm_profile_read` (mig 109) · `op_observations :: op_observations_read` (mig 039) ·
`policies` / `workflow_templates` (mig 007, both pair with live renames). Each **suspected drift**.

## What is still not measured

- **Triggers and storage policies** (§4) — not measured at all.
- **Roles per policy** — `plat_rls_registry()` returns them; this tool does not yet compare them. A
  policy applying to a wider role set than declared is a real risk class and is **not covered**.
- Functions were measured separately: 65/65 bodies match.

## Recommended order

1. **Encode the ~11 `schema.sql`-origin policies forward.** Clearest case, unblocks staging most.
2. **Confirm the ~14 rename pairs body-by-body**, then canonicalise live names.
3. **Investigate migration 166** — one question, three policies.
4. **Resolve `profiles`** — needs the owner and the recursion history, not a tool.
5. **Extend the tool to roles**, then triggers and storage.

**No canonicalisation migration is written**, per instruction.
