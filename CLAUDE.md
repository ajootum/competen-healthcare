@AGENTS.md

<!-- COMP-ENG-001 §4 — Claude Code Engineering Constitution -->
<!-- This section is repository hardening, not product redesign. It governs HOW work happens in
     this codebase, not WHAT the product does. It supersedes nothing above (@AGENTS.md's Next.js
     16 warning still applies to every session) and is itself subordinate to the developer
     specifications in docs/ and the ADRs in docs/adr/, which are the actual source of truth for
     product and architecture decisions. When this file and a spec disagree, the spec wins and
     this file is wrong and should be corrected. -->

## Repository identity

This is the authoritative Competen Healthcare application codebase — `ajootum/competen-healthcare`,
branch `main`. It is not a prototype, a fork target, or one of several competing copies. There is no
second Competen repository; do not create one, and do not re-scaffold the application to "start clean."

Distinct from and not to be conflated with Adlerc/AFCAN repositories or architecture — different system,
different rules.

## Documentation authority

Before implementing anything beyond a trivial fix, read in this order:

1. **The relevant developer specification in `docs/`** (64 files at last count — `ls docs/`). Specs are
   identified by a code like `CPR-PD-010`, `COMP-ARCH-PSA-001`, `CPR-CORE-MOS-001`. A spec is an
   implementation contract: code should be traceable back to the section of the spec it satisfies, the
   way every migration in `supabase/migrations/` cites the section it implements in its own header.
2. **`docs/adr/`** — the durable architecture decisions layer (COMP-ENG-001 §5). Read the ADR for the
   area you're touching before assuming how it works.
3. **`node_modules/next/dist/docs/`** — per `AGENTS.md`, because this Next.js version's APIs differ from
   training-data assumptions.

A developer specification describing a screen or a feature is not permission to redesign the substrate
underneath it. If a spec conflicts with an existing frozen decision, that conflict is a question for the
person who owns both documents — not something to resolve by picking the more convenient one.

## Frozen architecture — do not redesign without being asked

The following are settled decisions, not defaults waiting to be improved:

- **The two-gate product split** (`docs/COMP-ARCH-PSA-001-product-separation.md`, migrations 279+280).
  Platform and Practice are separate products with explicit `platform_membership`; `profiles.role` is
  nullable and Practice code must never read it.
- **The governance/product-line model** (`docs/` PLAT-GOV-001 / GOV-MC-001 material, migrations 281+282).
  `plat_product_line` is not `plat_products`. Mission Control composes per governance context. Exactly one
  active appointment decides authorization at any moment.
- **The CPR-MOB-001 responsive freeze** — one `md` breakpoint edge, `pointer-coarse` (not viewport width)
  gates touch-target sizing. This was an executed freeze, not a preference.
- **The CPR-HFE-001 sidebar and screen doctrine** (`docs/CPR-PD-SCREEN-DOCTRINE.md`,
  `scripts/pd-screen-doctrine-harness.ts`). Eleven items, five sections. The harness passing IS the freeze
  — do not hand-edit the nav and assume it's fine because it looks right.
- **Signup stays closed.** Supabase's "allow new users to sign up" is OFF by explicit owner decision.
  Never flip it, never build a path that assumes it's on.

Do not redesign frozen product, governance, tenancy, routing, HFE, or commercial architecture merely
because a plugin, a model, or a new spec's phrasing suggests an alternative would be cleaner. Propose the
change and get it decided; don't ship it as a side effect of an unrelated task.

## Product separation

Practice, Enterprise, Recruitment, Individual, and the landlord/HQ plane are separate products sharing
a foundation, not one product with modes. Code for one must not silently read or assume facts that only
make sense for another. See `docs/COMP-ARCH-PSA-001-product-separation.md` and the governance
product-lines material in `docs/` before adding anything that spans more than one.

## Tenant and data isolation

Cross-tenant and cross-product access boundaries are security controls, not convenience abstractions to
route around when a query would be easier without them.

