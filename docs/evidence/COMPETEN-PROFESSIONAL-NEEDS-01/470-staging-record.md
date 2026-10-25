# Migration 470: staging record (coordinator, 25 Oct 2026)

**Target:** ezhvpgtcqcdsgylrxgdb (staging), applied with the guarded runner, file whole. FINGERPRINT-470 and VERIFY-470 were run with the read-only runner.

| File (LF, 0 CR) | sha256 |
|---|---|
| 470-individual-professional-development-needs.sql | e53ce82e273ec080bcdf87ce861db2cb66d8cdbe8132cad589e289353412292a |
| ROLLBACK-470.sql | 47a179e39d972399760646f8409d3c2d279fafbd0e77fcb362764e6af20b408f |
| VERIFY-470.sql | 0d2939c3d8792607afb24c97dbea43fb1c8bf69dbb1ec58916346cca4f340ac0 |
| FINGERPRINT-470.sql | 8e446160534729449e6cf8f3b813eb3819764b69aa45204192cfbc63028f89c4 |

**Pre-application record:** `individual_professional_need` holds 0 rows on staging, so the backfill touched nothing. It still held 0 rows afterwards.

| Step | FINGERPRINT-470 |
|---|---|
| PRE | b46ab0fa1b8a2ae2131aa2da2250cd85, 332 items |
| Apply #1 | a0812a5017bfcfb6f49a0d2142d07b55, 443 |
| Apply #2 | a0812a5017bfcfb6f49a0d2142d07b55, 443 (idempotent) |
| ROLLBACK-470 | b46ab0fa1b8a2ae2131aa2da2250cd85, 332 = PRE |
| Re-apply | a0812a5017bfcfb6f49a0d2142d07b55, 443 = apply #1. **The current staging state.** |

**VERIFY-470,** after apply #2 and again after re-apply, all as expected:
- §1: 15 columns.
- §2: five tables, each RLS t | 1 | 1 (goal_need, need_competency, need_history, need_suggestion, reflection).
- §3: four triggers (competency_guard, history, history_append_only, stage_sync).
- §4: 0 | 0 | 0.
- §5: 0.
- §6: 0.
- §7: the origin CHECK lists 9 origins.
