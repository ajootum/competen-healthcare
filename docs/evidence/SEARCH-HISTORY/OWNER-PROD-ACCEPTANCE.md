# My Search History: pilot acceptance (owner-run)

Owner pilot GO, 5 November 2026. No agent signs in as these learners or touches production. Do not reset an account or repeat a completed session.

## Release, in this order

992 is already applied.

1. The coordinator merges and deploys the app. The key is still OFF, so learners see no change.
2. Apply `993-individual-scholar-search-history-choice.sql` in the production SQL editor, whole file.
3. Run `consent/VERIFY-993-prod.sql`. Expect the notice `VERIFY-993-prod: PASS`.
4. Open `/legal/search-history` signed out. The supplement must show.
5. Publish `scholar_search_history` ON in HQ (Library: My search history). This offers the setting and keeps nothing by itself.

## Test, with each learner separately

**competenelisha** is A and **apollonatooli** is B. Each signs in on their own account and opts in for themselves. Do the table for A, then for B.

| # | Do | Expect | Pass |
|---|---|---|---|
| 1 | Open **My Learning → Learn** | "AI help on", and nobody asks them to agree again. Below the search box: My Search History is off, with the link **Manage My Search History** | ☐ |
| 2 | Search `off check`, then click the link | The setting says off, with the notice open. `off check` is not in the list | ☐ |
| 3 | Click **Turn on My Search History** | It says on. **The other learner's setting has not changed** | ☐ |
| 4 | **Capture:** in Learn, search `history check` and click **Search my library** | It appears at the top of My Search History, once, also after a reload | ☐ |
| 5 | **Capture:** in a lesson, ask Ask Scholar one short question (one AI call) | It appears as Ask Scholar and says "Answer not kept" | ☐ |
| 6 | **Retrieval:** in the history, search `history`. Open a Saved teaching row | Only matching entries. The saved answer opens with no AI | ☐ |
| 7 | **Cross-device:** open the history on a second device or browser, and search `second device` there | The same entries in the same order. The new search shows on the first device after a reload | ☐ |
| 8 | **Deletion:** in a row's ⋯ menu, **Remove** the `second device` search | It goes. Nothing else changes | ☐ |
| 9 | **Opt-out:** in **Settings → AI & privacy**, click **Turn off My Search History**. Search `after off check` | It says off, AI help still says on, the entries stay, and `after off check` is not added | ☐ |
| 10 | **Clear, only if the learner agrees (no undo):** click **Clear all**, then **Yes, clear my search history** | The list is empty. Their My Library, lessons and progress are as before | ☐ |

## Isolation

| # | Do | Expect | Pass |
|---|---|---|---|
| 11 | Copy the address of A's history with a material filter on, and open it signed in as B | B sees nothing of A's | ☐ |
| 12 | Compare the two lists | Neither holds the other's entries | ☐ |

## If it needs stopping

Set `scholar_search_history` OFF in HQ. The page and capture stop at once. Entries stay, and learners cannot reach them until it is on again.
