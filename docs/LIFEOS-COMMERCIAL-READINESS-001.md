# LIFEOS-COMMERCIAL-READINESS-001 — should LifeOS move before the first paying organisation?

The owner's checkpoint from [ADR-018](adr/ADR-018-lifeos-sealed-product.md): assess this before the first paying external organisation, covering data isolation, authentication independence, operational reliability, licensing and extraction effort. Written 6 Nov 2026, from what the code and the accounts show today. Costs are not estimated here, because no prices were checked.

## Recommendation

**Move LifeOS to its own database, sign-in and deployment before the first paying organisation, and keep building in this repository until then.** The sealed build is ready for that move: it is small, and the code that would change is known. The reasons below are about what is shared today. None of them is a defect in LifeOS.

A free or unpaid pilot with a friendly organisation could run on the shared setup, if the session decision below is settled first and the organisation accepts what is written here. That choice is yours.

## The five questions

### 1. Data isolation

**Today:** LifeOS's 31 tables sit in the same production database as Competen's other products. No table references another product's, and the seal check enforces that in CI. Row-level security denies browsers everything, but the application's service key can read all of it.

**Risk:** an organisation's staff plans and any free text they type sit beside Competen's healthcare and learner data, under one key. A customer's security review will ask about this, and "separate in code, shared in the database" is a weak answer. Data residency cannot differ per customer.

**Verdict: move before a paying organisation.**

### 2. Authentication independence

**Today:** LifeOS uses Competen's Supabase Auth through a two-file adapter. Its identity table already separates a LifeOS person from an auth account, so an outside issuer can be added without touching a record.

**Risk:** one sign-in spans every Competen product, which creates the open decision below. A customer cannot use its own single sign-on yet.

**Verdict: move before a paying organisation, or at least before custom domains go live.**

### 3. Operational reliability

**Today:** LifeOS shares Competen's deployment and database. A bad deploy or a load spike in either affects both. Migrations go through the Competen process. The Supabase organisation is on the Free plan, by owner decision on 23 Oct, with no backups or point-in-time recovery from the provider. Local encrypted backups exist.

**Risk:** a paying customer's service would depend on another product's release schedule, and its recovery would rest on a local backup routine. LifeOS has no status page, service-level commitment, or load test.

**Verdict: move before a paying organisation, and decide the backup and recovery position for it.**

### 4. Licensing

**Facts found:**

- **The repository is public.** GitHub reports `ajootum/competen-healthcare` as public, so the LifeOS source and design are readable by anyone, including competitors, and this branch already is. It also holds other Competen material. **This one should not wait for the assessment: please decide it now.**
- **The prototype's wording draws on a published, commercially protected method:** "Habit 2 → Habit 3", "Begin with the end in mind", "Put first things first", "Big Rocks", the four quadrants. The V1.2 interface keeps "Begin with the end in mind. Put first things first.", "Big Rock" and the quadrants, because they are in the approved baseline. It drops "Habit". This needs a legal view before selling.
- **Not yet in place:** LifeOS terms of use, a data-processing agreement, a named operating entity for LifeOS, and a licence for external API users.
- **Open-source dependencies** were not audited for commercial licensing here. The CI dependency gate checks security, not licences.

**Verdict: legal work is needed whichever way the code moves.**

### 5. Extraction effort

**Measured:**

| Item | Size |
|---|---|
| LifeOS source files, excluding tests | 41 files in total, about 4,700 lines |
| Tests and harnesses | About 620 lines of unit tests, about 2,300 lines of harnesses |
| Migrations | 6 files, about 1,500 lines, all `lifeos_` objects |
| Files outside the seal that know about LifeOS | 7, 74 lines |

**The work:**

1. Create a private repository, a Supabase project and a Vercel project.
2. Copy `src/lib/lifeos/`, `src/app/lifeos/`, `src/app/api/lifeos/`, the migrations and the harnesses.
3. Replace `adapters/competen/guard.ts` and `browser-auth.ts`, which are the only files importing the rest of Competen, with direct sign-in and a chosen domain.
4. Replace the eligibility read for Competen Individual with a signed call or federated sign-in.
5. Move the data, adding one `lifeos_identity_link` row per person, so every record keeps its id.
6. Remove the 7 outside files' LifeOS lines from this repository.

**Risk:** people's sign-ins are the hard part. They would need a new password or a federated link. The sooner the move, the fewer people that affects. **Today it is nobody.**

**Verdict: small now, and it grows with every person and integration.**

## Before any paying organisation

| # | Item | Owner decision |
|---|---|---|
| 1 | Make the repository private | Now |
| 2 | Sessions on a tenant's domain (below) | Before custom domains |
| 3 | Own database, sign-in and deployment | Recommended before the first payment |
| 4 | Terms, data-processing agreement, operating entity | Legal |
| 5 | Legal view on the method wording | Legal |
| 6 | Backups and recovery for LifeOS | Spending |
| 7 | How a person's data is deleted on request. Today LifeOS never hard-deletes, and only export exists | Privacy and legal |
| 8 | What happens to someone whose only access came through an organisation that they leave. Today they can export but not use it | Product |
| 9 | Billing and plans. `lifeos_entitlement` has a plan field and nothing charges | Commercial |
| 10 | Load test and a support route | Spending |

## The open security decision

From the independent read of Stages 3 to 5. A person signing in on an organisation's domain has a full Competen session cookie on a host whose DNS that organisation controls. It could repoint the name to its own server and replay the session, reaching that person's private LifeOS records and any other Competen product they hold. The feature stays off until this is decided. The options:

- **A. Keep custom domains off until LifeOS has its own sign-in (recommended).** Moving LifeOS makes this far smaller, because a LifeOS session would no longer reach any Competen product. Sign-in would then happen on LifeOS's own domain, with a one-time handoff to a session that reaches only that organisation's workspaces. Personal work would stay on LifeOS's own domain.
- **B. Build that same handoff now, in this repository.** More work, and it solves only part of what the move solves.
- **C. Accept the risk for a named pilot organisation that is contractually bound.** Not recommended: it relies on trust where the product promises privacy from the organisation.

## What this assessment did not check

Prices, competitors, insurance, a penetration test, dependency licences, and any real user's behaviour.
