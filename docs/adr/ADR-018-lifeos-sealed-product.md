# ADR-018 — LifeOS is a sealed product inside this repository, built to be carved out

**Status:** Accepted · 2026-11-05. The owner chose "This repo, sealed" when asked directly, and restated it with implementation requirements on 5 to 6 November (Option 1).
**Satisfies:** Competen LifeOS V1.2 API-First Architecture instruction (delivery steps 1 to 4).
**Supersedes:** nothing.
**Commercial readiness checkpoint (owner):** before the first paying external organisation is onboarded, assess whether LifeOS should move to its own repository, database and deployment, covering data isolation, authentication independence, operational reliability, licensing and extraction effort. This assessment is not to be deferred until external customer data has accumulated.
**Enforced by:**
- `scripts/lifeos-seal-harness.ts` (in CI, no credentials)
- `supabase/migrations/901-lifeos-core.sql`
- `src/lib/lifeos/adapters/competen/guard.ts`
- `scripts/lifeos-acceptance-harness.ts` (staging)

---

## The question

LifeOS must be sold, licensed and white-labelled independently of the other Competen Holdings businesses. The same instruction says to reuse Holdings identity, security and infrastructure. `CLAUDE.md` says there is no second Competen repository. The prototype (`Competen_LifeOS_V1_1_Prototype.html`) is a single browser file and was in no repository, so nothing had yet decided where LifeOS lives.

## Decision

LifeOS is built in `ajootum/competen-healthcare` as a sealed product. It is not a mode or a module of Practice, Enterprise, Recruitment, Individual or HQ.

1. **Data.** Every LifeOS table is named `lifeos_*`. A LifeOS table may reference only other `lifeos_*` tables. It holds no foreign key to `profiles`, `auth.users`, `tenants` or any other product's table.
2. **Identity.** A LifeOS person has their own id. `lifeos_identity_link` maps an issuer and subject to that id. Today the only issuer is this Supabase Auth. After a carve-out, the same row shape holds an OIDC subject. No LifeOS row stores an auth user id outside that table.
3. **Code.** Code lives in `src/lib/lifeos/` and `src/app/api/lifeos/`. Only `src/lib/lifeos/adapters/competen/` may import from the rest of Competen. No Competen code may import LifeOS, with one recorded exception per future integration. The recorded exceptions are: `src/proxy.ts` reads `src/lib/lifeos/host.ts`, which imports nothing and is inert unless `LIFEOS_TENANT_HOSTS=1`. The Individual account menu has a plain link and imports nothing.
4. **Gate and entitlement.** LifeOS is its own product gate, read from `lifeos_flag`. An absent flag, a failed read or a missing migration all mean off, and off answers 404 before authentication. A person is admitted only by a live row in `lifeos_entitlement`, a per-person ledger of access periods with a required source. It does not use `practice_platform_flags`, `individual_membership` or `platform_membership`.
5. **Neutral core.** LifeOS code and migrations carry no healthcare assumption or vocabulary. The seal harness checks this.
6. **Access.** Possessing a Competen account grants no LifeOS access. Holding LifeOS grants no Competen product. This is the rule of ADR-001 and ADR-016, applied once more.

## Why not a new repository now

A new repository and Supabase project were the cleanest route to a sale. They would have meant rebuilding CI, auth and the security tooling, and building single sign-on from Competen before step 6. The seal keeps the option open at a small, stated cost, and the owner chose it knowing the trade-off.

## Costs accepted

- **Shared production database and deployment until carve-out.** A LifeOS load spike or bad deployment can affect Competen, and the reverse.
- **A sale or licence requires an extraction project.** The seal keeps it small. It does not remove it.
- **Commercial separation is not legal separation.** Data-processing terms, operator entity and data residency are still open for step 10.

## What a carve-out would involve

1. Copy `src/lib/lifeos/`, `src/app/api/lifeos/` and the `lifeos_*` migrations to a new repository.
2. Replace `adapters/competen/` with a standalone adapter (session, trace, admin client).
3. Export `lifeos_*` rows to a new Supabase project.
4. Re-issue identities by adding a new `lifeos_identity_link` row per person, keeping `lifeos_individual.id` stable.

No business logic should need to change. The seal harness exists to keep that sentence true.
