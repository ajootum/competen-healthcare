# CPR-PD-013 §13 — deliverables and the prioritised gap backlog

**2026-08-19.** Every finding from this arc, classified against §4's taxonomy, ranked by consequence, with
what closes each. Findings are listed whether or not they were fixed, so the record shows what was
decided as well as what was done.

---

## Part 1 — §13's six deliverables, and their real state

| # | Deliverable | State |
|---|---|---|
| 1 | Implementation changes for the verified findings | **done** — all four, in Competen Practice where they live (see §14 below) |
| 2 | Focused regression/acceptance tests for each corrected behaviour | **done** — **27** assertions across four harnesses (treatment 5, PI 8, planner 8, PD doctrine 6). Seven were break-tested by planting the defect and watching it red; the rest are the CONTROL half of those pins, which prove the detector fires at all |
| 3 | UI-to-capability reconciliation inventory for the remaining screens | **done** — `docs/CPR-PD-013-RECONCILIATION.md` |
| 4 | Prioritised defect/gap backlog classified by the taxonomy | **this document** |
| 5 | Updated misleading copy discovered during the pass | **done** — six corrections, each verified absent from `src/` today (list below) |
| 6 | No redesign of screens classified NO GAP | **held** — nothing classified NO GAP was touched |

⚠ **Deliverable 2 was incomplete until this section was written, and finding that out was the point of
writing it.** Four corrections had shipped with no pin at all: the treatment status control, the Orders
copy fix, the period-preserving range picker, and the evidence-access logging. They are pinned now. A
deliverable list checked against the repository rather than against memory is the only kind worth having.

---

## Part 2 — the backlog, ranked

Severity is §9's scale: consequence × frequency. **Status** is what the code does today.

### P1 — a user sees something untrue

| # | Finding | Class | Sev | Status |
|---|---|---|---|---|
| 1 | `support/affected` displayed **0 open escalations** when the register could not be read; three sibling loaders had a failure notice and the fourth did not | `MISLEADING_INTELLIGENCE` | **high** | **FIXED** — renders *Not known*; pinned + break-tested |
| 2 | Ask Practice **suggested a question it then refused** — the pattern held `received`, the published example said `receive` | `MISLEADING_INTELLIGENCE` | **high** | **FIXED** — stems not conjugations; pinned by asserting every example against the parser |
| 3 | A **Patients-seen** figure cited `pi.avg_visits_per_patient` — a different metric's definition — because no registry entry existed for it | `MISLEADING_INTELLIGENCE` | **high** | **FIXED** — two metrics registered; found only by looking at the rendered screen |
| 4 | A non-Anthropic API key produced a confident **"Provider: openai / Model: gpt-4o"** while generation could not work at all | `MISLEADING_INTELLIGENCE` | medium | **FIXED** — `canGenerate` split from `configured`; refusal names which situation it is |

### P2 — a capability exists and no one can reach it

| # | Finding | Class | Sev | Status |
|---|---|---|---|---|
| 5 | **Treatment status** had a complete write path — engine validated, route forwarded — and no control on any screen | `MISSING_OPERATIONAL_CONTROL` + `STATE_EXPOSURE_DEFECT` | **high** | **FIXED** — the status cell is the control where the encounter is editable |
| 6 | The **useful / not-useful** control did not exist; engine, route, column and two counters all did, so both counters could only ever read 0 | `MISSING_OPERATIONAL_CONTROL` | medium | **FIXED** |
| 7 | **Treatments** and **Investigations** panels absent from Clinical Intelligence though both metrics were registered and both engines existed | `MISSING_OPERATIONAL_CONTROL` | medium | **FIXED** — engine extracted so screen and report cannot disagree |
| 8 | Ask Practice answered six question shapes and **never said which six** — examples rendered only inside the refusal | `ACTIONABILITY/HFE_DEFECT` | medium | **FIXED** — shapes render as one-click chips on the empty state |

### P3 — the UI exposes less than the approved engine

