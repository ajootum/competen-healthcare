# Migration 900: NUR-CCF Professional Practice as twelve domains (build record)

**Authority:** owner GO 3 Nov 2026, shape A ("Professional accountability and responsibility has 6 criteria under it... if that is what A presents go ahead"): the Professional Practice Area of the shared framework NUR-CCF holds twelve domains, one per PP competency, each with that one competency and its existing criteria, so the framework shows 25 domains (13 Clinical Practice, 12 Professional Practice).
**Branch:** `cfca/pp-domains-01`. **State (CLAUDE.md):** 2, applied and verified on STAGING 3 Nov 2026, left APPLIED. **Not applied to production.** Production needs its own owner GO with the OPS-001 safeguards (backup + restore test, ROLLBACK text here, VERIFY after).

## What it does (data only)
For the shared framework coded `NUR-CCF`: finds the domain named *Professional Practice* that holds the competencies coded `PP-%`; for each (in sort order) creates a domain in the *Professional Practice* Area named after the competency with the competency's code (`PP-01` to `PP-12`), moves the competency into it (sort_order 1), then deletes the emptied source domain (kept with a notice if anything else still references it), and writes one `audit_log` row (`cfca_domains_restructured`). Creates the Area only if it is missing. Idempotent: a second run finds nothing to move. On an environment without NUR-CCF or without the PP competencies it reports and changes nothing.

Why nothing else needs to change: `competency_content_hash` reads the competency's own fields and its criteria, not the domain, so the twelve clinical review versions queued on production (submitted 3 Nov, 0 approvals) stay current (VERIFY V8). No competency, criterion, mapping, catalogue entry or review row is created or removed.

## sha256
```
67b13e9edcd1cc3a2d7fffcab31b9fd256a7a4117240f1ffc195cb3b63e6efd2  900-nur-ccf-professional-practice-domains.sql
```
Helpers: `VERIFY-900.sql` (9 checks, raises its RESULT line), `ROLLBACK-900.sql` (moves the twelve back into one domain, drops the twelve, refuses if a PP domain holds anything else).

## Staging records (ezhvpgtcqcdsgylrxgdb, 3 Nov 2026)
Staging's NUR-CCF (e8e1a08d-b3b2-487e-a6d7-4fd743a62989) had no Professional Practice content, so the production shape was planted first through the authoring API as the staging owner (Area, domain, 12 competencies PP-01..PP-12 with the production codes, names, descriptions and risk, 69 criteria with their components and source refs, read from production read-only). Two assessment components absent on staging were registered (`demonstrated_professional_practice`, `application_judgement`, as on production).
```
APPLY-1                 Done, Committed.   VERIFY-1: RESULT VERIFY 900 pass=9 fail=0 failed:  (criteria=69)
APPLY-2 (no-op)         Done, Committed.   VERIFY-2: RESULT VERIFY 900 pass=9 fail=0 failed:  (criteria=69)
ROLLBACK-900            Done, Committed.   VERIFY: pass=5 fail=4 failed: V3:domains_in_area=1 V4:pp_codes=0 V5:one_matching_competency=0 V7:old_domain_still_holds=1  (as expected after a rollback)
APPLY-3 (re-apply)      Done, Committed.   VERIFY-3: RESULT VERIFY 900 pass=9 fail=0 failed:  (criteria=69)   (staging left APPLIED)
House rules             ALL CLEAR (the two expected APPLY-WHOLE warnings)
Browser (authoring explorer, staging owner): see the PR text
```
(The word FAILED on VERIFY lines is the runner reporting the deliberate final raise. The RESULT text is the verdict.)

## Production
Pre-state read-only 3 Nov 2026: framework f520fc79-5aa0-44c6-9195-9f361dc09dd8, Area 454ac3b0-0867-4d03-9c31-54de6eb05229, source domain 1b572dc8-4a4b-4f9e-8a4d-ae2b75ab0599 (sort 14, no code) holding PP-01..PP-12 (69 active criteria: knowledge / demonstrated_professional_practice / application_judgement), 14 domains in all, 12 PP review versions queued with current hashes. Expected after: 25 domains, the Area with 12, VERIFY pass=9 (criteria=69).
Package: RELEASE-2026-10-25/PENDING-40.
