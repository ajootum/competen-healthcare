# Build record: migration 994 and branch `scholar/search-history-default-on` (My Search History on by default, after a one-time notice)

**Authority:** owner, 5 November 2026: "I would like it to be turned on by default", then "Yes, build it" to the one-time notice design. **A build go-ahead only, not a merge or deploy GO.** It reverses default OFF. Everything else in the privacy decision and the pilot GO stands.

**State of 994 (CLAUDE.md four states):** 2, applied and verified on staging (`ezhvpgtcqcdsgylrxgdb`) twice, rollback rehearsed. **Not applied to production.**

**Number:** 994, the last of the range given to this work. No 994 on `origin/main` or any remote branch.

| File | sha256 | Order |
|---|---|---|
| `supabase/migrations/994-individual-scholar-search-history-notified.sql` | `fb35d923de2dad1d53dc4d4dfc52c694047bbad86870f1a5cfd605b6c1334449` | After 372, 700, 993. **Before the deploy.** The app now live is not affected by it |
| `default-on/VERIFY-994-prod.sql` | `1ca170290cccf73c36c3e59f7593128d2f01a80ea11d4092dfd97f28af0b1a60` | Owner, after 994 |
| `default-on/ROLLBACK-994.sql` | `c6aea7052879d20e69173905ac8923e51e9a264941e192513c4a6ab920848c91` | Refuses once a notified or never-granted row exists |

**OPS-001 tier: proposed Medium** (constraints on an existing table). Rollback rehearsed on staging.

## Why a migration

There is no sound way without one. `individual_scholar_consent` allowed only `granted` and `revoked`, and `granted_at` was NOT NULL, so neither "saw the notice" nor "turned it off, never having granted it" could be stored without writing a false grant time. A second table would split one choice across two records.

994 adds status `notified`, lets `granted_at` be empty, and adds a CHECK that keeps the column's meaning: a grant always has a time, a notified row never has one, and only this feature can have neither. AI consent cannot be notified and cannot lose its grant time.

## The state table (`historyChoiceState`)

| Recorded | State | Kept? | Notice due? |
|---|---|---|---|
| Nothing | `unseen` | **No** | Yes |
| `notified`, current notice | `on_by_notice` | Yes | No |
| `notified`, an earlier notice | `unseen` | No | Yes |
| `granted`, v1 or v2 | `on_chosen` | Yes | No |
| `revoked`, any version | `off` | No | Never again |
| Unreadable, or documents unpublished | off | No | No |

## The delta

- **`FirstNotice`:** in place at every capture point, through the existing `HistoryNotice`. It records only once at least half of it has been on screen, then the page starts keeping. If recording fails it says so and nothing is kept. Keep it on and Turn it off are real choices.
- **The route:** `{ feature, seen: true }` records and audits `notice_shown`. The insert only fills a gap, so it cannot overwrite a choice, and it answers with the learner's state.
- **Turn it off** now writes a row even with none there, with no grant time.
- **The setting and the page foot** say the right thing in each state. Opening the setting does not count as seeing the notice.
- **Supplement:** v2 at `/legal/search-history` and `/legal/search-history/notice-v2`, v1 word for word at `/legal/search-history/notice-v1`.
- **HQ's description of the key** is updated.
- **Touch targets (coordinator's addition):** the history search button, the row title link, "Back to My learning library" and the setting's document links now meet `--cmp-touch-min` on a coarse pointer. The row menu already did.

## Proof

**Migration on staging** (`default-on/staging-994.log`): red before, applied twice, verify committed, VERIFY-994-prod pass, rollback committed and the prod verify then red, re-applied, verify committed. VERIFY-994 proves a notified row refuses a grant time, a grant refuses to have none, off without a grant is allowed, and the AI row cannot be notified or lose its time and is unchanged.

**Walk:** `default-on/walk-default-on-*.log`, **73/73**. Recording blocked: a search runs and is not kept. Direct POST before the notice: `kept:false`. No choice, notice, recorded with no click, audit says notice shown and not granted, then kept once. Later visits: short notice. Keep it on: a real grant, audited. Turn it off from the notice: no grant time, off across visits, not kept, and a late `seen` cannot overwrite it. Turn it off from the setting with no row. A v1 opt-in stays on and a v1 opt-out stays off, rows unchanged. The notice and link at all five capture points. AI answers with the notice on screen. AI rows byte-identical. Both supplements signed out. A real coarse pointer at 820 and 390: every target at least 44 px. Staging left with no choices and no walk rows.

**Gates:** tsc and eslint clean. Unit tests pass, including the state table. `scholar-learning-harness` and house rules clear. **The full walks were not repeated, and CI has not run.**

**What the walk runs needed fixing, all in the walk:** a box below the fold is not "seen" until scrolled to, which is the intended behaviour. Requests from a previous page could recreate a row just cleared, so it now leaves the page first.

## Not proven

- **Production.**
- **The pilot learners' real state:** whether they chose under v1 is on production, which I cannot read.
- **A notified row after a later notice v3** is unit-tested, not walked.

**The supplement's date is 5 November 2026.** If it ships on another day, change `date` in `search-history-supplement.ts` before merging.
