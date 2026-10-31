# Migration 770: build record (revision drafts for published competency frameworks)

- **Authority:** owner GO FRAMEWORK-DESIGN-STUDIO-02, 31 Oct 2026, ruling D2 (`STATUS.md`). Implementation only. No earlier migration edited.
- **Branch:** `hq/framework-studio-02a` (on af1ff602).
- **File:** `supabase/migrations/770-framework-revision-drafts.sql`, sha256 `ae0b8190c51fba8994d52e5fa05de31efca6e932122d835bf4d11f373383e90a`.
- **Rollback (staging):** `ROLLBACK-770.sql`, sha256 `a6ef419cc0f262ae83e4d57077e3216afb41dd8743143c46f6dd55fefee688a9`. It restores the four replaced bodies verbatim from 761, 640, 690 and 760 (extracted from those files) and the 690 subject check, and drops everything 770 added. It refuses while any revision or revision version exists.
- **PRECHECK / VERIFY:** `PRECHECK-770.sql` (sha256 `36ee1210...887e`, read only), `VERIFY-770.sql` (sha256 `2c1a99b5...f178a`, always rolls back).
- **House rules:** ALL CLEAR (1114 lines, 407 statements). Warnings: the APPLY WHOLE constructs and three apostrophes in comments copied verbatim from the 690/761 guard body.

## State

**State 2: applied and verified on staging. Production does NOT have it.** Separate owner GO, applied by the owner. Without 770 the server refuses every content change to a published governed framework (409, nothing written). It never writes live.

## Order and dependencies

- **Application order: 750, 751, 752, 760, 761, then 770.** The file opens with a check and refuses (nothing changed) without 761 (marker), 760 (`framework_areas`), 752 (layout apply trigger) and 690 (`method_version_id`).
- **Depends on:** 395, 466 (unchanged), 640 (publication guard unchanged, `clinical_content_version_sod_floor` body), 641 (unchanged), 690 (`clinical_review_decision_guard` body, subject check), 751 (outcome-id trigger, unchanged), 752/760 (layout apply, unchanged, runs after), 761 (`competency_content_hash` unchanged, `clinical_content_version_guard` body).
- A later migration that replaces any of the four bodies below must start from THIS file.

## Design

| Piece | What |
|---|---|
| `framework_revision` | One open per framework (unique index on a generated `open_framework_id`, no partial index). Opened only on a shared, CFCA, published framework. `open` -> `discarded`, or `open` -> `applying` -> `published` only inside the publication statement (trigger depth). Never deleted (cascade only). |
| `framework_revision_competency` | Full proposed copy of the hashed fields plus code. `competency_id` is the stable id: live id (= `origin_competency_id`) or pre-allocated for a new one (checked unused, live and in any revision). A new one names a live domain of the framework and a place. `base_hash` computed by the trigger. |
| `framework_revision_criterion` | The whole proposed criteria set of each revision competency. `skill_id` stable (= `origin_skill_id`, or pre-allocated). Composite FK to its revision competency. A live criterion enters only with its own competency, so both ends of a move are in the revision. A published criterion is never removed (retire). |
| `framework_revision_add_competency` | Copies a live competency and every criterion (active and retired) in one statement. |
| `framework_revision_competency_hash` | `competency_content_hash` (761) over the revision rows: same keys, types, active-only criteria, order by name then id. |
| `clinical_content_version` | `+ revision_id`, `+ proposed_competency_id` (a NEW competency, competency_id null until published). Subject check widened for that case only. Unique (proposed_competency_id, content_hash). |
| version guard (761 body + 2 branches) | A revision version: hash and snapshot computed from the revision, bound to the stable id, only while open. The one non-insert: binding a new competency's versions to its id inside the apply (depth > 1, revision applying, competency exists, no other column changed). |
| decision guard (690 body) | Current = live hash or the open revision's proposed hash (`competency_review_current`). A new competency is scoped by its proposed domain (`clinical_scope_covers_domain`). |
| SoD guard (760 body) | Subject and audit trail by the stable id, framework from the revision for a new one. |
| floor (640 body) | A revision version uses the PROPOSED risk (and proposed CPU risk). |
| `frameworks_revision_apply_on_publish` | BEFORE, sorts before `trg_cfca_*` (466) and `trg_frameworks_sod_*` (640), so both unchanged guards judge the applied content. Problem check, then updates by id, inserts with pre-allocated ids, retire = is_active false, never delete, binds versions, asserts every revision competency hashes as proposed, and re-runs the 466 predicate itself (466 fires only on `update OF pub_status`). |
| `frameworks_revision_release_on_publish` + deferred `framework_revision_settled` | AFTER (row written) marks published with the version; a revision left applying (a later BEFORE trigger skipped the row) cannot commit. |

