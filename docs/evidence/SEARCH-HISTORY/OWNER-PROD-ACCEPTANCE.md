# My Search History: pilot acceptance (owner-run)

Owner decision, 5 November 2026: on by default, with a one-time notice first. No agent signs in as these learners or touches production. Do not reset an account or repeat a completed session.

## Release, in this order

992 and 993 are applied, and the key is already ON.

1. **Before the deploy:** apply `994-individual-scholar-search-history-notified.sql` in the production SQL editor, whole file. The app now live is not affected by it.
2. Run `default-on/VERIFY-994-prod.sql`. Expect the notice `VERIFY-994-prod: PASS`.
3. The coordinator merges and deploys on your GO.
4. Open `/legal/search-history` signed out. It must say "on by default". `/legal/search-history/notice-v1` must still show the old text.

**From the moment it is live, every Scholar learner with no recorded choice sees the notice at their next search or question box,** and their history starts then.

## What changes for each pilot learner

| If they, under v1... | When this ships |
|---|---|
| Turned it on | Stays on. No notice, and they are not asked again |
| Turned it off | Stays off. No notice, and they are not asked again |
| Never chose | The one-time notice at their next search or question box. Their history starts once it has been seen |

AI help does not change for anyone.

## Test, with each learner separately

**competenelisha** is A and **apollonatooli** is B. Each signs in on their own account. Testing the notice needs a learner who never chose. If both already chose, rows 1 to 3 cannot be run on them: tell the coordinator, and do not reset anything.

| # | Do | Expect | Pass |
|---|---|---|---|
| 1 | Open **My Learning → Learn** | "AI help on". Below the search box: the one-time notice, with **Keep it on**, **Turn it off** and **Manage My Search History**. Nothing is blocked | ☐ |
| 2 | Search `first check` and click **Search my library** | It appears in My Search History, once | ☐ |
| 3 | Open **Learn** again, then open **My Search History** | The notice does not come back: Learn has one short line. The setting says on, because they saw the notice | ☐ |
| 4 | Click **Keep it on** | The setting says on, by their choice | ☐ |
| 5 | **Capture:** in a lesson, ask Ask Scholar one short question (one AI call) | It appears as Ask Scholar and says "Answer not kept" | ☐ |
| 6 | **Retrieval:** in the history, search `check`. Open a Saved teaching row | Only matching entries. The saved answer opens with no AI | ☐ |
| 7 | **Cross-device:** open the history on a second device or browser, and search `second device` there | The same entries in the same order. The new search shows on the first device after a reload | ☐ |
| 8 | **Deletion:** in a row's ⋯ menu, **Remove** the `second device` search | It goes. Nothing else changes | ☐ |
| 9 | **Opt-out:** in **Settings → AI & privacy**, click **Turn off My Search History**. Search `after off check` | It says off, AI help still says on, the entries stay, and `after off check` is not added | ☐ |
| 10 | Sign out, sign back in, and open **Learn** | Still off. No notice | ☐ |
| 11 | **Clear, only if the learner agrees (no undo):** click **Clear all**, then **Yes, clear my search history** | The list is empty. Their My Library, lessons and progress are as before | ☐ |

## Isolation

| # | Do | Expect | Pass |
|---|---|---|---|
| 12 | Copy the address of A's history with a material filter on, and open it signed in as B | B sees nothing of A's | ☐ |
| 13 | Compare the two lists | Neither holds the other's entries | ☐ |

## If it needs stopping

Set `scholar_search_history` OFF in HQ. The page and capture stop at once. Entries stay, and learners cannot reach them until it is on again.

Rollback of 994: `default-on/ROLLBACK-994.sql` refuses once any learner has seen the notice or turned it off without a grant. Roll the app back first, or a learner with no choice sees "could not start" and nothing is kept.
