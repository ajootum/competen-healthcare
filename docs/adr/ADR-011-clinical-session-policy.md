# ADR-011: Clinical session policy — 10-minute lock, 30-minute logout

**Status:** Accepted — owner decision, 2026-08-19. Configurable later; unsaved work preserved where
technically safe.

## Context

COMP-AUTH-001's defaults (5-minute idle lock, 30-minute logout) are shared-ward-terminal numbers.
COMP-SECURITY-SURVEY-001 §8 item 3 flagged them as hostile to a clinician documenting an encounter and
asked for clinical defaults to be decided **before** the engine is built rather than after.

## Decision

- **Lock at 10 minutes** of inactivity — the cover, not a sign-out.
- **Log out at 30 minutes** — session revoked.
- Policy **configurable later**; these are the defaults.
- **A locked session preserves unsaved work where technically safe.**

## ⚠ What this needs that does not exist yet

The decision names **two** thresholds. The implementation has **one**.

- `practice_security_policy.session_idle_minutes` (nullable) drives *both* the client cover and the
  server-side revocation today. There is no second threshold, so "lock at 10, log out at 30" is not
  expressible by changing a constant — the engine needs a distinct lock threshold separate from the
  revocation threshold (`src/lib/practice/session-engine.ts`, `idleDecision`; revocation in
  `security.ts` under `IDLE_REVOKED_REASON`).
- `IDLE_OBSERVATION_MINUTES = 30` is the **observation** default, and the one live practice carries
  `session_idle_minutes: null`, so the engine is in OBSERVE mode: **nothing locks and nothing logs out
  today.** It writes one audit row per idle stretch over thirty minutes. Enabling enforcement is a
  policy row, not only code.

So: the configurable half is partly built (one per-practice column exists), the two-threshold model is
not, and enforcement is currently off everywhere.

## Unsaved work

- **The lock preserves it by construction.** `PracticeSessionGuard` renders the cover as an overlay
  above the running app, so React state behind it survives — nothing is unmounted and no navigation
  occurs. Unlocking returns the practitioner to exactly what they were typing.
- **The logout cannot, and should not pretend to.** Revocation ends the session server-side; the next
  request lands on `/practice/access-status`. "Where technically safe" is precisely this boundary: the
  10-minute cover is safe, the 30-minute revocation is not, and a design that implied otherwise would be
  promising to hold clinical text it has nowhere to keep.

That asymmetry is the reason the two thresholds are worth having: it gives a clinician twenty minutes in
which their work is behind a lock rather than gone.

## Do not

- Do not implement this as one threshold with the lock and logout at the same moment; that discards the
  twenty-minute preservation window which is the point of the decision.
- Do not enable enforcement for a practice without its policy row, and do not treat
  `session_idle_minutes: null` as "use the default" — it currently means OBSERVE, and silently changing
  that meaning would enforce a lock-out on every practice at once.
- Do not claim unsaved work survives a 30-minute logout.
