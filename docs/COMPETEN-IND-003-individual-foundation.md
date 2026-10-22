# COMPETEN-IND-003 — Individual Foundation: build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-003/individual-foundation` (from `50ae85f0`). **Not merged, not pushed, not deployed.** |
| **Authority** | Owner GO for COMPETEN-IND-003. Architecture: COMPETEN-IND-001 (Option B), COMPETEN-IND-002 §5, ADR-016 (Proposed). |
| **Blocked on** | (1) the owner applying migration 370; (2) a reachable staging project. See §7. |

## 1. What was built

| # | Brief item | Where | State |
|---|---|---|---|
| 1 | Authenticated workspace and landing | `src/app/individual/(app)/layout.tsx` (gate 3), `(app)/home` (landing) | Built; needs 370 to admit anyone |
| 2 | Experience-specific navigation | `src/lib/individual/experiences.ts` (registry), `src/app/individual/_components/ShellNav.tsx`, `(app)/[experience]/layout.tsx` | Built |
| 3 | Configurable primary experience and switching | `ExperienceSwitcher` (live experiences only), `(app)/[experience]/settings`, `POST /api/individual/preferences` | Built |
| 4 | Shared profile and development history | `(app)/[experience]/profile`, `src/lib/individual/history.ts` | Built (read-only profile) |
| 5 | Competen Passport integration | `(app)/[experience]/passport`, `src/lib/individual/passport.ts` | Built: a view of the existing Passport; no new record |
| 6 | Personal AI entry point | `(app)/[experience]/assistant`, `POST /api/individual/assistant` → existing `generate()` | Built; no memory |
| 7 | Empty states, onboarding, entitlement handling | `(app)/welcome`, `/individual/access`, the not-active state in the experience layout, planned-capability lists | Built |
| 8 | Responsive layouts consistent with the public site | Sidebar from `md`, bottom bar below it, `pointer-coarse` touch floors (CPR-MOB-001), public-site marks and accents | Built; signed-in screens are verified by compile only (§7) |

**Routes.** All signed-in routes are `noindex`.

| Route | Purpose |
|---|---|
| `/individual/home` | Landing. Sends a member to the welcome, then to their primary experience, or explains why no experience is active. |
| `/individual/welcome` | One-time onboarding. Shows what the account holds and asks which experience opens first. |
| `/individual/scholar` | Scholar experience home. Each experience also mounts `/passport`, `/profile`, `/assistant` and `/settings`. |
| `/individual/professional` | Professional experience home, with the same four modules. |
| `/individual/access` | Every refusal lands here. The page works out its own state and names it: not signed in, not provisioned, no membership, suspended, revoked, or could not check. |

**Entry.** A pilot member signs in at `/login`. The neutral resolver (`src/lib/identity/product-resolution.ts`) now offers *Competen Individual* from `individual_membership`. The public door `/individual/sign-in` stays `being_built`, and no signup surface exists.

## 2. Reused, not rebuilt

| Need | Reused |
|---|---|
| Identity | `profiles` and the GoTrue session, read only. `profiles.role` is never read or written. |
| Product routing | `resolveProductDestinations` gains one read and one code. The login chooser is unchanged. |
| Gate pattern | `platform_membership` / ADR-015 three-state shape. Fails **closed** here, and §3 of ADR-016 records why. |
| Passport | The existing rows: `competency_decisions` (current-competence rule taken from `/verify`), `professional_credentials`, `employment_records`. Sharing stays on `/dashboard/passport/share`. |
| AI | `generate()` with `plat_ai_requests` logging, `checkAiQuota`, `aiStatus`, and the `/api/me/copilot` grounding pattern. |
| Audit | `audit_log`. AI queries are written as `ai_assistant_query`, so the hourly quota counts them. |
| UI | Public-site marks, accents, controls and touch sizes, with `--cmp-touch-min`. |

**Nothing is duplicated.** No identity, no Passport record, no competency engine and no AI service is created. The only new storage is the gate (migration 370).

## 3. Provisional rulings in force

These are COMPETEN-IND-002 §7 recommendations. They are applied as working assumptions only; the owner has not ruled.

- **D1:** separate `individual_*` storage. The harness fails any Individual use of estate learning tables.
- **D3:** institution-issued records shown to their subject, read-only and labelled by issuer.
- **D6:** own-row RLS on `individual_*`.
- **D7:** app routes `/individual/scholar/**` and `/individual/professional/**`.
- **D8:** 18+ for the pilot. Recorded only, because grants are made by HQ.
- **D2:** only `operating_entity` is recorded.

