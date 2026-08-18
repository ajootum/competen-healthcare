# ADR-007 — Specification Traceability

**Status:** Accepted
**Enforced by:** convention (migration headers, harness naming, commit messages) — not currently a
machine-checked rule; see Consequences.

## Context

Every developer specification in `docs/` has an ID (`CPR-PD-010`, `COMP-ARCH-PSA-001`, and so on) and
usually numbered sections. Migrations, harnesses, and commit messages in this codebase's history
consistently cite that ID and section — a migration's own header explains *which section* of *which
spec* it implements and *why*, in prose a future reader can check against the actual spec text rather
than trusting a paraphrase.

## Decision

**Implementation traces back to a specification identifier, end to end: spec section → migration or code
→ harness assertion → commit message.** Concretely:

- A migration's header comment names the spec and section it implements, and states the reasoning — not
  just "adds column X" but *why* the spec requires it and what breaks without it.
- A harness assertion ID and message reference the same spec section, so a failing test tells you which
  requirement broke, not just which line.
- A commit message for a spec-driven change names the spec and explains what was built and why, in
  enough detail that someone who has not read the spec can still understand what changed and what
  guarantee it provides.

This is what makes it possible to answer "does this satisfy the spec" by reading the code and its
comments, rather than by re-reading the whole spec and guessing.

## Consequences

- A change implementing part of a developer specification should say which part, in the migration
  header, the harness, or the commit — whichever is closest to the actual logic.
- This ADR itself is an example of the pattern applied one level up: it exists because COMP-ENG-001 §5
  asked for it, and says so.

## Do not

Do not implement a spec requirement without noting which requirement it is, somewhere a future reader
will actually see it (not just in a chat transcript that won't be read again).

## Open item

This ADR records an existing **convention**, not a machine-enforced one — there is no current harness
that checks a migration or a commit actually cites a real spec section. Making that checkable (e.g., a
lightweight lint that a migration touching a `CPR-PD-0NN` area references that spec ID somewhere in its
header) is a reasonable future hardening step but is out of scope for this initial ADR set; recording it
here rather than silently deferring it is itself an application of ADR-007.
