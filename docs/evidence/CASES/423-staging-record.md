# Migration 423 (case candidacy, candidates and delivery): staging record

**Authority:**
- Owner GOs COMPETEN-HOLDINGS-AI-CONSUMPTION-01 (s7, s10) and COMPETEN-SCHOLAR-CLINICAL-REASONING-01.
- The Stage 5 case interface approval: a separate, revocable permission, de-identified candidates, and the deterministic gate.
- IND-004's C-a to C-e and D-a to D-e.
- Coordinator range 421 to 424.

**Who and where:** the main session applied 423 on 24 October 2026 from the cfca worktree (branch `holdings/case-intelligence`), in the order 395, 422, 423, with the guarded runner. The target was ezhvpgtcqcdsgylrxgdb in every step, the guard passed, and every run reported "ok".

**OPS-001 s8 tier:** Medium, so the rollback was rehearsed. 423 holds the content a person offered and the permission it rests on.

**Fingerprint tools** (read-only):
- `npx tsx scripts/ind007-staging-schema-check.ts --cases423`
- `npx tsx scripts/ind007-staging-schema-check.ts --cases422`

| Step | `--cases423` | `--cases422` |
|---|---|---|
| PRE | 9ecad043… | 6e69086a… |
| Apply ×2 | ok. F1 = dfbea91a… | |
| Rollback (ROLLBACK-423.sql, a2270285, committed; no candidacy, candidate or session data) | F2 = 9ecad043… = PRE | 6e69086a… = the F1 of 422 (restored) |
| Re-apply ×2 | ok. F3 = dfbea91a… = F1 | |

`--cases422` reads the case_library% triggers and functions, so it moves while 423 is applied, which is expected. It returns to the F1 of 422 after ROLLBACK-423.

**Files** (bytes matched before and after the runs):
- 423-case-candidates-and-delivery.sql: sha256 651d2bdab090b8ef078cea8285c6ff2da0ef4c32752ad2fbb8f3896fc31e0183. House rules ALL CLEAR (541 lines, 249 statements, 5 constraints, 3 APPLY-WHOLE warnings only).
- ROLLBACK-423.sql: sha256 a2270285b45c61943ee889209fe708c5c45617c7a0672a88970880ff44d010aa. It removes exactly what 423 added (the trigger of 422 stays), and refuses once any candidacy, permission event, candidate or session exists, or any library version names a candidate.

**Proven locally before staging** (Postgres 17, on stubs plus the real 395 and 422), `t423.sql`, sha256 682ae33e…, X1 to X11 all PASS:
- **X1:** the backstop finds each kind and leaves clinical text alone.
- **X2:** no permission means no offer. The attestation and the queue metadata come from the database. An ineligible offer keeps no content.
- **X3:** content an AI says is de-identified but which holds an NHS number is refused.
- **X4:** the content, owner and attestation are immutable, and a candidate cannot be deleted.
- **X5:** take, release and decline work, and a decline purges.
- **X6:** promotion is refused for the wrong state, the wrong author or the wrong rights.
- **X7:** revocation withdraws and purges, keeps the promoted case, and refuses new offers. The permission history is append-only.
- **X8:** withdrawing by source, and retention, both work.
- **X9:** an educator draft with an MRN is refused at submission.
- **X10:** a session starts only on a deliverable version, and its identity is fixed. The queue has no student columns and no browser-role grant.
- **X11:** erasure.

Six planted SQL violations each turned the suite red. Local rehearsal: PRE = F2, F1 = F3.

**On staging, after application:** `case-intelligence-acceptance-harness` checks the real 423 triggers directly.
- G0 (the gate off), P0 (parity on the shared corpus), D1 (the permission), D2 (the backstop), D4 (the queue view closed to the anon key) and D5 (no session before deliverable).
- J1 to J9 are the journey.

Its run is recorded below the dependencies.

**The calendar-date question, for the owner.** The backstop refuses full calendar dates (dd/mm/yyyy, yyyy-mm-dd) outright, and the application screen also refuses written dates ("12 March 2024") and two-digit-year dates ("12/03/24").
- **Relative clinical times pass both layers.** On the shared corpus: "day 2 post-op", "post-operative day 3", "3/7 history", "1/52 ago", "at 14:00", "06:00 observations", "Q4H", "GCS 14/15", "BP 85/50".
- **One known false refusal, alike in both layers:** 24-hour times separated only by spaces ("observations at 0800 1200 1600") read as a telephone number. With commas ("0800, 1200 and 1600") they pass.
- Whether a shared case may ever carry an absolute date is the owner's decision. The screen keeps it refused until then.

**Frozen.** Further changes are fix-forward.

**Dependencies:** 422 (and so 395) and profiles. **Application order:** 395, 422, 423.

**Production:** not applied, not authorised. It needs its own GO, and the legal review of publishing student-derived cases is a production dependency.

**The gate (CLAUDE.md lifecycle state 3).** Every action that starts case work is behind the platform flag `case_library` (`practice_platform_flags`), which is OFF unless written:
- granting candidacy and offering a case;
- the studio route and pages;
- searching, loading and starting a library case.

It is unwritten in production. A student's revocation, withdrawal and view of their own offers are never gated. The code also fails closed if 423 is absent. The static harness K10 checks the gate, with plants. The staging journey switches the flag on for its own run and restores it (Z0).

## Staging acceptance run (24 October 2026, target ezhvpgtcqcdsgylrxgdb)

`npx tsx scripts/privileged-harnesses.ts --staging --only case-intelligence-acceptance-harness`: **ALL GREEN, 22 passed, 0 failed** (commit b194515e).

- **G0:** with the flag off, granting is refused and a search offers nothing, while a withdrawal still works.
- **P0:** staging's `case_identifier_kinds()` and the application screen agree on all 15 corpus texts, and the application is at least as strict.
- **D1:** the real trigger refuses an offer without the permission, even written directly.
- **D2:** the real backstop refuses an eligible offer carrying an NHS number written directly past the screen. The offer carried "AI screen says de-identified" in its provenance.
- **D4:** the anon key cannot read the queue view, and reads nothing from the candidate table.
- **D5:** the real trigger refuses a session on a submitted, unapproved version.
- **J1 to J9:** the journey.
  - Candidacy is granted only on the current text.
  - Offers are eligible or ineligible correctly, and an ineligible one keeps no content.
  - The 24-hour queue lists only eligible offers, names no student, and spends no AI.
  - Take, promote, edit and submit work, through 395.
  - The editor cannot approve their own case.
  - Nothing publishes before an independent scoped reviewer approves.
  - A second student finds the case and works through it deterministically, with no AI.
  - Revocation keeps only the promoted case.
  - Intelligence counts the journey.
- **Z0, Z1:** the flag is back exactly as found (unwritten), and the five synthetic people, their appointments, scopes, permission, offers and sessions are removed.

**Read-only after the run:**
- The one retired fixture case `CASE-HARNESS-202610242133` remains, by design.
- `case_library` is unwritten.
- There are 0 candidacy rows, 0 sessions and 0 reviewer appointments.
- The eight CF-FOUND versions still have 0 decisions.
