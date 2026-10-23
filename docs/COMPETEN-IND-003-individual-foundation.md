# COMPETEN-IND-003 — Individual Foundation: build record

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Status** | Built on branch `ind-003/individual-foundation` (from `50ae85f0`). Owner rulings D1–D10 applied. **Merged to `main` as `293e50f1` (PR #5) on 2026-10-23, deployed dark** (release gate absent). Migration 370 is applied on staging only, and is ON HOLD for production. |
| **Authority** | Owner GO for COMPETEN-IND-003; owner rulings and staging commissioning GO (2026-10-22). ADR-016 is Accepted. |
| **Staging** | Migration 370 applied and proven idempotent. Acceptance 35/35 green, with a planted defect proven red. See §4, §6 and §8. |

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
| **Staging** | **Applied 2026-10-22** with `apply-migrations.ts --only 370` (node-postgres, whole file, production guard passed). The working file was confirmed byte-identical to the `cb63e582` blob first. **Run twice:** the schema snapshot hash was identical after the second run (`83b7db43…6678`). It covers 3 relations (RLS on both tables, `security_invoker=true` on the view), 20 constraints, 4 indexes, 2 `SELECT` policies, column counts 17/17/10, 0 rows, the capability, the position (platform space, product line `individual`) and exactly 2 grant rows. |
| **Production** | Code merged to `main` (`293e50f1`) and deployed dark: no `individual_app` row, so Individual is 404 everywhere and 370 is not needed. **Migration 370 is ON HOLD.** It needs a separate owner GO, and is also blocked by the owner's schema freeze: no production schema change until a verified recovery mechanism exists, because production has no backups or PITR. |
| **Ordering with 371** | `371-plat-ai-requests-attribution.sql` (AI-LOG-001, merged to `main` `fb5ce41b`) is already applied to production. It alters only `plat_ai_requests` (two columns, one index), and 370 never touches that table. 370 depends only on objects from migration 281 and earlier. So the production history will read 371 then 370 in application order, which is safe. 370 keeps its number. |

Apply with the established tool once staging answers: `npx tsx scripts/apply-migrations.ts --only 370`. It refuses production, sends the file whole and stops on the first error. Run it twice to prove idempotency, then run `migration-verify --staging`.

## 5. Granting pilot access

**Normal path (D9).**
1. An HQ governance lead appoints a person to *Individual Product Administrator*.
2. That person calls `POST /api/hq/individual/grants` with `{ targetUserId, experiences: ["scholar","professional"], adultConfirmed: true }`. `adultConfirmed` is required for Scholar.
3. `POST /api/hq/individual/grants/end` with `{ targetUserId, experience }` ends one experience.

The routes have no HQ console page yet (§9).

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

1. **RESOLVED 2026-10-22: the owner restored staging (see §8).** Original record: **the staging project was unreachable.** `STAGING_SUPABASE_URL`'s host (`ezhvpgtcqcdsgylrxgdb.supabase.co`) does not resolve, locally or through 8.8.8.8. The session pooler answers `tenant/user postgres.ezhvpgtcqcdsgylrxgdb not found`. That is consistent with the project being paused or deleted in Supabase. No other approved staging project is recorded in the repository. Restoring the project, or supplying a new one's `STAGING_*` values, is an owner action in the Supabase dashboard. Production was not substituted. Until then, these are pending:
   - applying 370 to staging and the run-twice proof;
   - the acceptance groups A–M (dual and single experience, expired, revoked and ended access, age, switching and refusals, identity, Passport provenance, history, AI boundaries, RLS isolation, employer visibility);
   - the HQ, Practice, Enterprise and Platform boundary re-runs on staging.
2. **Legal documents.** No Individual terms or privacy documents are published. D2 makes this blocking for real pilot use, though not for staging commissioning, where the harness uses its own test versions. The Scholar operator's registered name is also pending.

Once staging answers, run in this order:
1. `apply-migrations.ts --only 370`, twice;
2. `privileged-harnesses.ts --staging --only individual-acceptance`;
3. `--staging --only hq-guard`, `platform-membership`, `practice-signup` and `enterprise` (the boundary re-runs).

## 8. Staging commissioning results (2026-10-22, after the owner restored staging)

**Pre-existing staging gap, not touched.** Staging is missing migrations **361–369**. Their markers are absent: 361, 362, 363, 365, 366 and 368 columns or tables, 367's capability, and 369's plan column. 364 has no probeable marker. 370 depends on none of them. Its dependencies were verified present before applying: `profiles`, `hq_position.product_line_code`, `hq_position_capability.effective_to`, `plat_product_line.individual` and `audit_log.trace_id`. Only 370 was applied, as the GO authorised. Applying 361–369 is an owner action.

| Run on staging | Result |
|---|---|
| `individual-acceptance-harness` via `privileged-harnesses --staging --only` | **35 / 35 ALL GREEN.** Groups I (age), A (dual), B (single, direct Professional), C (DB clock), D (graduation keeps Scholar), E (primary fallback), H (suspended, revoked, ended), J (terms), F (no other product, role unchanged), K (HQ position and right), L (provenance, AI context), M (no employer-visible rows), G (cross-user RLS, no self-grant), Z (cleanup). |
| Control | Planting a resolver that reads the raw ledger instead of the DB-clock view turned **E2 and H4 red (33/2)**. Restored, and identical to the committed file. |
| Browser walk-through, `localhost:3020` against staging, test identities created and removed this session, staging-only test legal versions | A dual person: welcome → primary chosen → Scholar terms gate (Holdings and operator documents) → Scholar shell → switch to Professional with no second prompt (Holdings documents already accepted) → shared history shows both periods → primary switched in Settings, and `/individual/home` follows it. Personal AI answered through `generate()`: the `plat_ai_requests` row has `tenant_id` null with tokens and cost, and the audit action is `ai_assistant_query` with no question text stored. A Professional-only person: welcome with only Professional → only the two Holdings documents → Professional shell. `/individual/scholar` shows the governed not-active state, the Scholar AI API returns 403, and `/dashboard` redirects them away (no estate access). Mobile at 375px: no overflow, sidebar hidden, 56px bottom tabs. Evidence: `docs/evidence/COMPETEN-IND-003/staging-*.jpg`. |
| Defect found and fixed | The AI answer showed Markdown syntax as literal text. The shared prompt rules now ask for plain text, re-verified in the browser. |
| `identity-join` | 29 / 29 |
| `staff-host` (pure) | 17 / 17 |
| `hq-guard` | 68 / 2. B1 and B5 differ from the code catalogue by exactly `hq.practice.commercial.manage`, because **367 is not applied on staging**. The Individual capability is present. |
| `platform-membership` | 61 / 1. E3a is Practice provisioning `ENTITLEMENT_CREATE_FAILED`: `practice_entitlement.source` (**368**) is missing on staging. |
| `practice-signup` (HTTP, `BASE_URL=localhost:3020`) | 18 / 3. All closed-signup and refusal assertions pass. The 3 failures are the same 368 `ENTITLEMENT_CREATE_FAILED`. |
| `enterprise-membership` | 29 / 2. 7d and 9a: staging has **no seeded tenant administrator** to test with (data, not code). |

None of the boundary failures involves Individual code. Each traces to the 361–369 gap or to missing staging seed data, and was confirmed by a direct schema read.

## Merge-time step -- DONE 2026-10-22 (merge 65d20804, change 07f90770; staging acceptance 35/35 re-run after merge)

COMPETEN-AI-LOG-001 (PR #2, `9402bbe` on main) replaced `generate()`'s bare `tenantId` with a typed `attribution` (`AiAttribution` in `src/lib/ai/gateway.ts`). Owner GO: the branch that merges second makes the change. In `src/app/api/individual/assistant/route.ts`, change

`context: { userId: ctx.userId, tenantId: null, operation: \`individual_assistant_${experience}\` }`

to

`context: { userId: ctx.userId, attribution: { scope: "person" }, operation: \`individual_assistant_${experience}\` }`

The `person` scope records the actor alone, with no tenant and no workspace, which is what the route intends. Update its comment accordingly. Then re-run `tsc`, `vitest` (including `src/lib/ai/attribution.test.ts`) and the foundation harness. A trial `git merge-tree` of this branch with `9402bbe` (2026-10-22) is textually conflict-free, so this is the only change expected.

## Release readiness: what must be true before the production GO for 370

None of these is satisfied by this branch alone. Each needs an owner act or a separate GO.

| # | Condition | State on 2026-10-22 |
|---|---|---|
| 1 | **A verified recovery mechanism for production**, such as backups/PITR enabled and a restore rehearsed (owner brief item 5, ADR-009). | **Not met.** Production has no backups or PITR. The recovery requirements are being documented separately. |
| 2 | **Owner GO for production migration 370.** | **On hold.** |
| 3 | 370 is applied to production with the established controls: run once, re-run as a no-op, then the schema snapshot compared against staging's (`83b7db43…6678`). | Waits on 1 and 2. |
| 4 | **Legal documents published** (COMPETEN-LEGAL-001): the four documents legally signed off, owner-approved and live at permanent URLs, with register entries. | **Not met.** No documents exist. |
| 5 | The **`INDIVIDUAL_LEGAL_*` variables set in production** to the published versions and URLs, after staging verification. | **Not met.** Until set, every experience stays closed (by design). |
| 6 | The **Scholar operator's registered name confirmed** and set, or a decision recorded to launch Professional only. | **Pending** (COMPETEN-IND-001 D8). |
| 7 | **Data roles confirmed** by legal (`DATA_ROLES.confirmed`). | **Pending** (D2). |
| 8 | **An Individual Product Administrator appointed** through the HQ appointments surface. That person holds `hq.individual.pilot.grant`. | **Not yet.** The position exists once 370 is applied. |
| 9 | PR #5 reviewed and merged by the owner, and CI shows no failure beyond `main`'s baseline. | **Done 2026-10-23.** Merged under the owner's conditional GO as `main` `293e50f1` (head `036f47aa`). CI: everything passed except the authenticated staging smoke, which fails closed because its secrets are missing (recorded on the PR). Production deployment `dpl_HAFWvNxtJsQpfmHZgBz5sWjpEb6P`; rollback reference `dpl_DeBNcrYaydMp7CJYwT7iYQXscv2F` (`main` `5a9a07cc`). |
| 10 | **Post-deploy checks (production):** before the flag, every Individual route answers 404; after setting `individual_app` ON (condition 12), `/individual/access` renders signed out; `/login` still resolves Platform, Practice and Enterprise accounts exactly as before; one pilot grant to a test identity shows welcome → terms → shell; that identity holds no platform, practice or enterprise membership and its `profiles.role` is unchanged; `plat_ai_requests` logs `attribution_scope = person`; the grant is ended and the experience closes. | Run after 1–9. |
| 11 | Staging is brought to parity (361–369 applied) so the boundary harnesses run clean there. | Owner action. Not an Individual blocker, but it removes the noise in §8. |
| 12 | **Release gate ON, last:** insert `practice_platform_flags ('individual_app', true)` in production only after 1–8 hold and 370 is verified. This is a data change, not a schema change. Setting it back to false (or deleting the row) turns Individual off instantly. | Not set. Individual is dark. |

## Production verification after merge (2026-10-23, gate absent, 370 not applied)

Run by the main session against production deployment `dpl_HAFWvNxtJsQpfmHZgBz5sWjpEb6P`.

| Check | Result |
|---|---|
| 7 gated Individual pages | 404, root title, 0 Individual strings |
| `POST /api/individual/{assistant,terms,preferences}` | 404 |
| `/api/hq/individual/grants` | 403 (HQ capability gate) |
| `/`, `/individual`, `/individual/sign-in`, `/scholar`, `/professional`, `/enterprise`, `/practice`, `/recruitment`, `/login`, `/practice/sign-in`, `/signup` | 200 |
| `/students` | 308 |
| Protected routes | Redirect to sign-in |
| Password fields | Only on `/login` and `/practice/sign-in` |
| `public-disclosure-harness` on production | 213 pass, 1 baseline failure |

Merge-condition evidence (no-entitlement refusal with the key present, gate OFF and ON, and the machine-derived 17-route inventory) is recorded in the main session's notes (`IND-003-merge-conditions-evidence.md`).

## Release gate and the merge-behind-gate assessment (2026-10-22, owner GO item 5)

**Gate.** `src/lib/individual/gate.ts` reads `practice_platform_flags.flag = 'individual_app'`. That is the estate's existing launch-flag table (migration 191), which exists in every environment. An absent row, `enabled = false`, a failed read, a throwing client or no client at all all mean **OFF**. It never throws, and it doesn't depend on 370. It is not registered in the Practice flags console, which belongs to Practice's director. It is checked first at:
- the shell guard (`DISABLED`, before authentication and before any Individual table);
- the group and experience layouts, every page helper, home and welcome (404);
- the access page (404);
- `/api/individual/*` (404, guard before input validation; the assistant's unguarded GET removed);
- `/api/hq/individual/grants` and `/end` (404 after the HQ capability gate);
- the neutral resolver (it reads `individual_membership` only when the gate is on).

**Evidence**

| Claim | Proof |
|---|---|
| `/login` behaves exactly as before while the gate is off, with or without 370 | Differential run of this branch's resolver against `origin/main`'s pre-IND-003 resolver, using the real `admitToEstate` over 4 profile × 4 practice × 5 platform-membership states × 6 Individual variants (gate absent, off, failed, thrown; gate on with 42P01; gate on with PGRST205). **480/480 identical**: answer, membership reads, and `individual_membership` never read while off. Permanent unit tests: `src/lib/identity/product-resolution.gate.test.ts`, 21 cases. A planted bypass turned 12 red. |
| Missing 370 is quiet and closed even with the gate on | The same test file: 42P01 and PGRST205 give the gate-off answer, no Individual card, never `unavailable`. |
| Every entry point is closed while off, against a real database | Staging-backed dev server with no flag row (the production condition): `/individual/home`, `/welcome`, `/scholar`, `/professional/passport` and `/access` → **404**. `POST /api/individual/{assistant,terms,preferences}` → **404**, including invalid input. `/api/hq/individual/grants(/end)` → refused at the capability gate. `/individual`, `/individual/sign-in` (coming soon, no password field), `/login` and `/practice/sign-in` → 200. |
| A real member stays invisible while off | Staging acceptance **39/39**: R1–R3 drive the real flag store OFF then ON; Z2 restores it. |
| Static pins | `individual-foundation-harness` 10a–10e (35/35). A removed gate turned 10a red. `access-doors` 39/39 (`/individual/sign-in` stays `being_built`). |
| Inert before 370 | `hq.individual.pilot.grant` is listed in `spaces.ts`, but grants resolve from `hq_position_capability`, which has no such row until 370. No runtime code compares the DB catalogue with the code catalogue. |

**Assessment: safe to merge behind the gate without production migration 370, subject to one policy ruling (below).** While the gate is off, production behaves as it does today: one extra primary-key read of `practice_platform_flags` per sign-in, nothing else. Residual and accepted: an authenticated caller probing `/api/hq/individual/*` gets the HQ capability refusal (401/403) before the gate's 404. That exposes no data and reflects existing HQ behaviour.

**Policy conflict: needs an owner ruling.** CLAUDE.md says a migration is not committed until the owner confirms it is applied. 370 is applied and verified on **staging only**. Merging PR #5 puts it into `main` unapplied in production. **Recommended ruling:** *a migration may enter `main` once it is applied and verified on staging (idempotent re-run, recorded checksum), provided its build record marks production application PENDING and every code path that reads its objects is behind a default-OFF gate or tolerates their absence; production application still requires its own owner GO.* 370 meets each clause: staging applied twice with an identical snapshot, sha256 `4b327cb8…` recorded, PENDING in §4, the gate is OFF by default, and the resolver tolerates the missing table. Without this ruling, PR #5 should wait for production 370, which is itself blocked by the recovery freeze.

**Merge record.** `main` `6fa4cd52` was merged as `a0cac3ea`: CI baseline green, Next.js 16.4.2, lint fixes, OPS-001 and AI-LOG-002 docs. Dependencies were reinstalled to 16.4.2. `tsc` is clean, `eslint src` has 0 errors, vitest passes 538/538, and the audit gate passes. The CI harness set is 42/44 locally. Its two failures (`pd-screen-doctrine`, `pui-tokens`) fail identically on a clean `main` export on this Windows machine, and this branch touches none of their files.

## 9. Next

**COMPETEN-IND-004.** Scholar's first complete learning journey: upload, explain, practise, revise, progress, built on the `individual_*` storage boundary (D1). The Professional core can be built in parallel on separate files: credentials, private CPD and the D5 identity record. An HQ console page for the grant right can be built alongside. Staging commissioning (§7) must complete before IND-004 ships to staging.
