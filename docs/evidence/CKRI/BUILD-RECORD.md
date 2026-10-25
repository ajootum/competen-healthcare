# CKRI foundation — build record (COMPETEN-KNOWLEDGE-RESEARCH-01, migrations 440–443)

**Staging: APPLIED and verified 2026-10-25 (STAGING-RECORD-2026-10-25.md). Production: NOT applied. No production GO exists.** All code is behind the `ckri_research` platform flag (OFF unless
written; unreadable is OFF) and fails closed while any of 440–443 is absent. Participation grants also need a
configured participation notice (`CKRI_PARTICIPATION_NOTICE_VERSION` + `_URL`), which no environment has yet.

## Application order and dependencies

| # | File | Depends on | Risk (OPS-001 s8) |
|---|---|---|---|
| 440 | `440-ckri-research-governance.sql` | 264, 117, profiles | Medium (new trigger functions) |
| 441 | `441-ckri-aggregate-intelligence.sql` | 440, 372, 388, 402, 414, 416, 422, 423, 435, `practice_platform_flags` | Medium |
| 442 | `442-ckri-educator-knowledge.sql` | 395, 422, 440, 441 | Medium (**replaces the two shared 395/422 review guards**; competency and case branches unchanged, harness K3-1) |
| 443 | `443-ckri-research-workspace.sql` | 440, 441 | Medium |

Rollback order is the reverse: 443 → 442 → 441 → 440. ROLLBACK-440 refuses while participation rows exist;
ROLLBACK-442 refuses while any `clinical_content_version` of kind `resource` exists.

## Checksums (sha256 of the LF file, as committed)

```
b0ef6d999a51ac011ea15345b9443cfa3d224c79de4aedd693342635695f7493  440-ckri-research-governance.sql
da8822e9da7280f15414021ac60b84dfd8e5bf224aa0523d0ae4e5aed282eabf  441-ckri-aggregate-intelligence.sql
c4b10b2b130af619a93cb90f39f4097b4d9082d5804810ee62b2a17e73910199  442-ckri-educator-knowledge.sql
4ce71f74a37af0056242fc3032bceecd38409b49aabbc140102942c70a56a524  443-ckri-research-workspace.sql
c68b8f1d5fc7680b0f1ddf65bd117ba2158a8e82f7b35e3e248d076a1a0a61ab  ROLLBACK-440.sql
c0b6f291f31220701aefd041bac7a806a9ab4c68aa89750c501aec16d285350d  ROLLBACK-441.sql
ff8f988e60a395ed5f288f2b12a20ecd2d298ca27a97971165557314607e80f1  ROLLBACK-442.sql
a671bc971b5df22a6ef76402d3cd83db14007ab01008a1eff21ea43c16439d08  ROLLBACK-443.sql
```

## Local evidence (disposable Postgres 17 holding a schema-only copy of staging, read 2026-10-25)

- House rules: all four migrations and four rollbacks ALL CLEAR.
- Each migration applied twice: identical column fingerprint (`09c9afd0…` for the CKRI tables plus `clinical_content_version`).
- Behaviour tests `scripts/ckri-db/test-44x.sql`: 440 31/31, 441 19/19, 442 25/25, 443 24/24 (99 assertions).
- Each test shown to fail by planting its violation (440: 4 plants, 441: 3, 442: 4, 443: 4), then restored green.
- Full rollback 443→440 left 0 CKRI objects, no `knowledge_version_id`, no CKRI capabilities. 422 guard bodies after
  ROLLBACK-442 equal the 422 file (CR-normalised md5). Reapply: same fingerprint, 99/99 again.
- Static harness `scripts/ckri-harness.ts`: 20/20, each with a planted red. Vitest `src/lib/knowledge`: 12/12.
- Existing harnesses re-run: hq-guard 51/0, plane-boundary 35/0, clinical-review 25/0; vitest cases/competency/hq/knowledge 142/142.

## Staging (coordinator)

1. Before the first apply: confirm 440–443 and every `ckri_*` name are absent; record `VERIFY-442.sql`'s guard md5s.
2. Apply 440, 441, 442, 443 in order. Run `VERIFY-44x.sql`. Apply all four again; VERIFY again (fingerprints identical).
3. Rollback rehearsal: ROLLBACK-443, -442, -441, -440. Confirm the 442 guard md5s equal step 1. Reapply 440–443, VERIFY.
4. Optional behaviour check on staging is NOT recommended (the tests write fixture rows inside a rolled-back
   transaction, but they create auth.users rows; keep them local).