**New competencies, decided:** final uuids pre-allocated in the revision, invisible to live reads, reviewed as versions naming `proposed_competency_id`, inserted at apply with that id, versions bound in the same statement, so 466, 640 and the publication snapshot (`approvalRefs`) see them as any competency.

## Guarantees kept

| From | Guarantee | How it holds |
|---|---|---|
| 395 | approval is bound to exact content, computed by the database | proposed hash/snapshot computed by the trigger from the revision rows (V1). Hash identical to live for an unchanged copy, 13 published + fixture (H1) |
| 395/640 | reviewers independent of authors and editors | authored_by plus the audit trail by stable id, new competencies included (V2) |
| 395 | stale content refused | a decision on an outdated proposal refused (V4) |
| 466 | published only when every competency is approved at current content | guard unchanged, runs after the apply (P1), plus the same predicate inside the apply |
| 640 | publisher independent | guard unchanged, sees new competencies once applied (P2) |
| 751 | stable outcome ids, history self-contained | apply updates `learning_outcomes`, the 751 trigger carries ids by text (P3), evidence and request ids unchanged (K1) |
| 752/760 | layout applied whole in the statement | unchanged AFTER triggers, over applied content. A stale combination refuses the whole statement |
| 761 | active criteria only | proposed hash uses the same filter (E1) |

## Staging (ezhvpgtcqcdsgylrxgdb), 31 Oct 2026, by the agent with the guarded runner (`judgeDbTarget`)

- **PRE:** live bodies equal the repo forms (md5 of prosrc: version guard `090779aa`, floor `64275694`, decision guard `0c59b2a6`, SoD guard `033b5efc`). 22 frameworks, 349 competencies, 458 criteria, 0 retired, 13 versions, 5 decisions, 4 framework versions. `hash_fp 9ee1991c...0b3` (as in 760), `content_fp bc13a83f`, `criteria_fp 30d5cc92`, `versions_fp ec92e454`, `evidence_fp 8a1e8350`, `requests_fp 32d01b5c`.
- **Attempts:** the first apply was of an earlier draft. VERIFY then showed 466 fires only on `update OF pub_status`, so the apply gained its own 466 predicate check. The final file was applied (run 1), VERIFY 17/17, then applied again (run 2, idempotent).
- **Post-apply PRECHECK:** only the four replaced bodies, the new functions, triggers, constraint md5, the two columns and the three tables differ. Every data fingerprint identical (no row changed).
- **VERIFY 17/17 ok:** O1 one open, published CFCA only; H1 copy hash and snapshot equal (13 published + 2); E1/E1b retire changes and restore returns the proposed hash; I1 revision invisible (live rows, live approvals, new ids absent, signed-in read sees none); G1 schema refusals (live id reused, foreign domain, orphan criterion, published row deleted, id rewritten, applying by hand, FK); V1 proposed versions computed and bound; V2 revision author and revision editor cannot approve (existing and new); V3 new competency scoped by its domain; V4 stale proposal refused; P1 refused publication applies nothing; P2 publisher independence covers revision authors and new competencies; P3 applied atomically as the app role (hashes = approved proposals, ids stable, retire not delete, new ids, binding, outcome ids, released 1.0.1); K1 evidence/requests/framework_versions untouched, closed revision and versions immutable; D1 discard leaves live untouched; S1 a live change after the copy refuses publication; T1 never committed applying.
- **Plant-fail:** apply trigger disabled -> P1, P2, P3, K1, S1, T1 RED. Competency guard disabled -> the copy fails the check constraint (base_hash only from the trigger), RED.
- **Rollback rehearsal:** ROLLBACK-770 committed. PRECHECK then equals PRE exactly (every line).
- **Final:** re-applied, VERIFY 17/17 again, PRECHECK equals the post-apply state. Staging is left with 770 applied.

