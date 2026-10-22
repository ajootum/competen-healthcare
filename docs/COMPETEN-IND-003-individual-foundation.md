# COMPETEN-IND-003 — Individual Foundation: build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-003/individual-foundation` (from `50ae85f0`). Owner rulings D1–D10 applied. **Not merged, not pushed, not deployed.** |
| **Authority** | Owner GO for COMPETEN-IND-003; owner rulings and staging commissioning GO (2026-10-22). ADR-016 is Accepted. |
| **Blocked on** | The staging Supabase project being reachable. See §7. |

## 1. What was built

| # | Brief item | Where |
|---|---|---|
| 1 | Authenticated workspace and landing | `src/app/individual/(app)/layout.tsx` (gate 3), `(app)/home` |
| 2 | Experience-specific navigation | `src/lib/individual/experiences.ts`, `_components/ShellNav.tsx`, `(app)/[experience]/layout.tsx` |
| 3 | Primary experience and switching | `ExperienceSwitcher` (live experiences only), `[experience]/settings`, `POST /api/individual/preferences` |
| 4 | Shared profile and history | `[experience]/profile`, `src/lib/individual/history.ts` |
| 5 | Passport integration | `[experience]/passport`, `src/lib/individual/passport.ts`. A view of the existing Passport; no new record. |
| 6 | Personal AI entry point | `[experience]/assistant`, `POST /api/individual/assistant` → existing `generate()`. No memory (D10). |
| 7 | Onboarding, empty states, entitlement handling | `(app)/welcome`, `/individual/access`, the not-active and terms states in the experience layout, the planned-capability lists |
| 8 | Responsive design consistent with the public site | Sidebar from `md`, bottom bar below it, `pointer-coarse` touch floors, public-site marks and accents |
| Rulings | D2 terms, D8 age, D9 grant right | `legal.ts`, `terms.ts`, `TermsAcceptance.tsx`, `POST /api/individual/terms`, `grants.ts`, `POST /api/hq/individual/grants` and `/grants/end` |

**Entry.** An HQ grant creates access. The person signs in at `/login`, where the neutral resolver offers *Competen Individual*. The first time they open an experience, they accept its terms. There is no signup surface.

## 2. Reused, not rebuilt

