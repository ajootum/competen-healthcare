# ADR-004 — Governance Freeze

**Status:** Accepted
**Enforced by:** `scripts/pd-screen-doctrine-harness.ts`; `docs/CPR-PD-SCREEN-DOCTRINE.md`; Supabase
project auth setting ("allow new users to sign up" = OFF)

## Context

Several structural decisions in this codebase were made deliberately, tested against real breakage, and
then explicitly frozen — meaning: not a default that happens to still hold, but a decision the owner
signed off on that later work must not casually reopen.

## Decision

The following are frozen, and reopening any of them requires an explicit owner decision, not an
incidental change while building something else:

1. **Signup is closed.** Supabase's "allow new users to sign up" is OFF. This is invisible from the repo
   — it lives in Supabase project configuration, not in code — and is one of at least three separate
   gates governing who can reach the product; the Supabase-level one bites first and is easy to forget
   exists precisely because it isn't in version control.
2. **The CPR-PD-001 sidebar and screen doctrine.** Eleven navigation destinations, five sections. Two
   rules govern every Product Director screen: the metric registry gates the *loader* (not the
   component — a component can't accidentally render a figure the loader never let through), and
   implementation identifiers (migration numbers, `file:line`) are a *placement* rule, not a ban — they
   must live inside a disclosure (`<Explain>`/`<Cite>`), never in text a reader can't avoid. Both rules
   are machine-enforced by `pd-screen-doctrine-harness.ts`, because screenshot review passed a violation
   of rule 2 twice before the harness existed to catch it in aggregate.
3. **The CPR-MOB-001 responsive freeze.** One `md` breakpoint edge; `pointer-coarse` (not viewport width)
   decides touch-target sizing, because width alone can't distinguish a touch laptop from a mouse one at
   the same viewport size.

## Consequences

- A spec that asks for a new screen does not carry authority to loosen the doctrine harness's rules for
  that screen. If the two conflict, that's an owner decision, not an implementation choice.
- The Supabase signup gate is not visible to any code-level audit (`grep`, a harness, a migration diff)
  — anyone auditing "how does someone get an account" must check the Supabase dashboard directly, not
  just the repo.
- The doctrine harness's per-module ratchets (ported ceiling on legacy violation counts) are allowed to
  fall but not rise. A module hitting its ratchet is a signal to fix that module, not to raise the
  ceiling.

## Do not

Do not flip the Supabase signup setting. Do not add an implementation identifier to visible screen text
because it's "just one line" — the doctrine harness will fail the build, and it is right to. Do not treat
a frozen decision as reopened just because a new spec's phrasing would be easier to implement without it.
