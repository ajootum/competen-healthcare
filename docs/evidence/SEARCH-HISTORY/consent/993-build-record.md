# Build record: migration 993 and branch `scholar/search-history-consent` (My Search History, the owner's privacy decision)

**Authority:** owner decision "COMPETEN SCHOLAR: SEARCH HISTORY PRIVACY DECISION", 5 November 2026, conditional approval. **v4 and the key are not to go ahead yet.** The wording and this delta are for the owner's approval.

**State of 993 (CLAUDE.md four states):** 2, applied and verified on staging (`ezhvpgtcqcdsgylrxgdb`) twice, rollback rehearsed. **Not applied to production.** When merged, `main` holds 993 while production does not. The code that needs it stays behind the key, which is OFF, and fails closed: without 993 a grant is refused by the CHECK, so the choice stays off.

**Number:** 993, from the range the coordinator gave this work (992-994). No 993 or 994 on `origin/main` or any remote branch before claiming.

| File | sha256 | Order |
|---|---|---|
| `supabase/migrations/993-individual-scholar-search-history-choice.sql` | `3d69484bf0aa003bfc5f8e7ddee2cdddafd0e327a56590560b06071c58a0bc28` | After 372, 700, 992. Before the application uses the new feature code |
| `992-individual-scholar-search-history.sql` | `9905e719e3c3873d770aa8a3268daef7a2a4f0aa703f4f2fd088b372a5c539b0` | Unchanged, and applied in production by the owner |
| `consent/VERIFY-993-prod.sql` | `432d150ef83a767c28eb7a6cc4b46794c7db895d49172db3fd570809531fe21c` | Owner, after 993. Structure only |
| `consent/ROLLBACK-993.sql` | `f6709cdeacbeeabceaefd3c21c98ecf30b131eea490c9874b77cdd7a91d18c85` | Refuses once a learner has made the choice |
| `consent/PRECHECK-993-prod.sql` | `b1b60f5b218b3a63e8deec07c01f7296dfdb5bd877ed6a2e4a1c770c23f24c64` | Owner, before and after 993. Counts only |

**OPS-001 tier: proposed Medium** (constraints and relationships on existing objects). Rollback rehearsed on staging, compatibility shown by the harnesses below. Production holds no captured rows while the key is OFF, which the precheck confirms.

## What 993 does

1. **Widens the consent CHECK** with `scholar_search_history`. The table was already per person and per feature (372, 700). `readConsent` defaults to the AI feature, and the one other reader (`knowledge/governance.ts`) filters on it, so nothing else reads the new row.
2. **Makes two history foreign keys `ON DELETE CASCADE`:** `material_id` and `session_id`. `artefact_id` stays `SET NULL`: no search or question is stored with one, and a mark holds no words.

A lesson is deleted only by `pruneEmptySessions` (once no step is left) or by erasing everything, so "a lesson goes" already means "it relied only on what was deleted". That is the rule in Privacy Notice draft `04` §4.2. **No other table changes,** so what deleting a material does to questions, attempts and evidence is as before.

## The application delta

| Owner item | What changed |
|---|---|
| 1. Independent setting, default off | `SearchHistorySetting` on My Search History and in Settings (AI and privacy). `readSearchHistoryChoice` is the one reader. No row, revoked, an earlier version, unpublished documents or an unreadable row all mean off |
| 1. Off keeps nothing | The capture route checks the choice **before it reads the body**. The page sends no key and no question while off (`SearchHistoryChoiceProvider`, read once in the experience layout) |
| 1. Off does not affect AI | AI gates do not read this row. Walks below |
| 2. No interruption for v3 | `CONSENT_NOTICE_VERSION` stays v3. New feature, new notice version `scholar-search-history-notice-v1`. The consent route grants it only where HQ offers it |
| 2. Notice at every capture point | `HistoryNotice`, with its link, at Learn search, library search, Ask panel, Ask Scholar in a lesson and Ask about your notes (all three `ExplainPanel` places) |
| 3. Minimisation | Unchanged from 992, and proven again: submitted words only, no answer column |
| 4. Deletion | Remove and Clear work with it off. Material deletion by 993. Choice row kept after Clear, as AI's is |
| 5. Wording | No "private to you", "never shown" or "cannot see" on learner surfaces. A unit test pins this. HQ's description of the key changed too. Not a Personal AI source: the source scan still allows the table name only in `search-history.ts`, `store.ts`, its test and `plane-boundary-scan.ts` |
| 6. Documents | `docs/legal/drafts/13`, `14`, `15`, all marked subject to legal review |

