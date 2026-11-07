# Release readiness, 7 Nov 2026 (step 9, Coordinated Learning Experience Completion)

**Live app:** `6264ec8f`, deployed 7 Nov 06:21 EAT. **Rollback:** `03929239`. **This table is docs only.** Facts come from the coordinator (7 Nov), `git` history on `main` and the journey report. Production switches are as the owner read them on 6 Nov, not re-read today. Times are EAT.

## Readiness table

| # | Item | PR / ref | What is true now | Category |
|---|---|---|---|---|
| 1 | Go Deeper (structured, with notes) | #324 | Merged, live, switch off | **Completed** |
| 2 | Guide Me | #330 | Merged, live, switch off | **Completed** |
| 3 | My Notebook (code) | #332 | Merged, live, switch off. Needs migrations 1000 and 1001 before it can be switched on (row 12) | **Completed** (code) |
| 4 | Notes inside teaching | #339 | Merged, live, switch off | **Completed** |
| 5 | Research-grounded teaching, phase 1 | #331 | Merged, live. `scholar_teach_research` has no production row, so it is off | **Completed** |
| 6 | Local time zones | #334 | Merged, live, switch off. Never run signed in on a real session | **Completed** (not proven signed in) |
| 7 | Whole-slide rendering, pieces A to D | #333, #336, #337, #338 | Merged, live. `scholar_whole_slides` (slides, and PDF pages per #336's PR text) and `scholar_word_pictures` (Word) are off, no production row. #338 (charts) adds no code beyond piece A. See rows 10 and 11 | **Completed** (code), reliability open |
| 8 | Challenge me / Ask me fix | #335 | Live since 7 Nov 00:59 EAT | **Completed** |
| 9 | Integrated Growth and Development journey (step 8), `main` 74672f45 | journey report | No blockers. 16 of 18 lines pass (two fail, same cause, row 10) | **Completed**, one should-fix |
| 10 | **Should-fix:** a restored reading place is lost when saved teaching arrives after it (notes panel folds again; a control below the teaching is pushed about 7,800 px away) | journey 5d, 5e | Seen in every run that watched it. Notes, position and lesson are intact. Dev-server timing; not measured on production. Fix in progress | **Failed** |
| 11 | **Whole slides on a Vercel preview:** 2 of 8 runs killed, one took 217 s. Normal runs about 35 s at 2,030 to 2,064 MB of 2,279 MB. Function 97 to 101 MB | slide pieces | Stall cause not found. Keep off. Owner GO: keep 2 GB and build the watchdog and limits (in progress) | **Failed** (reliability) |
| 12 | **Vercel automatic branch builds** fail out of memory (build machine dropped to 8 GB) | Vercel | CI is unaffected. Production deploys need `--turbo` | **Failed** (tooling, not code) |
| 13 | Migrations 1000, 1001 (My Notebook) and 1010 (whole slides) | `supabase/migrations/` | **Not applied in production.** The owner applies by hand; each needs its own GO | **Blocked** |
| 14 | Research privacy alignment | none | In progress, no PR | **Blocked** |
| 15 | Ten-scenario clinical review | pack of 10, unreviewed | No clinician named. `scholar_revision_formats` excludes scenario, so #318 (variety) and #327 (not merged) do not reach learners | **Blocked** |
| 16 | 60 pilot questions | #270 (merged), SQIE tracker | Approval and publication outstanding (reviewer Okaisu Mullen, publisher Elisha Okaisu) | **Blocked** |
| 17 | GOV-01 acceptance | GOV-01 | Applied by the owner, effective 6 Nov 23:22 EAT. Still to show: a holder opens a named view and the audit row appears | **Blocked** |
| 18 | Not run in the journey: a real phone (pilot), Ask's panel at 390 wide, sign-out with the whole connection lost | journey notes | Not tested | **Blocked** |
| 19 | AI-03 cost comparison | LEARNING-CLOSE AI-03 | 7-day check due 7 Nov 20:30 EAT | **Blocked** (waits for the date) |
| 20 | Activate each new switch (rows 1 to 8) | each PR | Each needs a separate owner GO. Whole slides: keep off | **Requires owner decision** |
| 21 | Apply 1000, 1001, 1010 | row 13 | Owner GO and apply | **Requires owner decision** |
| 22 | MeSH use in research | row 14 | Open owner question | **Requires owner decision** |
| 23 | Name a clinician for the ten-scenario pack | row 15 | Owner | **Requires owner decision** |
| 24 | Approve and publish the 60 pilot questions | row 16 | Owner | **Requires owner decision** |
| 25 | Monitor duplicate results and the unexplained connection error | owner items | Owner | **Requires owner decision** |
| 26 | Preview-domain CNAME (OPS-01); AI metering revisit on or after 20 Nov; payments revisit 18 Nov | trackers | Owner | **Requires owner decision** |

## What is on in production (owner read, 6 Nov)

- **Keys on:** `active_notebook`, `application_evidence`, `competency_evidence_views`, `global_search`, `next_best_action`, `prerequisite_suggestions`, `retrieval_schedule`, `search_history`, `transfer_checks`. `ckri_research` is true.
- **No row (off):** `ai_fair_use`, `hq_record_search`, `scholar_teach_research`.
- **Research & Explain** is live and the owner keeps it on.
- **Scenario** is not in `scholar_revision_formats`.

## Where the detail lives

LEARNING-CLOSE tracker (Learning Engine, CE, AI, governance rows) · SALE tracker (R0 to R5, gates, outstanding approvals) · SQIE-CLOSE tracker (SQIE workstreams, pilot library) · CE register (narrative per workstream).