| # | Finding | Class | Sev | Status |
|---|---|---|---|---|
| 9 | **Duplicate offered 6 dates against an engine accepting 31** — the ceiling was `week.days` showing through the control | `ARTIFICIAL_UI_CONSTRAINT` | medium | **FIXED** — week + weekly repeat + free date, cap printed, batch read back |
| 10 | **Planner blocks could not be dragged**; the engine's move has always accepted a new date | `ACTIONABILITY/HFE_DEFECT` | medium | **FIXED** — drag onto a day in My Week; tap route preserved |
| 11 | **Changing the period silently dropped** the open cohort, the patient segment, the Ask question and the assistant session | `ACTIONABILITY/HFE_DEFECT` | **high** | **FIXED** — preserve-all, replace-only-range |

### P4 — governance and privacy

| # | Finding | Class | Sev | Status |
|---|---|---|---|---|
| 12 | **Named patient rows disclosed with no access-log entry** — Ask evidence (≤10 named, linked) and cohort lists (≤200); the only row written was the suite-level one | `AUTHORITY_MISMATCH` | **high** | **FIXED** — one row per disclosure, written only when identification happened |
| 13 | **`export.execute` and `licence.verify` granted and enforced by nothing** — zero routes, zero references | `AUTHORITY_MISMATCH` | low for a user, **medium for governance** | ⚠ **OPEN — needs a ruling.** Ratcheted so a third cannot appear |
| 14 | **No read-only Product Operations access exists** — one position holds the five screens *and* both writes | `AUTHORITY_MISMATCH` | medium | **FIXED** — `practice_product_observer` (migrations 345 + 346): 13 view capabilities, zero writes |
| 15 | **Provision and flag controls enforced at the API, not conditioned in the UI** | `ACTIONABILITY/HFE_DEFECT` | low today, medium after #14 | **FIXED** — shipped with #14, which is what made it testable. Proven: an observer sees the flag STATE, gets no toggle, no wizard, and 403 from both endpoints |

### P4b — found by the browser pass

| # | Finding | Class | Sev | Status |
|---|---|---|---|---|
| 20 | `/pd/configuration` **scrolled sideways by 194px** at 1440 — a bare `1fr` in an arbitrary Tailwind track is `minmax(auto, 1fr)`, so a `min-w-[560px]` table forced the grid past the viewport. **Five more PD grids had the same unguarded shape**, latent only because no child was wide enough yet | `ACTIONABILITY/HFE_DEFECT` | medium | **FIXED** — all six tracks `minmax(0,…)`; full re-sweep clean |

### P4c — found only by putting a real identity in front of a real screen

| # | Finding | Class | Sev | Status |
|---|---|---|---|---|
| 21 | **The observer position got the generic HQ nav, not the Practice workspace** — every PD page reachable by URL and none of it discoverable. `resolveMissionProfile` chooses the shell from `hq_position.product_line_code`, **not from capabilities**, and migration 345 left that column NULL | `ACTIONABILITY/HFE_DEFECT` | **high** | **FIXED** — migration 346 |
| 22 | **A `/*` inside a `//` comment blinded the doctrine harness**, blanking every line to the next `*/`. The failure direction is the dangerous one: it makes the scan UNDER-report | `n/a — control defect` | **high** | **FIXED** — line comments are blanked first |
| 23 | **A source path rendered in visible text on the Capability Registry screen**, standing since that module shipped and invisible to the harness because of #22 | `SPEC/UI_DRIFT` | medium | **FIXED** — moved behind `<Cite>` |

⚠ **#21 is the one worth remembering.** The grant table said 13-and-0 and was correct. Both harnesses were
green. The capability model was right. The workspace was still wrong, and nothing static could have said
so — it took appointing somebody and looking at what they saw.

### P5 — controls that could not fail

Not product defects. Listed because a harness that cannot fail is worse than no harness, and four were
found in two days.

