# P0 CFCA: the staging mirror of production's clinical reference structure

**Source:** `supabase/reference/cfca-export.json`, sha256 f14eead56701cb508758caf546309ab4661ffabb40bcaa6f461fc76999515b59. It was exported on 2026-10-24 at 06:00:09 UTC by `supabase/reference/cfca-export.sql`, a single read-only SELECT run on production outside this session.

**Checks before writing:**
- `checkExport` found no problems: no column outside the export contract, and every parent travels with its rows.
- No email address and no phone-like number (outside UUIDs).
- 0 hospital-owned practices.

**What production holds (shared frameworks touching the CKCM spine):**

| | Count |
|---|---|
| Frameworks | 2: Core Nursing (published), Demo: Oxygen Therapy (CKCM) (published) |
| Domains | 16 |
| Practices | 16: PRA-AIR, ASM, BRE, CIR, COM, DIS, EOL, EXP, FAM, GAS, IPC, MED, NEO, OXY, QLT, REN (each -001) |
| Clinical practice units | 2: CPU-DIS-010 (Gait, Balance and Mobility Assessment), CPU-OXYSAFE-001 (Safe Oxygen Administration) |
| Blueprints / methods / evidence rows / critical-failure rules | 1 / 4 / 4 / 14 |
| Competencies | 29. 14 are linked to a practice and a CPU: 11 to PRA-DIS-001, 3 to PRA-OXY-001 |

**What that means for a respiratory and cardiovascular catalogue:**
- The airway, breathing, circulation and assessment practices (PRA-AIR, PRA-BRE, PRA-CIR, PRA-ASM) exist on production but hold **no CPU and no competency**.
- The only respiratory content linked to the spine is Oxygen Therapy (demo framework, 3 competencies).
- Core Nursing's Airway, Breathing and Circulation domains hold the rest.

**Run on staging (ezhvpgtcqcdsgylrxgdb), with `npx tsx scripts/seed-staging-cfca.ts`:**

| Step | Result |
|---|---|
| verify, before | 0 of 88 exported rows present |
| create | all 88 written by id |
| verify | staging holds the export exactly |
| create again | staging holds the export exactly (idempotent) |

**Side effect, and how it is handled:** staging already had its own, different "Core Nursing" (draft, 67 competencies). Staging now holds both.
- The S1 seed takes the oldest Core Nursing.
- The S1 acceptance harness resolves Core Nursing by NUR-RESP's parent id.
- The controlled-catalogue seed takes the Core Nursing whose domains hold the practices, which is production's.
- `competency-foundation-acceptance` passes 9/9 after the mirror.
- Two older seeds look Core Nursing up by name and would now fail on staging: `scripts/seed-catalogue-practices.mjs` and `scripts/workforce-seed-templates.mjs`. Neither is part of a harness run, and they are left unchanged.

**Not touched:** the Individual allowlists (Professional's stays empty), and production.
