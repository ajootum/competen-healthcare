# FRAMEWORK-DESIGN-STUDIO-02: migration 761, the clinical fingerprint over active criteria, build record (31 Oct 2026)

- **Instruction:** owner ruling D3 (31 Oct 2026): retiring a criterion is SUBSTANTIVE (an assessment requirement change), so it must change the fingerprint and send the competency back to clinical review.
- **Branch:** `hq/framework-studio-02a`.
- **Migration:** `supabase/migrations/761-content-hash-active-criteria.sql`, sha256 `bd5d96bc0e4fac5b8d2f8a261eb282d0d143026d6667857d1ad466a2993e6e06`.
- **Rollback (staging only):** `docs/evidence/FRAMEWORK-DESIGN-STUDIO-02/761-ROLLBACK.sql`, sha256 `3a184f40739b49cd8327b830dc4a8eaebf2fe9540b798b69c85c3a0c32e2143d`.
- **House rules:** ALL CLEAR (206 lines, 67 statements). The only warnings are the APPLY WHOLE constructs and three apostrophes inside comments copied verbatim from the 690 guard body.

## State
- **State 2: applied and verified on staging. Production: NOT applied.** It needs a separate owner GO, and the owner applies it.
- **Dependencies:** 395 (both hash functions), 670 (current single-hash body), 690 (current `clinical_content_version_guard` body). No later migration (691-760) redefines any of the three.
- **Application order:** any time after 690 (and so after 670). Independent of 760.
- **Before 761 (production today):** the server refuses retire and restore with 409 on a competency that has a clinical content version (fail closed). Nothing else depends on 761.

## What 761 changes (no table, column, row or grant)
1. `competency_content_hash(uuid)`: the 670 body, with the criteria aggregation filtered to active rows.
2. `competency_content_hashes(uuid[])`: the 395 body, unchanged (it calls the single function).
3. `clinical_content_version_guard()`: the 690 body, with the competency snapshot's criteria filtered to active rows. Without this, a version made after a retirement would store a hash that leaves the criterion out beside a snapshot that still lists it. The review queue shows `snapshot.skills` to the reviewer, so they would see a retired criterion as part of what they approve. That would break 395's rule that a version describes exactly the content its hash names. Every other branch (method, learning, resource, case) and every refusal is byte-identical.
4. `competency_content_hash_covers_retirement()`: a new marker that returns true. The server probes it.

`competency_skills.is_active` is `not null default true` (007), so `is_active is not false` means active. Production, checked read-only: 675 criteria, 0 inactive. No existing hash changes.

### Body diff (only these two lines change; the marker function is new)
```
670 competency_content_hash, line 72 (761 line 69):
-                          from competency_skills s where s.competency_id = c.id), '[]'::jsonb)
+                          from competency_skills s where s.competency_id = c.id and s.is_active is not false), '[]'::jsonb)

690 clinical_content_version_guard, line 266 (761 line 179):
-      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id), '[]'::jsonb))
+      'skills', coalesce((select jsonb_agg(s.name order by s.name, s.id) from competency_skills s where s.competency_id = c.id and s.is_active is not false), '[]'::jsonb))
```

## Callers (semantics unchanged)
Every caller compares the current hash with a hash stored when a record was made:
- the `clinical_content_version` guard and the decision guards (395, 422, 442, 461, 690);
- publication requiring clinical approval (466);
- verification requests and decisions (510, 680);
- app reads: `clinical-review.ts`, `clinical-review-hq.ts`, `review-batch.ts`, `framework-layout.ts`, `framework-lifecycle.ts`, `cases/studio.ts`.

Where no criterion is retired, stored and current values are identical before and after 761. A retirement now reads to each of these callers as a content change, which is what D3 requires. Nothing in the app recomputes the hash.

**Noted, not changed (outside 761):** `competency_method_criteria_problem` (690) checks that a method's pinned `criterionId` still exists and matches its text and section, but not that it is active. A method could therefore keep pinning a retired criterion. The competency itself does go back to clinical review. This one is for the owner or S5.

## Staging (ezhvpgtcqcdsgylrxgdb), runner judged non-production by `judgeDbTarget`
- **PRECHECK:** 349 competencies, 458 criteria, 0 inactive. md5 over every competency's hash: `54c6164751afc411486418850e8ab66e`.
  - Live bodies matched the repo forms: hash = 670, batch = 395, guard = 690. No marker.
  - Callers: 8 competency versions (8 current), 2 verification requests (0 current, already stale before 761), 1 decision (0 current).
- **Probe before 761:** retiring a criterion left the hash unchanged, and the snapshot still listed the retired criterion (39 skills). This is the defect.
- **Applied twice:** identical verification output both times. Live bodies = 761. Marker present.
- **VERIFY after the apply:**
  - (a) 349/349 hashes identical to PRE. 0 differ, 0 unexpected. Aggregate md5 identical.
  - (b) Probe, inside a transaction that was rolled back:
    - retiring one criterion changed the hash;
    - the batch function agreed;
    - a version inserted while it was retired stored the new hash, and its snapshot left the criterion out (38 skills);
    - restoring it returned the hash to the original.
    - After the rollback: hash back to the original, criterion active.
  - (c) The batch agreed with the single function for 349/349.
  - (d) Caller counts identical to PRE: versions 8/8 current, requests 2/0, decisions 1/0.
- **ROLLBACK rehearsed:** bodies back to 670/395/690, marker dropped, 349/349 hashes identical, and the probe behaved as before 761. Then **re-applied**: 349/349 identical, probe green as above. Staging is left with 761 applied.

## Code
`src/lib/competency/criteria-authoring.ts`:
- **Draft frameworks only, as before.** Retire and restore keep `draftCompetency`.
- **Reviewed competencies probe 761.** For a competency with any clinical content version, the server calls RPC `competency_content_hash_covers_retirement`:
  - true: allowed;
  - missing function (PGRST202/42883): 409 refusal, unchanged (fail closed);
  - any other error: 503, nothing written.
- **Never reviewed: no probe.**
- **The audit row** stays before the write, now with `substantive: true, clinical_review: <put forward>`.

## Tests
- **vitest** `criteria-authoring.test.ts`: 15/15. New cases:
  - with 761, a reviewed competency retires and restores, substantive, audit row before the write;
  - without 761, both stay refused with 409 and nothing is written;
  - an unreadable probe returns 503;
  - a never-reviewed competency is not probed;
  - a published framework is refused before the probe.
- **Planted control:** a "missing function = covered" plant turned the fail-closed test red, and restoring the code turned it green.
- **Other checks:** tsc clean, eslint clean on the touched files.