| # | Finding | Sev | Status |
|---|---|---|---|
| 16 | The **PI suite harness pinned v1's nine tabs** against a v2 array of twelve — red-if-run for as long as nobody ran it, because every PI harness is `privileged-live` and none runs in CI | **high** | **FIXED** — asserts the strip by name; the re-homing pin rewritten to the requirement rather than one historical shape |
| 17 | A clinical-vocabulary pin matched **`durationOther`** for the seeded label `"Other"` — red on main for the wrong reason | medium | **FIXED** — word-bounded |
| 18 | My own §8 Duplicate pin **passed its own break-test** (`repeatDates` found inside `repeatDatesX`; its date-input half satisfied by `MoveForm`) | medium | **FIXED** — scoped to `DuplicateForm`'s body |
| 19 | My own range-picker pin **passed a break-test that had genuinely reverted the fix** — the needle also matched an unrelated `URLSearchParams` further down the file | medium | **FIXED** — scoped to `go()`'s body |

⚠ **Three of those four are the same shape: a substring that matches something other than what the
assertion is about.** It is now the most frequently recurring defect class in this repository. The
standing fix: scope the scan to the function under test, and use word boundaries.

---

### The six copy corrections (deliverable 5)

Each verified absent from `src/` today, not merely edited at some point:

1. *"its status column is never written after insert"* — Orders Intelligence, false once the write path
   existed. ⚠ And it was **never user-facing**: `modules.orders` is read by no screen and no report
   template. Corrected anyway, because the day somebody mounts the tile they will trust it.
2. *"The catalogue names a Custom category"* — it names six, none of them Custom. A sentence explaining
   an absence had invented a detail.
3. *"…with a Run now button"* — no such button exists. ⚠ Its **first half was checked and kept**: the
   daily cron reads `report_schedules` and links into `/assessor`, so Practice's own schedules genuinely
   have no executor.
4. *"DRAG AND DROP (s5) IS NOT BUILT"* — the DayPlanner header block, stale the moment §7 shipped.
5. *"Dragging a block to a new time is not built on this screen"* — **half true and kept as half**:
   dragging to another *day* now works, dragging to another *time* still does not.
6. *"Provider: openai / Model: gpt-4o"* rendered as though live on a build that generates only with
   Anthropic.

## Part 3 — what is NOT in this backlog, deliberately

- **The 23 `PdNotBuilt` shells.** Each names its spec and the missing substrate. NO GAP — re-reporting
  them as defects is the failure this estate keeps repeating.
- **PD Releases rendering no activate/rollback button.** The screen states it holds both capabilities,
  cites migration 311, and explains that §25's objects do not exist. Verified against the live grant
  table. NO GAP, and the best example in the workspace.
- **Governance, Configuration and Health.** Read against PD-010, PD-011 and PD-008; no gap found on any
  criterion checked. See the reconciliation §6.2–6.4.
- **The PD workspace being read-only** (86 pages, zero write surfaces). Reported in reconciliation §1 as
  a product-shape question, not a defect: nothing is mis-enforced and nothing is unreachable.

## Part 4 — the three open items, in the order they should be taken

1. ~~**#14 → #15**~~ — **done.** The order proved itself: the conditioning was only testable once an
   identity existed that the API would refuse, and appointing one immediately exposed a defect no
   harness had (see #21).
2. **#13.** Revoke `export.execute` and `licence.verify`, or record why a dormant grant is intended.
3. ~~The browser pass~~ — **done. 86/86 rendered clean**, one defect found and fixed (#20 below).
   ⚠ **What it leaves open, precisely.** The sweep proves the screens *render and work*. It does not
   prove they are *populated*, and it covers only the no-horizontal-loss third of
   *"responsive/accessibility/collapsed-sidebar testing passes"* — over a six-screen sample at the two
   smaller widths. **Collapsed-sidebar behaviour, touch targets, keyboard traversal, focus order and
   contrast remain unexercised**, as do the criteria needing a person or a controlled environment
   (*"synthetic checks cannot create uncontrolled real patient records"*, *"recovery requires governed
   confirmation"*). Those are the real remainder, and they are smaller than what was closed.