Identity (`profiles`, GoTrue), the neutral product resolver, the gate pattern of `platform_membership` and ADR-015, the existing Passport rows (with `/verify`'s current-competence rule), `generate()` with its quota and usage log, `audit_log`, HQ capabilities, positions, appointments and `hqApiGate`, and the public-site design language. No identity, Passport record, competency engine, AI service or grant engine was duplicated.

## 3. Owner rulings applied

See ADR-016 §Owner rulings for where each one is enforced. Implementation changes made for them:

- **D2**
  - Legal configuration comes from the environment per operating entity:
    - `INDIVIDUAL_LEGAL_{COMPETEN_HOLDINGS|SCHOLAR_OPERATOR}_{TERMS|PRIVACY}_{VERSION|URL}`
    - `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_REGISTERED_NAME`
  - `DATA_ROLES` is configurable and marked unconfirmed.
  - The terms gate covers the shared foundation (Holdings) and the experience operator. Acceptance is recorded all-or-nothing in the schema.
  - An experience is closed while its terms are unpublished, and the screen says so.
- **D8:** the grant refuses Scholar without the 18+ confirmation, and a schema CHECK refuses any Scholar row without `adult_confirmed_at`. The confirmer is recorded.
- **D9:**
  - `hq.individual.pilot.grant`, the position `individual_product_administrator` (platform space, product line `individual`) and the grant are seeded in 370 and the `spaces.ts` catalogue.
  - The grant and end routes sit behind `hqApiGate` and refuse self-grant.
  - Holding the right needs an ordinary HQ appointment to that position.
- **D1, D3, D4, D5, D6, D7, D10:** already implemented as working assumptions. They are now ruled, and pinned by the foundation harness and the acceptance harness.

## 4. Migration 370

| | |
|---|---|
| File | `supabase/migrations/370-individual-membership-and-entitlement.sql` |
| Commit | `cb63e582` |
| SHA-256 (committed blob, LF) | `4b327cb8ad6c716214c43756eca50addb851fd0ef11a2fab163ae3e46d63f656` (15,399 bytes; git blob `c3e49afa`) |
| House rules | ALL CLEAR: 271 lines, 48 statements, 12 constraints. No `$$`, no plpgsql, no partial unique index, `notify pgrst` last. |
| Reproducibility | Every statement is idempotent (`if not exists`, drop-then-add constraints, `on conflict do nothing`, `where not exists`, `create or replace view`). No backfill. It touches no existing table, policy or constraint. A second run is designed to be a no-op. The run-twice proof is part of the staging apply, which is still pending (§7). |
| `hq-guard` catalogue parity (DB neutralised) | S0, S4, D1–D8 pass: 52 capabilities in DDL and code, 8 positions, 81 grants. |
| **Staging** | **Not applied.** The project is unreachable (§7). |
| **Production** | Not applied, and needs a separate owner GO. |

Apply with the established tool once staging answers: `npx tsx scripts/apply-migrations.ts --only 370`. It refuses production, sends the file whole and stops on the first error. Run it twice to prove idempotency, then run `migration-verify --staging`.

## 5. Granting pilot access

**Normal path (D9).**
1. An HQ governance lead appoints a person to *Individual Product Administrator*.
2. That person calls `POST /api/hq/individual/grants` with `{ targetUserId, experiences: ["scholar","professional"], adultConfirmed: true }`. `adultConfirmed` is required for Scholar.
3. `POST /api/hq/individual/grants/end` with `{ targetUserId, experience }` ends one experience.

The routes have no HQ console page yet (§8).

**Before the pilot,** set the four legal version variables (and URLs) per environment. Until they are set, every experience stays closed.

## 6. Verification (2026-10-22)

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint` on changed files | clean |
| `vitest run` | **504 / 504**. 60 cases cover Individual, product resolution and the safeguards. |
| `individual-foundation-harness` (CI list) | **30 / 30**. Planted violations went red, and it went green on restore: estate-table read, `getCaller`, `profiles` write, an unlisted write, the D8 check removed, and a person-facing provisioning insert. |
| `access-doors` / `plane-boundary` / `access-scanner` | 39/39 · 35/35 · 22/22 |
| `auth-boundary` | Individual and HQ Individual routes recognised. One failure (`practice/public/manage`) is identical at `50ae85f0`. |
| `hq-guard` static sections, Supabase neutralised to an unresolvable host | Catalogue parity passes. P2 cannot run without a database. |
| Privileged runner | UNTRIAGED 0 (`practice-public-profile-harness` screened into STAGING). |
| Acceptance harness, production target | Refused by `assertSafeTarget` before any client is created. |
| **Acceptance harness on staging (groups A–M)** | **Not run: staging unreachable.** |
| Baseline failures, measured identical at `50ae85f0` and not touched | `pd-screen-doctrine` (5), `domain-registry` 8a, `cpr040` 3, `practice-responsive` 4e/5-perf, `pui-tokens` token regeneration, `auth-boundary` `practice/public/manage` |

**Process incident, disclosed.** While checking the HQ catalogue harnesses, I ran `scripts/hq-guard-harness.ts` once with the default `.env.local`, which names **production**. Its G-section wrote one temporary `ogs_office_appointments` row for an existing non-owner profile, cycled its status (active, suspended, nominated, …) and deleted it. The run reported G6 "the fixture appointment is GONE" and 70/70 green. The repository lists this harness as previously run against production by the owner. Nothing else ran against production. I did not query production afterwards to inspect any side effects; that check is the owner's call. Since the incident, every database harness runs only with Supabase neutralised or with an explicit staging target.

## 7. Blockers

1. **The staging project is unreachable.** `STAGING_SUPABASE_URL`'s host (`ezhvpgtcqcdsgylrxgdb.supabase.co`) does not resolve, locally or through 8.8.8.8. The session pooler answers `tenant/user postgres.ezhvpgtcqcdsgylrxgdb not found`. That is consistent with the project being paused or deleted in Supabase. No other approved staging project is recorded in the repository. Restoring the project, or supplying a new one's `STAGING_*` values, is an owner action in the Supabase dashboard. Production was not substituted. Until then, these are pending:
   - applying 370 to staging and the run-twice proof;
   - the acceptance groups A–M (dual and single experience, expired, revoked and ended access, age, switching and refusals, identity, Passport provenance, history, AI boundaries, RLS isolation, employer visibility);
   - the HQ, Practice, Enterprise and Platform boundary re-runs on staging.
2. **Legal documents.** No Individual terms or privacy documents are published. D2 makes this blocking for real pilot use, though not for staging commissioning, where the harness uses its own test versions. The Scholar operator's registered name is also pending.

Once staging answers, run in this order:
1. `apply-migrations.ts --only 370`, twice;
2. `privileged-harnesses.ts --staging --only individual-acceptance`;
3. `--staging --only hq-guard`, `platform-membership`, `practice-signup` and `enterprise` (the boundary re-runs).

## 8. Next

**COMPETEN-IND-004.** Scholar's first complete learning journey: upload, explain, practise, revise, progress, built on the `individual_*` storage boundary (D1). The Professional core can be built in parallel on separate files: credentials, private CPD and the D5 identity record. An HQ console page for the grant right can be built alongside. Staging commissioning (§7) must complete before IND-004 ships to staging.
