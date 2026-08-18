# COMP-DR-001 — First disaster-recovery rehearsal

**Owner decision, 2026-08-19:** conduct the first DR rehearsal **against staging, never production**.
Targets are ADR-009: **RPO 24h, RTO 8h**, initial and subject to tightening.

## ⚠ Status: cannot be conducted yet, and the blocker is not a detail

The rehearsal's second step is *"create an isolated recovery target"*. **No staging project exists**
(COMP-ENG-002 §12 steps 3-6 are outstanding), so there is nowhere to restore into that is not
production — and restoring into production is precisely what the decision forbids.

Provisioning a Supabase project requires dashboard and billing access. It is an owner action, not
something an agent can perform. **This document is therefore the procedure, ready to execute, and no
part of it is claimed as done.**

## Before the first run

| Prerequisite | Why | Status |
|---|---|---|
| Staging Supabase project | The isolated recovery target | **Outstanding** — COMP-ENG-002 §12.3 |
| Known backup tier + PITR window | You cannot measure RPO against an unknown retention window | **Outstanding** — the conformance map asks for the tier to be named |
| Synthetic practitioner identity | Step 6 runs authenticated smoke journeys | **Script ready**, needs staging |
| DR event logged in the console | The audit trail is `/super-admin/system/data` (migration 063) | Ready — targets now prefill from ADR-009 |

## The procedure

Log the exercise in the Recovery console **first** (`kind: dr_test`, scope, targets prefilled), so the
event exists before the clock starts and the outcome attaches to it afterwards.

**Start the clock when the disaster is declared, not when the restore command is typed.** RTO is measured
from declaration to service restored; time spent deciding, locating a backup, or finding credentials is
part of the real number and is exactly what a rehearsal exists to expose.

| # | Step | What to record |
|---|---|---|
| 1 | **Backup** — identify the backup/PITR point being restored from | Its timestamp. `now − that timestamp` is the RPO you are about to demonstrate. |
| 2 | **Create isolated recovery target** | Project ref. Must not be production, and must not be the working staging project if that is in use for other testing. |
| 3 | **Restore** | Start/finish time. Whether it needed intervention. |
| 4 | **Apply / verify configuration** | RLS, auth settings, storage policies, functions, triggers. ⚠ Schema restored ≠ behaviour restored — verify RLS posture explicitly (209 `practice_*` tables carry RLS with zero policies; a restore that "improves" that is a failed restore). |
| 5 | **Start Competen** | Point the app at the recovered project. Time to first successful boot. |
| 6 | **Run critical smoke tests** | `npx playwright test`. The suite is already the right instrument: journeys 1, 2 and 7 need no credentials, and 3-6 exercise real authenticated routing once the synthetic identity exists. Record passed/skipped/failed verbatim. |
| 7 | **Verify representative records** | Pick specific rows *before* the restore and check them after — a practice, a membership, an entitlement, an audit row. ⚠ Count-matching is not verification: a table can have the right number of wrong rows. |
| 8 | **Measure elapsed time** | Declaration → service restored. This is RTO actual. |
| 9 | **Compare with RPO / RTO** | RPO actual from step 1, RTO actual from step 8, against 1440 / 480 minutes. |
| 10 | **DR report** | Record the outcome on the logged event: pass / partial / fail, both actuals, and what was found. |

## What counts as a pass

A pass is **all four** of:

- RPO actual ≤ 24h and RTO actual ≤ 8h
- The smoke suite green against the recovered environment (skips are acceptable and expected for
  credential-gated journeys; a **failure** is not)
- Representative records verified individually, not by count
- Configuration verified as behaviour, not merely as schema

⚠ **A missed target is a finding, not a reason to move the target.** ADR-009 is explicit: the objective
is the fixed point the finding is measured against.

⚠ **And a rehearsal that only ever passes is worth little.** The same discipline this repo applies to its
harnesses applies here: the first run's job is to find what is broken while it is cheap. A first
rehearsal that passes cleanly on every step deserves suspicion about whether the failure was real.

## Recording the result

The console at `/super-admin/system/data` holds the trail: log the event, then close it with
`Record Outcome` carrying `rpo_actual_min`, `rto_actual_min` and the note. Targets prefill from
ADR-009 so an exercise cannot quietly be scored against a number nobody agreed.

Once a first outcome exists, `docs/COMP-SEC-001-CONFORMANCE-001.md` can move
**"Disaster recovery testing: NOT SATISFIED"** to a real verdict — and only then does
"automated encrypted backups" stop being a claim about Supabase and start being a fact about Competen.