## 4. Migration 370 — for the owner to apply (staging first)

**File:** `supabase/migrations/370-individual-membership-and-entitlement.sql`.

- It is **uncommitted**, per CLAUDE.md. Commit it after you confirm application.
- `scripts/migration-house-rules.ts` reports **ALL CLEAR** (195 lines, 37 statements, 9 constraints).
- It creates `individual_membership`, `individual_entitlement` and the view `individual_live_entitlement`.
- It touches no existing object and backfills nothing. RLS is on, with own-row `select` policies only.

Before 370 is applied, the code treats the missing tables as **not provisioned**: nobody is admitted, `/login` behaves exactly as before, and `/individual/access` says the product is not set up here.

## 5. Pilot grant (HQ, by SQL) until an HQ grant capability exists

Run this in the SQL editor for one invited person. Replace the email address, and keep only the experiences being granted.

```sql
insert into individual_membership (user_id, status, source, note)
select id, 'active', 'hq_pilot_grant', 'COMPETEN-IND-003 pilot' from profiles where email = 'pilot@example.com'
on conflict (user_id) do nothing;

insert into individual_entitlement (user_id, experience_code, source, operating_entity, note)
select id, 'scholar', 'pilot', 'scholar_operator', 'COMPETEN-IND-003 pilot' from profiles where email = 'pilot@example.com';

insert into individual_entitlement (user_id, experience_code, source, operating_entity, note)
select id, 'professional', 'pilot', 'competen_holdings', 'COMPETEN-IND-003 pilot' from profiles where email = 'pilot@example.com';
```

- **Direct Professional:** omit the Scholar insert.
- **Graduation:** a later Professional insert with `source = 'graduation'`.
- **End an experience:** `update individual_entitlement set status = 'cancelled' where …`.

The history is kept in every case.

## 6. Verification (2026-10-22)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` on every changed file | clean |
| `vitest run` (whole suite) | **491 / 491**. 47 cases are new or updated for Individual and product resolution. |
| Controls proven | Removing the missing-table carve-out turned the resolver test red. Making the entitlement read fail open turned the access test red. Both were restored to green. |
| `individual-foundation-harness` (new, in CI list) | **21 / 21**. Four planted violations (estate-table read, `getCaller`, `profiles` write, unlisted write) turned it red, and it went green on restore. |
| `access-doors-harness` | 39 / 39 |
| `plane-boundary-harness` | 35 / 35 (Individual adds no HQ-plane reads) |
| `auth-boundary-harness` | Individual routes recognised after registering `requireIndividualContext`. One failure remains (`practice/public/manage`), and it fails identically at `50ae85f0`. |
| `pd-screen-doctrine`, `domain-registry` 8a, `cpr040`, `practice-responsive`, `pui-tokens` | Fail **identically at `50ae85f0`**, measured on a clean export. They are not touched here. |
| Dev server on 3020 against **staging** (production refused by the launcher) | Every Individual route compiles. Signed-out deep links redirect to `/login?next=<same path>`. `/individual/access` renders at 375px with no horizontal overflow and 44px targets. Both APIs answer 401 when signed out and 400 for an unknown experience. |
| `individual-acceptance-harness` (new, staging) | **Not run.** The staging host does not resolve from this machine (`ENOTFOUND`), and 370 is not applied. The harness reports PEND and creates nothing when 370 is absent. |

Evidence: `docs/evidence/COMPETEN-IND-003/` (signed-out access page, desktop and mobile).

## 7. Blockers to the end-to-end acceptance demo

1. **Migration 370 is not applied.** No membership can exist until it is, so no signed-in Individual screen can render with real data. Entitlements are not simulated.
2. **Staging is unreachable.** `STAGING_SUPABASE_URL`'s host returns `ENOTFOUND` (`supabase.co` itself resolves). The privileged runner reports the same `fetch failed`. Nothing was run against production.

Once both are fixed, run `npx tsx scripts/privileged-harnesses.ts --staging --only individual-acceptance`. Its gate currently also refuses because `practice-public-profile-harness.ts` is untriaged, which is pre-existing. That run covers §5 of the brief end to end: groups A–H in the harness header.
