# QUEUED — the platform-oversight remainder (D5's writer, and D6)

**Status:** migration 273 applied. The two engine halves are unbuilt. Queued behind the platform-membership,
HQ-appointment and period-navigator arcs — all three are live in or beside `src/lib/hq/`, and a fourth
concurrent change to the HQ gate is how a mistake gets made.

**Source:** `docs/PLAT-OVERSIGHT-SURVEY-001.md`, decisions **D5** and **D6**.

---

## What landed

Migration **273** (applied 2026-08-10), verified live:

- `practice_licence_verification` — the ledger table, present.
- `hq.practice.licence.verify` — added to the HQ catalogue (`practice` space); it was genuinely absent. The
  catalogue is now 30 codes.
- Granted to **`practice_product_director` only**.
- A provenance CHECK on `practice_practitioner_identity`:

```sql
check (licence_verified_at is null
       or (licence_verified_by is not null and btrim(coalesce(licence_reference, '')) <> ''))
```

⚠ **That constraint is the substance.** A verification cannot exist without naming WHO checked it and WHICH
register. The engine can rely on it rather than restate it — which is the right way round, because the
practitioner-facing door was nailed shut precisely to stop a clinician recording that somebody checked their
own licence.

It changed no behaviour on apply, and could not fail: all 45 identity rows have every licence field null.

## What did NOT land

### 1. D5's writer — the table has no engine

Nothing in `src/` inserts into `practice_licence_verification`. A store with no writer, which is the same
"built and unreachable" defect the door sweep exists to find, inverted.

Needs: an engine gated on `hq.practice.licence.verify`, writing `licence_verified_at`,
`licence_verified_by = the operator` and `licence_reference`, plus the ledger row. And an operator surface.

⚠ **The boundary that must survive it:** `scripts/practice-booking-link-harness.ts` (34/0, and 5c in
particular) asserts that a public booking page carries only what the practitioner stored. Licence
verification must NEVER surface to a patient as a verification tick. Re-run it after building.

### 2. D6 — allowed reads are still not recorded

`src/lib/hq/context.ts` still records only refusals (`if (!verdict.allowed)`). The decision was to record
ALLOWED reads too, **including owner reads** — and the owner branch currently returns before `record()` is
reachable, so the two accounts whose reads most need a trail leave none.

`hq_access_observation` therefore observes only what it refuses, and it has refused nothing, because nobody
is appointed.

### ⚠ THE FAILURE POSTURE — SETTLED BY THE OWNER, 2026-08-10

> **"The read should proceed and flag, never refuse."**

So: if the record of an allowed read cannot be written, the read still happens. Refusing would mean a
platform outage becomes a platform lockout, and the people it would strand are the ones holding the console
that fixes it.

⚠ **BUT "FLAG" IS WHERE THIS GOES HOLLOW, AND THE IMPLEMENTATION MUST NOT LET IT.** `context.ts:153` already
calls the observation write *"Best-effort … an observation nobody could record is not a refusal"* — and
best-effort with a swallowed `console.error` is fail-soft wearing a warning's clothes. The decision is
proceed-and-flag, not proceed-and-hope. So the flag has to be somewhere a person actually looks:

- ⚠ **It cannot be a row in the same database**, because the likeliest reason the audit write failed is that
  the database is unreachable — the flag would fail for the same reason and vanish with it.
- The server log is the only destination guaranteed to survive that, so it is the floor, not the answer.
- **The operator console must be able to say "reads are not currently being recorded"** — a live state, not
  a count derived from rows that were never written. An unrecorded read leaves no trace to count, which is
  precisely why the absence has to be reported at the time rather than reconstructed later.
- **And it must be visible to the practice too.** The destination chosen for D6 is the practice's own
  `practice_audit_event` trail so a practitioner can see who read their data. A gap in that trail is a fact
  about their record, not only about our infrastructure.

A read that proceeded unrecorded is a real event. The rule is that it is never silent.

The survey (§6.3) offers three destinations and the owner chose the transparent one — `practice_audit_event`,
the practice's own trail, visible to the practitioner. ⚠ Note that table is **append-only** since migration
247 (a `BEFORE DELETE` trigger raises), which is what makes it a credible access log — and also means a
harness must never try to clean up after itself there.

## Order when it is picked up

1. ~~Settle D6's failure posture~~ — SETTLED: proceed and flag, never refuse. See above.
2. D6 in `context.ts` — record allowed reads, including the owner branch, into `practice_audit_event`.
3. D5's engine and operator surface.
4. Re-run `practice-booking-link-harness` and `hq-guard-harness` (⚠ the latter's `E1` page-count baseline is
   already red at 205 vs 204 — see `POST-ARC-CHECKLIST.md`).
