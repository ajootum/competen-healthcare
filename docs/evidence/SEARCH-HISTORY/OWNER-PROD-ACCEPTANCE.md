# My Search History: production acceptance (owner-run)

Run only after the owner's GO. No agent signs in as these learners or touches production. Do not reset an account or repeat a completed session.

## Before

1. Apply `992-individual-scholar-search-history.sql` in the production SQL editor, whole file.
2. Run `VERIFY-992-prod.sql`. Expect the notice `VERIFY-992-prod: PASS`.
3. Deploy the app. Publish `scholar_search_history` ON in HQ (Library: My search history).
4. Run `PROD-COUNTS-992.sql` and keep the result: this is the "before".

Each learner signs in on their own account, or you check with them present. Use **competenelisha** as learner A and **apollonatooli** as learner B.

## Checks, for each learner

Open **My Learning → Learn**. Below the search box, click **My search history**.

| # | Do | Expect | Pass |
|---|---|---|---|
| 1 | Read the list | Their saved teaching and lessons, newest first. Earlier searches and Ask questions are **not** there: they were never kept | ☐ |
| 2 | On a Saved teaching row, click **Open the saved answer** | The saved answer as it was, with no "writing" or waiting for AI | ☐ |
| 3 | Back. On a Lesson row, click **Open its saved lessons** | The lesson's saved teaching in the library, no AI | ☐ |
| 4 | In Learn, search `history check` and click **Search my library**, then reload the results | The search is at the top of the history, **once** | ☐ |
| 5 | In My Library, search `history check two` | It appears as Searched your library | ☐ |
| 6 | In a lesson with saved teaching, ask Ask Scholar one short question (uses one AI call) | It appears as Asked Scholar, tells them the answer was not kept, and offers Continue the lesson | ☐ |
| 7 | In the history, search `history` | Only matching entries, words marked | ☐ |
| 8 | Filter by Activity, then Material, then a date range of today | Each narrows the list correctly. Topic lists appear where a lesson or question has a topic | ☐ |
| 9 | **Pin** the search from step 4, then **Unpin** it | It shows under Pinned, then leaves | ☐ |
| 10 | **Remove** the search from step 5 | It goes. Nothing else changes | ☐ |
| 11 | Open the history on a second device or browser | The same entries in the same order. A search made there appears on the first after a reload | ☐ |

## One learner cannot see the other

| # | Do | Expect | Pass |
|---|---|---|---|
| 12 | Signed in as A, copy the address of A's history with a material filter on. Open it signed in as B | B sees nothing of A's | ☐ |
| 13 | Compare the two lists | No entry from one is in the other, and B's list does not hold A's `history check` search | ☐ |

## Clear

**Clear has no undo in the page.** It removes the learner's whole history view, but none of their learning. It was proven on staging, so on production use it only if the learner agrees.

| # | Do | Expect | Pass |
|---|---|---|---|
| 14 | Click **Clear search history…**, then **Cancel** | Nothing changes | ☐ |
| 15 | Only with the learner's agreement: click it again, then **Yes, clear my search history** | The list is empty. Their My Library, lessons and progress are as before | ☐ |

## After

| # | Do | Expect | Pass |
|---|---|---|---|
| 16 | Run `PROD-COUNTS-992.sql` again and compare | `artefacts`, `sessions`, `attempts`, `materials`, `cards`, `notes` unchanged. `events` and `ai_rows` rise only by what steps 2-6 did: step 6 asked one question, and opening a saved answer or saved lessons adds neither | ☐ |
| 17 | In HQ, look for the learner's searches | They appear nowhere in HQ | ☐ |

## Roll back

- **Quickest:** set `scholar_search_history` OFF in HQ. The page and capture stop at once, and nothing else changes.
- **Full:** `ROLLBACK-992.sql` refuses while any entry exists. Those are learner records, so removing them is your decision by hand.
