# HQ-SOD-CROSSCUT-01 — migration 640 build record

Owner GO, 28 Oct 2026: configurable cross-cutting HQ roles with mandatory item-level separation of duties. It
revises the frozen PLAT-GOV rule "exactly one active appointment decides authorization" (owner decision; CLAUDE.md
updated to say so).

| State | Status |
|---|---|
| 1. Authored | Done. Local rehearsal below. |
| 2. Applied and verified on staging ×2 | **PASS 28 Oct** (coordinator, staging ezhvpgtcqcdsgylrxgdb): FINGERPRINT 0→2|6|17|11|7 ×2, VERIFY 13/13, rollback 0 + 15 pairs, re-applied. See 640-staging-record.md. |
| 3. Merged into main | Not yet. |
| 4. Applied to production | **Not applied.** The owner applies it by hand. |

**sha256 of the file to stage:** `7ec13907a9f26d7cf152870f196a13654cbe868dcc5624ad65b754f4955d72ad` (LF, ASCII, 888 lines).

| Companion file | sha256 (first 8) |
|---|---|
| ROLLBACK-640.sql | 0e46fcee |
| VERIFY-640.sql | e31ab328 |
| FINGERPRINT-640.sql | bf86b604 |
| LOCAL-ONLY-PROBES-640.sql (never on staging) | — |

**Application order and dependencies.** After 630. Needs 076, 116/117, 264, 395, 422, 440, 442, 460, 461, 465, 466,
500, 511, 580 and 610 (all in production). Additive or widening, idempotent, appoints nobody, ends no grant.

## What was verified before lifting each pair

| Pair (580) | Item-level safeguard found | Lifted |
|---|---|---|
| clinical.approve + competency/case/course author, ckri.educator | 395/422/442/461 decision guard refuses the version's authors and submitter. **Gap found:** a resubmission naming somebody else, or a version that omits an editor, was not covered. 640 adds `clinical_review_decision_sod_guard` over every version of the subject and (competencies) the audit trail, as `authorsOf` reads it. | Yes |
| clinical.approve + clinical.govern | **Gap found:** nothing stopped a governor scoping their own reviewer appointment, reopening an ended scope, or lowering approval counts. 640 adds `clinical_reviewer_scope_sod_guard`, `wce_clinical_count_guard` (lowering needs the owner) and `clinical_content_version_sod_floor`. | Yes |
| case.author + case.publish | **Verified absent in 422:** `case_library_publish` checked only approval, never the publisher. 640 adds `hq_sod_publication_guard` on case, knowledge and learning versions. | Yes, after the fix |
| course.author + course.publish | 460 CHECK and 461 function refuse an author. 640 adds the same trigger. | Yes |
| ckri.educator + knowledge.publish | **Verified absent in 442** (capability check only). 640 trigger covers authors, submitter and the reviewing educator. | Yes, after the fix |
| competency.author + competency.publish | 580 checked publisher independence in the service only. 640 moves it into the database (`frameworks.published_by` + `frameworks_sod_publication_guard`). | Yes |
| competency assessor ×4, research ×2 | No equal or stronger item check. | **Never liftable** (CHECK constraint) |

## Local rehearsal (postgres:17, stub plus the real 076, 116, 117, 264, 281, 287, 395, 422, 440, 441, 442, 460, 461, 465, 466, 500, 511, 580, 610, 620)

- FINGERPRINT: PRE `0|0|0|0|0` → apply #1 `2|6|17|11|7` → apply #2 same → ROLLBACK `0|0|0|0|0` (exclusions back to 580's 15, immutable) → re-apply `2|6|17|11|7`.
- VERIFY-640: 13/13 true after apply #2 and after re-apply.
- ROLLBACK refuses once scholar_clinical_lead has been appointed (by design: fix forward).
- **Probes (`LOCAL-ONLY-PROBES-640.sql`): 54 pass, 0 fail**, 8 of them red-proofs (the 640 control disabled inside a rolled-back subtransaction, and the same violation is then accepted):
  - cross-cutting: three people appointed Scholar Clinical Lead; a second appointment allowed (multiple appointments on)
  - indirect escalation: a second appointment combining assessor with approval refused (red-proof); a grant completing a pair across a holder's appointments refused; non-owner grant and settings refused; a non-liftable pair cannot be allowed by the owner or by a direct table write
  - settings: strict separation, blocking a held pair, and switching multiple appointments off are refused while somebody would be in breach
  - reviewer scope: self-scope refused (red-proof), a granter without governance refused, no granter refused, reopening an ended scope refused, cross-granting allowed
  - independent approval: self-approval refused; an editor in the audit trail omitted from the version refused (red-proof); a v1 submitter approving a resubmitted v2 refused (red-proof); stale version refused; one decision per reviewer
  - counts: a governor raises, cannot lower (red-proof), cannot delete; out of range refused; a submission asking for fewer is raised to the governed count; the owner may lower
  - publication: self-publication of a case refused (red-proof, the 422 gap); the publisher-not-approver content rule refuses the approver; an independent publisher publishes; a framework needs a recorded, independent publisher (curator refused, red-proof; submitter refused); a stale publisher is cleared
  - 610: `hq_capability_exclusions()` returns the 6 blocked pairs, which the seat guard reads unchanged
- Not exercised by a probe: knowledge and learning publication (same trigger function as cases, proven there).

## App code (same PR)

Positions screen: no-code separation panel (pairs, strict, multiple appointments, per-content-type rule), owner-only
actions `set_pair`, `set_settings`, `set_content_rule`. Resolver: `effectiveAuthority` (union within the product line
when multiple appointments are on; reads fail closed to one appointment). Clinical review: reviewer appointments are
any position holding `hq.quality.clinical.approve`; the governance route refuses self-scope and non-owner lowering.
`publishScope`/`rollbackVersion` record `published_by` and no longer ignore a refused write. Framework publication
records `published_by`. Every 640 read and write falls back to today's behaviour while 640 is absent.
