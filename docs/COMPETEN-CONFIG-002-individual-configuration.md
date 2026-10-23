# COMPETEN-CONFIG-002: Individual configuration administration (build record)

Owner GO 2026-10-23, relayed by the main session. This record covers items 1 and 4 to 8 (IND-007's share).

It ships as three PRs:

| PR | Branch | Items | Migration |
|---|---|---|---|
| P0 | `ind-007/config-published-frameworks` | 1: published frameworks only | none |
| Policy | `ind-007/config-individual-policy` | 4-7: engine, capability, admin page, versions/limits | **376** (data only) |
| Suggestions | `ind-007/config-taxonomy-suggestions` | 8: profession and registration-body suggestions | none |

Nothing here is merged, deployed, applied to production or activated. `individual_app` is not touched by any of it (item 3 is owner-only).

## 1. Published frameworks only (P0)

The Professional framework list, and the check before any write, require `hospital_id is null`, `is_active` and `pub_status = 'published'`.

Existing links keep their names (`referenceNames` is unchanged), so a person's record is not rewritten.

**Owner flag:** all 14 shared frameworks on staging are `draft`. The staging picker is empty until one is published.

## 2. The engine (item 4): WCE, extended, not forked

The Workspace Configuration Engine (migration 076) holds the Individual policy with no schema change.

**Where it lives.** `workspace_config_overrides`, at `scope_type = 'platform'`, `scope_ref = 'individual'`, one row per policy at `config_path = 'individual.policy.<key>'`. Versions and the trail are `workspace_config_versions` and `workspace_config_audit`.

**Why a separate `scope_ref`.** The super-admin WCE door pins platform scope to `scope_ref = 'platform'`, and publish and rollback act on a whole scope. A shared partition would let either door sweep the other's drafts into its version. Two partitions make that impossible.

**One writer.** The set, reset, publish and rollback logic moved unchanged out of `/api/platform/workspace-config` into `src/lib/config/workspace-config-write.ts`. The super door calls it with identical behaviour. The Individual door calls it with two additions:
- `rollbackVersion(..., { scope })` refuses a version from another scope.
- `prune` makes a rollback exact: a policy set after that version returns to its default.

**Reset is immediate.** As in WCE today, "Use default now" deletes the override, published value included. It is in the trail.

## 3. The capability (item 5): migration 376

- `hq.individual.config.manage` (platform space), granted to `individual_product_administrator` in the same file.
- Data only. Appoints nobody.
- Not super-admin and not landlord authority. The door writes only catalogue paths, only in the Individual partition, only within the hard limits.

| | |
|---|---|
| File | `supabase/migrations/376-individual-config-manage-capability.sql` |
| sha256 | `e2a0ed8af49542d8dbe551c072e8f989bff87e19ca54083d6d5d0a9ad2753587` |
| House rules | ALL CLEAR, 72 lines, 5 statements |
| Depends on | 264 (`hq_capability`, `hq_position_capability`), 370 (the position), 076 (the WCE tables the door writes) |
| State | **Applied and verified on staging** (state 2). The owner applied it twice on 2026-10-23 (`apply-migrations.ts --only 376`, target ezhvpgtcqcdsgylrxgdb, guard passed, both runs ok). Not in production. |

**Staging pre-state** (`npx tsx scripts/ind007-staging-schema-check.ts --config`, read-only):
- no `hq.individual.config.manage`;
- the position holds `hq.individual.pilot.grant` and `hq.platform.home.view`;
- Individual partition: 0 overrides, 0 versions.

**Staging post-state, after two applications** (same read-only check): `hq.individual.config.manage` (platform, "Competen Individual policy") exists, and the position holds exactly three open grants (`hq.individual.config.manage`, `hq.individual.pilot.grant`, `hq.platform.home.view`). The second run added no duplicate grant, so it is idempotent. The partition is still empty. The file checksum matches the one above.

**Production:** not applied, which needs a separate owner GO. Proposed risk tier **Low**: two catalogue rows in existing tables, nobody appointed, nobody gains access. It needs 370 applied there first (the position).

**Rollback (staging):**

```sql
delete from hq_position_capability where position_code = 'individual_product_administrator' and capability_code = 'hq.individual.config.manage';
delete from hq_capability where code = 'hq.individual.config.manage';
```

**Harness notes:**
- `hq-guard-harness` B1 compares the applied catalogue with the code catalogue. It reads the live database of whatever `.env.local` names, and is red until 376 is applied there.
- `individual-acceptance-harness` K2 now expects the three grants.

## 4. The policies and their hard limits (items 6 and 7)

| Policy | Product | Default (today's constant) | Fixed range | Consumer |
|---|---|---|---|---|
| Reminder lead time | Professional | 60 days | 7-180 | reminder scan, evidence page, home, registration hint |
| Longest share-link lifetime | Professional | 365 days (form still suggests 30) | 1-365 | share route and form |
| AI requests per person per hour | Individual | 30 | 1-30, and never above the estate limit | Professional AI, Personal AI, Scholar AI |
| Practice questions per request | Scholar | 3 | 1-3 | questions kept per generation |
| Study materials per person | Scholar | 50 | 1-50 | upload refusal |
| Study achievements offered for the Passport | Scholar | both 375 kinds | only the 375 kinds | progress page, passport POST |

The hard limits live in `src/lib/individual/policy.ts` and nothing writes them:
- **On write**, the door refuses a value outside the range with 422, so the administrator sees the limit rather than a different number.
- **On read**, every value is clamped, so no stored value can take a consumer past its limit, whoever wrote it (another door, a rollback, a hand edit).
- **On failure**, an unreadable store or an absent row falls back to today's constant.

Notes per policy:
- **AI:** `src/lib/ai/quota.ts` is unchanged. The Individual routes apply the tighter of the estate limit and the policy.
- **Scholar questions:** the policy narrows how many checked questions are kept. The versioned prompt (`PROMPT_VERSIONS`) is unchanged.
- **Scholar materials:** the list read keeps the hard maximum, so a person above a lowered limit still sees every material.
- **Passport kinds:** a kind switched off is not offered for new choices. Achievements already chosen keep showing and can still be removed.
- **DB caps:** the 10 MB upload cap, the MIME types and four options are untouched.

**Owner decisions recorded here, reversible:**
- the ranges above;
- the share policy is the maximum a person may choose, not the suggested default;
- existing Passport choices are not hidden when a kind is switched off;
- the policy page is not behind `individual_app`, so limits can be set before activation. It reads and writes no person's data.

## 5. Effective dates (item 7): WCE has none

A value takes effect when its version is published: `workspace_config_versions.created_at`, the database clock. The page states this, and shows "effective since" from the version history.

**Smallest addition, proposed and not built.** A nullable `effective_from timestamptz` on `workspace_config_versions`, plus a `security_invoker` view that returns, per scope, the latest version whose `coalesce(effective_from, created_at) <= now()`. It is evaluated by the database clock, never compared with an application clock.

**Owner ruling (2026-10-23), verbatim:** "Defer migration 377. Individual policy settings take effect upon governed publication, with version and audit history. Legal effective dates remain separate." So `effective_from` is not built. The page says "A change takes effect when it is published", and each version shows who published it and when.

## 6. The page (item 6)

`/super-admin/individual/configuration`, under the existing super-admin shell:
- guarded by `requireHqCapability("hq.individual.config.manage")`;
- in the route map and in a "COMPETEN INDIVIDUAL" nav group.

Per policy it shows:
- the effective value;
- its source (default, published, or clamped, with the stored value);
- effective since;
- the fixed limit with its reason;
- any unpublished draft;
- the draft control.

Below that: Publish with a reason, the versions (each restorable), and the change trail.

## 7. Suggestions (item 8)

- Profession and registration body get a `<datalist>` from `taxonomies` and `taxonomy_terms` (migration 013), and stay free text.
- `taxonomies.kind` is free text with no check, so `registration_body` is **data, not a migration**. But no screen can create a kind: `/api/metadata` adds terms to existing kinds only. Creating it needs one inserted row, either a data migration (377) or an owner SQL insert. **Not done: asking first.** Until then that field has no suggestions.
- Staging has 6 profession terms: discipline names ("Nursing", "Medicine"). They are not titles like "Registered nurse".
- **Specialty:** Professional has no specialty field, so there is nothing to suggest into without a schema change. Not done.

## 8. Found in passing (not fixed here)

**`hqApiGate` answers an anonymous caller with 403, not 401, on every HQ API route.**
- `resolveHqContext` returns `redirectTo: "/login?next=/super-admin"`.
- `src/lib/hq/api-gate.ts` tests `res.redirectTo === "/login"`, which never matches.
- It is still a refusal, so nothing is exposed. But the 401 branch is dead, and a client cannot tell "sign in" from "not allowed".
- Seen on staging: an anonymous POST to `/api/hq/individual/config` got 403.

## 9. Verification

- **P0:**
  - static harness 64/64;
  - staging acceptance 37/37 (G1, G3 pass; G2 PEND);
  - LF clone: tsc clean, vitest 638/638, CI subset 46/46.
- **Policy:**
  - tsc clean, eslint clean, vitest 647/647 (policy suite included);
  - `individual-config-harness` 35/35, including 22 planted reds;
  - foundation 44/44, Professional 61/61, Scholar 77/77, nav filter 35/35, plane boundary 35/35;
  - staging acceptance (`individual-config-acceptance-harness`) is **pending 376**.
- **Suggestions:**
  - Professional harness 64/64 (T1 with two plants);
  - unit tests;
  - staging vocabularies read read-only.
