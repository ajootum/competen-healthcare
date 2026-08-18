# ADR-009: Initial recovery objectives — RPO 24h, RTO 8h

**Status:** Accepted — owner decision, 2026-08-19. **Initial targets, subject to tightening as the
product matures.**

## Context

`docs/COMP-SEC-001-CONFORMANCE-001.md` carried two adjacent rows that could not be assessed:

| Row | Verdict before this ADR |
|---|---|
| Automated encrypted backups | PLATFORM-ATTESTED — "the attestation should name the tier and its actual PITR window" |
| High availability | PLATFORM-ATTESTED — host SLAs |
| Disaster recovery testing | **NOT SATISFIED** — never performed |
| RPO / RTO objectives | **NOT SATISFIED** — never defined |

The last row was blocking the one above it. A rehearsal with no target measures nothing: you can restore
a database, observe that it took some number of hours, and have no basis on which to call that a pass or
a failure. The survey's own note said as much — defining them is *"a one-page owner decision that gives
the two lines above something to be tested against."*

## Decision

- **RPO = 24 hours.** Maximum acceptable *permanent* data loss after a catastrophic failure.
- **RTO = 8 hours.** Target time to restore the *core service* after a *declared* disaster.

**These are initial service targets and are expected to tighten.** They were chosen to be honest about
where the product is today rather than aspirational, so that the first rehearsal produces a real
pass/fail rather than a foregone failure against a number nobody has evidence for.

## Consequences

- `src/lib/super-admin/recovery-objectives.ts` holds both as constants. The DR console at
  `/super-admin/system/data` prefills them as the target on a logged exercise, replacing placeholder
  hints of 15 min / 120 min that matched no agreed target and were *stricter* than what the business had
  actually committed to. A blank target field made "target vs actual" unfalsifiable after the fact.
- The RPO/RTO panel now shows the committed objective when no test-specific target exists, rather than
  an em dash that read as "nobody has decided".
- ⚠ **These are objectives, not capabilities, and the surface says so.** No restore has been rehearsed.
  Until one is, backup conformance remains a claim about Supabase's platform rather than a demonstrated
  fact about this product's recoverability, and the panel prints that sentence rather than letting two
  targets imply a tested system.
- The rehearsal that will measure them is `docs/COMP-DR-001-rehearsal-runbook.md`. Per owner decision the
  same day, **it runs against staging, never production** — which makes it dependent on COMP-ENG-002.

## Do not

- Do not report these as achieved recovery figures. They are targets with no measurement behind them
  until a rehearsal produces one.
- Do not loosen either number to make a rehearsal pass. A missed target is the finding; the objective is
  the fixed point the finding is measured against.
- Do not rehearse against production (owner decision, 2026-08-19).
