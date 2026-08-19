# COMP-ENG-002G §7/§8 — first column-parity measurement

**2026-08-19.** production `rnnqhlrcgvsauigxwszl` vs canonical staging build `ezhvpgtcqcdsgylrxgdb`,
both read through `plat_column_registry()` (migration 337).

```
production: 663 tables, 7884 columns
staging   : 663 tables, 7859 columns
EXACT     : 7853
FAIL — 32 unexplained differences, 6 on security-relevant columns
```

**Table parity was already perfect — 663 against 663 — and 32 columns still differed.** That is the
argument for this gate, made by the gate itself on its first run.

## MISSING_IN_STAGING — 26 columns, on 9 tables

`competency_scores` (7), `frameworks` (6), `framework_scores` (4), `domain_scores` (4),
`competency_cycles` (4), `hospitals` (2)

**All 26 are added by no migration in the repository.** This is the same class as the nine foundational
tables, the eleven orphan tables and the two `audit_log` columns — production carries schema the
repository cannot rebuild. §8 calls this "normally FAIL", and it is.

⚠ **Two of the 26 first looked like they WERE in migrations, and both were my grep, not the estate.**
`competency_cycles.completed_at` matched `op_handovers` and `pathway_items`; `hospitals.logo_url`
matched migration 008's `alter table organisations`. **Neither grep was table-scoped.** The same
mistake as the missing `public.` qualifier earlier in this arc — the third time this session that an
untrustworthy instrument nearly became a reported fact.

## REWORKED — 5 columns, and 4 of them mean the clean build is WEAKER

| Column | Production | Canonical build | Reading |
|---|---|---|---|
| `audit_log.action` | **NOT NULL** | NULL | a clean build accepts an audit row with no action |
| `audit_log.entity_type` | **NOT NULL** | NULL | same |
| `profiles.roles` | default `'{}'` | **no default** | new rows get NULL, not an empty array |
| `profiles.org_roles` | default `'{}'` | **no default** | same |
| `frameworks.pub_status` | default `'published'` | default `'draft'` | ⚠ **owner decision** |

⚠ **`profiles.roles` is an authorization column, and NULL is not `{}`.** Migration 249's
`profile_authority_unchanged` compares with `is not distinct from` precisely because these columns are
null on most rows — so the difference does not throw, it changes what compares equal. Code doing
`.includes()` on a null array does throw.

⚠ **`frameworks.pub_status` is the one genuine judgement call.** The repository says new frameworks
default to `draft`; production defaults to `published`. **Defaulting to published is the less safe
posture**, and the repository's value looks like the intended one — but changing a live default is a
product decision, not a reproducibility fix.

## MISSING_IN_PRODUCTION — 1 column, and it is a PRODUCTION gap

`cap_asset_translations.cap_asset_id` — the canonical build creates it, production has no such column.

Migration 140 adds `cap_asset_id` to four tables under `alter table if exists`. Measured in production:

| Table | exists | has `cap_asset_id` |
|---|---|---|
| `object_tags` | yes | **yes** |
| `competency_package_items` | yes | **yes** |
| `knowledge_embeddings` | yes | **yes** |
| `cap_asset_translations` | yes | **NO** |

Three of four. The table exists now, so the guard is not currently the cause — **it was at the time**.
`alter table if exists` is a silent no-op against an absent table, migrations here are applied by hand
and this repository already records that they are sometimes applied out of order. 140 running before
137 created the table would produce exactly this: no error, no record, one column silently never added.

**A deterministic clean build is the only thing that could have surfaced this**, because it is the only
run where the order is guaranteed. `cap_asset_translations` is written by
`src/app/api/studio/translations/route.ts`.

## Proposed disposition — NOT yet applied

§10: "No column divergence may be silently repaired before measurement/classification." Measurement and
classification are now done; nothing has been changed.

| Finding | Proposal |
|---|---|
| 26 MISSING_IN_STAGING | add to the canonical build, on the same ruling as 188a — reproducing is not endorsing, and retiring schema is not what a reproducibility fix is for |
| `audit_log` ×2, `profiles` ×2 | fix the migration so the build stops being weaker than production |
| `frameworks.pub_status` | **owner decision** — which default is correct |
| `cap_asset_translations.cap_asset_id` | a forward migration adding it to **production** |

⚠ **None of these should be resolved by changing production to match a build that was wrong.** The
build is wrong in 30 of the 32 cases.