## Body diffs (only these lines change)

```
761 clinical_content_version_guard
+  v_rc framework_revision_competency%rowtype;                (declare)
+  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 ... binding of a new competency version ... return new;   (before the append-only refusal)
+  if new.revision_id is not null then ... hash and snapshot from the revision ... return new; end if;
+  if new.proposed_competency_id is not null then raise ... end if;   (before the shared-framework select)

640 clinical_content_version_sod_floor
+  if new.content_kind = 'competency' and new.revision_id is not null then  (proposed risk)
-  if new.content_kind = 'competency' then
+  elsif new.content_kind = 'competency' then

690 clinical_review_decision_guard, competency branch
-    if not clinical_scope_covers(new.appointment_id, v_version.competency_id) then
+    if v_version.competency_id is null then (scope by framework_revision_competency.domain_id) ... elsif not clinical_scope_covers(...) then
-    if competency_content_hash(v_version.competency_id) is distinct from v_version.content_hash then
+    if not public.competency_review_current(coalesce(v_version.competency_id, v_version.proposed_competency_id), v_version.content_hash) then

760 clinical_review_decision_sod_guard
-       and ((v.content_kind = 'competency' and o.competency_id = v.competency_id)
+       and ((v.content_kind = 'competency' and coalesce(o.competency_id, o.proposed_competency_id) = coalesce(v.competency_id, v.proposed_competency_id))
+    if v_parent is null and v.revision_id is not null then select r.framework_id into v_parent ... end if;
-       where a.actor_id = new.reviewer_id and a.entity_id in (v.competency_id, v_parent)
+       where a.actor_id = new.reviewer_id and a.entity_id in (coalesce(v.competency_id, v.proposed_competency_id), v_parent)
```

## Code (server, S5)

- `src/lib/competency/framework-revision.ts` (new): `routeToRevision` (the seven content actions on a published governed framework), `discardRevision`, `loadRevision`, `revisionReviews`, `loadRevisionForReview`, `submitRevisionVersion`, `loadRevisionDiff` (pure `overlayRevision` + `diffFramework`), `revisionForPublication`.
- Route: revision first, then the existing paths. `authoring.ts` update/create refuse a published governed framework (REVISION_ONLY) if ever reached. `criteria-authoring.ts`: retiring a criterion a published method pins is refused ("Remove it from the method first"), drafts too.
- Publication: open revision read, refused when changed after it was put forward or no longer applicable, its new competencies count for publisher independence, never "layout only". Lifecycle maps the 770 refusals to words.
- Review queue: lists proposed versions (current against the open revision), new competencies placed by their proposed domain, criteria from the revision.

## Tests

vitest `framework-revision.test.ts` 12 (routing, fail closed, authorship first, live untouched, pinned retire, diff overlay) plus criteria-authoring, review-batch, authoring, framework-publication, clinical-review-hq: 76/76. Plant: fail-closed removed -> RED, restored -> green. `competency-foundation-harness` ALL GREEN 33/33 (learner reads unchanged). tsc and eslint clean.

## Not done / open

- UI (S6). Not browser-walked.
- A published framework's own name/description, domains, practices and CPUs still save live (outside D2's list, unchanged). Owner may extend.
- `move_competency_domain` of a NEW revision competency is not offered (404). Its domain is set when it is proposed.
- A same-section criteria reorder of a competency in the revision is saved in the revision (F4, `reorder_layout`). A pending layout naming that competency's criteria still has the final say for the ones it names.
