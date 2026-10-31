# Migration 752: build record (a pending layout is applied in the same transaction as its publication)

- **Authority:** owner GO FRAMEWORK-DESIGN-STUDIO-01, 31 Oct 2026, implementation only (ruling 3 in `STATUS.md`). Fix forward of slice B's app-level apply/undo (750 and 751 are not edited).
- **Branch:** `hq/framework-design-studio-01`.
- **File:** `supabase/migrations/752-framework-layout-apply-on-publish.sql`, sha256 `6d08ec5e9a1fc46ee67c2685ac43c997e8aa5311ed7bb7ddb43399413a697d6c` (the file staged, to be merged and applied).
- **Rollback (staging):** `ROLLBACK-752.sql`, sha256 `1f198de12f30cfae7c14d4a98785e4b26612d4f0d8b7945afa9417772b4c2f0d`.
- **PRECHECK / VERIFY:** `PRECHECK-752.sql` (sha256 `6717b9f6...d7c9`), `VERIFY-752.sql` (sha256 `c87285d2...9b56`). Both always roll back.
- **House rules:** ALL CLEAR (277 lines, 87 statements, 0 constraints, 3 warnings = the APPLY-WHOLE constructs).

## State

**State 2: applied and verified on staging. Production does NOT have it.** It needs a separate owner GO and is applied by the owner. While 752 is absent the app refuses to publish a framework that has a pending layout (409, nothing written); every other publication is unchanged.

## Order and dependencies

- **Application order: 750, then 751, then 752.**
- **Depends on:** 750 (`frameworks.layout_draft`, `layout_draft_by`, `layout_draft_at`, `component_order`, trigger `frameworks_layout_guard`), 751 (ships with 750, the F4 audit classification), 466 (`trg_cfca_framework_publication_guard`), 640 (`trg_frameworks_sod_publication_guard`, `frameworks.published_by`), 660 (`competency_assessment_component`).
- **Changes none of them.** The four guard/hash function md5s are identical before and after (table below).

## What it adds

- `framework_layout_problem(framework uuid, layout jsonb) -> text`: why a layout can no longer be applied (null = fine). Same id rules as the 750 guard, read against the framework as it is now: a domain, competency or criterion the layout names that was deleted or moved, a section no longer in the registry, a repeat.
- `framework_layout_check(framework uuid) -> text`: that, for the stored draft (null = none or fine). Execute: service_role only. The app's pre-check, and its presence is how the app detects 752.
- Trigger `frameworks_layout_apply_on_publish`: **AFTER UPDATE OF pub_status, version_major, version_minor, version_revision, FOR EACH ROW**, WHEN the row has a layout draft and the update is a publication (becomes published, or a published row takes a new version: the same test 640 uses). In the same statement:
  1. a stale layout raises `framework layout at publication: the pending layout is out of date, <reason>...`, so the whole update (status, version label, published_by) rolls back and the draft stays. Never applied in part;
  2. each named parent is renumbered densely 1..n: named ids first, then unnamed in the current stable order (sort_order, name, id), exactly as `densePlan` in `layout-order.ts`. Unchanged rows are not written;
  3. `componentOrder` (if present) becomes `frameworks.component_order` (null stays null, a list becomes the full registry with the named codes first, as `sectionOrder`);
  4. `layout_draft`, `_by`, `_at` are cleared.
- The trigger function is SECURITY DEFINER (search_path fixed) so an accepted publication is applied to every child row whatever the writer's RLS. It writes only this framework's sort_order rows and its own layout columns.

## Why the 466 and 640 guards still decide (trigger order)

- 466 and 640 (and the 750 guard) are **BEFORE ROW** triggers. 752 is **AFTER ROW**. PostgreSQL runs every BEFORE row trigger before the row is written and AFTER row triggers only for a row that was written, so name ordering does not matter: 752 runs only once both guards accepted the row. A refusal (or a BEFORE trigger skipping the row) means 752 never runs.
- Neither guard reads sort_order or component_order, so applying after them cannot change their decision.
- The clearing update sets only the layout columns and component_order: only the 750 guard fires on it (it validates component_order), never 466, 640 or 752 again.
- Proved: PRECHECK lists the kinds (`frameworks_layout_apply_on_publish(AFTER ROW)`, the three guards `BEFORE ROW`), VERIFY T1 asserts them, and R640 / R466 / A640 exercise them.

## Staging (ezhvpgtcqcdsgylrxgdb), 31 Oct 2026, by the agent with the guarded runner

- **PRE:** `cols_750=4 col_751=1 with_layout=0 with_component_order=0 fn_752=0`, triggers on frameworks = the three BEFORE ROW guards, children triggers = `framework_competencies_outcome_ids` only. md5: cfca_framework_publication_guard `0590c924...4ba0`, frameworks_sod_publication_guard `9f551b00...e83c`, frameworks_layout_guard `b81e09fb...dc40`, competency_content_hash `d00f12ea...0f5a`. Order fingerprint (every domain, competency, criterion sort_order and every component_order) `68a7dcef...e860`.
- **Run 1 and run 2:** both committed.
- **VERIFY:** 16/16 ok.
- **Plant-fail:** the same VERIFY with the 752 trigger disabled: P1, P2, S1, S2, SR, A640 go FAIL (the controls can fail).
- **Rollback rehearsal:** `ROLLBACK-752` committed. PRECHECK then equals PRE exactly (fn_752=0, same md5s, same order fingerprint).
- **Final:** re-applied. PRECHECK = PRE plus `fn_752=3` and the AFTER ROW trigger, md5s and order fingerprint unchanged (no row changed). VERIFY 16/16 ok again.

| Check | Proved |
|---|---|
| T1 | 752 is AFTER ROW, 466 and 640 are BEFORE ROW |
| K1 | `framework_layout_check` is null for a valid draft |
| N1, N2 | a rename and a move to in_review do not apply the draft |
| P1 | first publication (app statement shape) applies a partial layout (unnamed appended in order, dense 1..n), domains, competencies, criteria and section order, and clears the draft in the same statement |
| N5, N3, N4 | saving a draft, a published-to-published write with no new version, and the version_num stamp do not apply it |
| P2 | republication (new revision, pub_status in the SET) applies it, section order kept when not named |
| K2 | `framework_layout_check` names the stale reason |
| S1 | a competency moved to another domain: publication refused with the clear message, version, order and draft unchanged |
| S2 | a deleted criterion: refused, and the valid domain part is not applied either (no partial apply) |
| SR | as service_role (the app role): the check is callable and the trigger applies (definer function, execute revoked from public) |
| R640 | the reorderer publishing: 640 refuses, order, version and draft unchanged |
| R466 | unapproved CFCA republication: 466 refuses, order, version and draft unchanged |
| A640 | an independent publisher: accepted, applied and cleared |

## Production

Not applied. The owner applies it by hand after a separate GO, after 750 and 751, with the OPS-001 safeguards. Post-application: the 752 verification select at the file end (functions 3, trigger_after_row 1, with_layout 0).