**Behaviour the owner should know:**
- **With it off, the page still lists saved teaching and lessons,** because those are records Scholar already holds, read at request time. Pin and remove still work on them.
- **While HQ's key is off, a learner cannot reach the page to delete entries.** The key is the emergency stop, so that is unchanged, but it matters once real entries exist.
- **Ask Scholar in the library list:** the existing defect stays (the panel closes without asking there). Not in this change.

## Proof

**Migration, on staging** (`consent/staging-993.log`):
- VERIFY-993 before 993: **red** ("the consent CHECK does not name scholar_search_history").
- Applied, applied again: both committed.
- VERIFY-993-prod: pass. ROLLBACK-993: committed, and VERIFY-993-prod then **red**. Applied again.
- VERIFY-993 went red twice on a mistake in its own probe (a NOT NULL column the probe left out), which was fixed. Then **committed**: separate choice, AI consent unchanged, unknown feature refused, material and lesson deletion remove linked entries, the unlinked entry and other learners unchanged, nothing kept.

**Walks on this code, staging, two fixture learners:**
- `consent/walk-consent-064129.log`: **81/81.** With it off nothing is kept and nothing is sent. A direct POST answers `{kept:false, reason:"off"}`. The Ask panel, Learn Ask and Understand all answered, with 3 AI rows. v3 learner: "AI help on", never asked, AI row byte-identical throughout. The notice and link at all five capture points in both states. On: each kept once. Off from Settings: nothing removed, nothing new. Delete and clear with it off. Material deletion. No overflow at 1440, 820, 390.
- `consent/walk-off-lesson-071453.log`: **9/9.** A new lesson started and taught with it off, 1 AI row, the typed topic not kept. The lesson was removed afterwards.
- `walk/walk-065537.log`: **75/75**, the #289 walk with the setting on. `walk/walk-key-off-071101.log`: **6/6**.

**Gates:** tsc clean. eslint on touched files clean. `ci-harnesses` 68/68, including plane-boundary and scholar-learning. House rules all clear on 993. vitest on `src/lib/individual` and `src/lib/access`: 3,109 of 3,110. The one failure was `invitations.test.ts`, a whole-tree source scan that timed out with the walks running beside it. Alone it passes 16/16. **CI not read yet.**

**What the walks found along the way:**
- The material page's `/analyse` request answers 503 `not_eligible` on fixture A, with the setting on or off. It is excluded from the walk's error check by name and not touched here.
- One earlier run recorded React console errors on `/study/learn`. They did not recur in a targeted probe (off and on, reload, back, the notice link) or in the two clean runs. Treated as dev-server noise.
- Fixture A gained attempts during one run, from another session using that shared fixture. Clean runs show the walk writes none.

## Owner pilot GO, 5 Nov 2026: the supplement

The published Individual Privacy Notice did not disclose this collection, and a new version would close Scholar until each person accepted again. The owner's minimum correction is a dated supplement at `/legal/search-history`, whose body is Notice v1 from `config.ts`. It is linked from `/legal`, from the Privacy Notice pages' navigation (the notice's text is untouched) and from the setting. No version, env value, `acceptanceState` or consent changes. The open questions in `15` are settled for the pilot by that GO: the build stays as it is, and `14` and `15` stay unpublished.

## Not proven

- **Production:** nothing was run there.
- **Account closure:** the notice relies on the owner-run procedure (LEGAL-001 §13 step 9), which the walks do not exercise.
- **Real research rows and "Continue the lesson":** the same limits as #289.

**Staging left:** the key ON as before, 993 applied, no history choices and no walk rows on the fixtures. Fixture A has a few more AI rows and learning events from the real questions.
