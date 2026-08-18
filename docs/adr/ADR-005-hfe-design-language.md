# ADR-005 — HFE Design Language

**Status:** Accepted
**Enforced by:** `src/app/globals.css` (`--cmp-*` tokens); `src/app/super-admin/pd/_components/evidence.tsx`

## Context

This codebase has a recorded, repeated failure mode: building a screen in monochrome greys because it's
the "safe" default, when the design tokens for a real colour system already existed. The owner raised
this same complaint on separate screens on more than one occasion — the tokens were never the blocker;
defaulting away from them was. Colour weight is a legibility property (does a scan-in-ten-seconds screen
actually scan), not a decoration one, and treating it as optional decoration is what caused the repeated
complaint.

Separately, missing-evidence rendering — "this figure can't be shown, and here's why" — was invented
independently by at least three modules before a shared component existed, meaning the same UI pattern
had three slightly different implementations with no single point of correction.

## Decision

**New Product Director / HQ screens use the existing `--cmp-*` design token system for colour and the
shared `Explain`/`Cite`/`Absent`/`AbsentList` components from `evidence.tsx` for missing-evidence
rendering** — taken by import, not recreated locally. A module-local reimplementation of the
missing-evidence pattern is tracked by the doctrine harness as a ratchet that may fall but must not rise.

Colour is not applied for decoration; it's applied because a figure, a status, or a row that means
something different from its neighbours should be visually distinguishable from across the room, not
just on close reading. Colour is never the *only* signal for state (a lifecycle badge prints its own
word; colour is the emphasis, not the message) — this is the accessibility half of the same rule.

## Consequences

- A new screen defaulting to grey-on-grey for figures that carry real meaning is treated as a legibility
  bug, not a style preference, and should be corrected before the screen ships, not after the owner
  raises it a fourth time.
- A new "this can't be shown" state should import the existing pattern, not invent a fourth local
  version. If the existing pattern doesn't fit, that's a reason to extend it, not to fork it.

## Do not

Do not ship a data-dense screen in uniform grey. Do not build a new local missing-evidence component when
`evidence.tsx`'s exports would work with minor extension. Do not use colour as the only carrier of a
state — the word is still required.