- **`src/lib/access/plane-boundary.ts`** is the enforced boundary for what the landlord/HQ plane
  (`src/app/super-admin/**`) may read from tenant tables. It is an allowlist of table+column pairs, each
  with a stated reason, checked by `scripts/plane-boundary-harness.ts` via an AST walk (not a grep — see
  that file's header for why a grep already missed a real cross-tenant read once). Adding a table or a
  column to what the landlord plane may read is a security decision. State the reason in the allowlist
  entry the way every existing entry does.
- **RLS on `practice_*` currently carries zero policies on 209 of 209 tables** (confirmed live,
  2026-08-18). This is a known, load-bearing fact, not a bug to silently "fix" — isolation on those tables
  currently rests entirely on application-layer guards (the plane boundary above, and
  `requireHqCapability`/`resolveWorkspaceContext` on the tenant side), because the service role bypasses
  RLS entirely. Changing this is a governance decision with real blast radius, not a drive-by migration.
- Never compare an app-clock timestamp against a DB-clock one when deciding whether a grant is live —
  this has caused real capability-visibility bugs before (see git history on `access.ts`).

## Database

- **Migrations are the only way schema changes happen**, and they are applied **by hand, by the repo
  owner**, in the Supabase SQL editor — never auto-applied by an agent. A migration is not "done" until
  the owner confirms application; do not commit one before that confirmation.
- Every migration must pass `scripts/migration-house-rules.ts` before being sent. House rules include:
  ASCII-only content, no semicolons inside comments (the owner's runner splits on `;`), no partial unique
  indexes, `notify pgrst, 'reload schema';` last, and an `APPLY THIS FILE WHOLE` banner in the first 15
  lines for any file containing `$$`, `plpgsql`, or `create or replace function` (a semicolon-splitting
  runner would cut a function body in half otherwise).
- No silent or destructive schema changes. Preserve RLS posture and auditability; an append-only trail
  refusing `UPDATE`/`DELETE` must keep a cascade-allowance path (`pg_trigger_depth() > 1`) so a parent
  row stays deletable — this codebase has hit "the trail can never be removed by anybody" as a real bug
  more than once and the fix is now a known pattern, not a novel one.
- Prefer making a wrong state **unrepresentable** (a missing column, a `NOT NULL` constraint, a typed
  foreign key) over enforcing a rule only in application code. A rule enforced in a service layer dies
  with the second writer who doesn't know it exists; a rule the schema can't violate doesn't need anyone
  to remember it.

## UI / HFE

Reuse the established design language and component library (`--cmp-*` design tokens, the shared
`Explain`/`Cite`/`Absent` missing-evidence pattern under `_components/evidence.tsx` where one exists for
the surface you're building on). Accessibility and responsive behavior are mandatory, not best-effort —
this codebase has a recorded, repeated lesson that colour and type-scale carry real legibility weight and
defaulting to monochrome is not the safe choice.

Never claim a figure the underlying data doesn't support. Unknown, Not Measured, and No Producer are
legitimate states — render them as what they are, in the position the design calls for, with the reason.
Do not substitute blank or zero for missing evidence; a blank reads as a defect, a zero reads as a
measurement, and both are lies if nothing was actually measured.

## Testing

Match the verification to the claim:

- **Unit-level logic** → Vitest (`npm run test`), CI-blocking.
- **Cross-cutting invariants specific to this codebase** (plane boundaries, capability grants, migration
  house rules, spec-doctrine screens) → the acceptance harnesses under `scripts/*-harness.ts`. See
  `TESTING.md` for what each layer covers, when it runs, and what environment it needs.
- **Authorization and tenancy boundaries** are not optional to test. A change that touches
  `plane-boundary.ts`, `access.ts`, or any `requireHqCapability`/`resolveWorkspaceContext` call site
  re-runs the relevant harness before being considered done — this class of bug has shipped silently in
  this codebase before precisely because it looked like it worked from the UI.
- A harness that always passes is worth nothing. Prove a control can fail before trusting it: plant the
  violation, watch it go red, then restore.

AI-generated code is not accepted solely because it compiles. Correctness, authorization behavior,
regression against existing harnesses, and — where a spec defines acceptance criteria — actual
acceptance verification are all required before calling something done.

## Implementation protocol

Read the spec → inspect the affected code, schema, and auth path as they actually are (not as
remembered) → plan → implement → test → review. Ground claims about "what exists" in a real read or
grep, not in what a previous session or a comment claims — this codebase has a recorded history of
absences that quietly stopped being true (a column that got added, a table that got instrumented) while
the page still refused to use it.

## Git safety

No direct destructive Git operations without being explicitly asked: no unrequested `force push`,
`reset --hard`, history rewrite, or branch deletion. Never commit a secret — `.env*` is gitignored and
CI runs a gitleaks scan on a clean checkout before `npm ci`; keep it that way. Commit in small, reviewable
units as work is verified, not in one large batch at the end.
