# My Search History: production acceptance (owner-run)

Run only after the owner's GO. No agent signs in as these learners or touches production. Do not reset an account or repeat a completed session.

## Before

992 is already applied. **Order matters: the notice and the learner's choice must work before anything can be kept** (owner decision 5 Nov 2026, item 7).

1. Run `consent/PRECHECK-993-prod.sql` and keep the result.
2. Apply `993-individual-scholar-search-history-choice.sql` in the production SQL editor, whole file.
3. Run `consent/VERIFY-993-prod.sql`. Expect the notice `VERIFY-993-prod: PASS`. Run the precheck again: `ai_consents` must not have changed.
4. Deploy the app. Nothing changes for learners: the key is still OFF.
5. After the approved wording and the owner's own GO, publish `scholar_search_history` ON in HQ (Library: My search history). This offers the setting. It keeps nothing by itself.
6. Run `PROD-COUNTS-992.sql` and keep the result: this is the "before".

Each learner signs in on their own account, or you check with them present. Use **competenelisha** as learner A and **apollonatooli** as learner B.

## Checks, for each learner

Open **My Learning → Learn**.

### The choice comes first

| # | Do | Expect | Pass |
|---|---|---|---|
| a | Look at the header, then below the search box | "AI help on", and nobody asks them to agree again. A line says My Search History is off, with the link **Manage My Search History** | ☐ |
| b | Search `off check` and click **Search my library**, then ask Ask Scholar one short question in a lesson (uses one AI call) | Both work as usual | ☐ |
| c | Click **Manage My Search History** | The setting says off, with the whole notice open. `off check` and the question are **not** in the list | ☐ |
| d | Click **Turn on My Search History** | It says on, with today's date | ☐ |

### With it on

Open **My Learning → Learn**. Below the search box, click **My search history**.

| # | Do | Expect | Pass |
|---|---|---|---|
| 1 | Read the list | Their saved teaching and lessons, newest first. Earlier searches and Ask questions are **not** there: they were never kept | ☐ |
| 2 | Click a Saved teaching row (the title or the chevron) | The saved answer as it was, with no "writing" or waiting for AI | ☐ |
| 3 | Back. Click a Previous lesson row | The lesson's saved teaching in the library, no AI | ☐ |
| 4 | In Learn, search `history check` and click **Search my library**, then reload the results | The search is at the top of the history, **once** | ☐ |
| 5 | In My Library, search `history check two` | It appears as Library search | ☐ |
| 6 | In a lesson with saved teaching, ask Ask Scholar one short question (uses one AI call) | It appears as Ask Scholar, says "Answer not kept", and its ⋯ menu offers Continue the lesson | ☐ |
| 7 | In the history, search `history` | Only matching entries, words marked | ☐ |
| 8 | Click the chips Searches, Ask Scholar, Lessons, Research, then All. Then open **Filters** and try a material and a date range of today | Each narrows the list correctly. Topics are listed where a lesson or question has one | ☐ |
| 9 | In the row's ⋯ menu, **Pin** the search from step 4, then **Unpin** it | It shows under Pinned, then leaves | ☐ |
| 10 | In the row's ⋯ menu, **Remove** the search from step 5 | It goes. Nothing else changes | ☐ |
| 11 | Open the history on a second device or browser | The same entries in the same order. A search made there appears on the first after a reload | ☐ |

## Turning it off, and deleting a material

| # | Do | Expect | Pass |
|---|---|---|---|
| e | In **Settings → AI & privacy**, click **Turn off My Search History** | It says off. AI help still says on. The entries stay in the list | ☐ |
| f | Search `after off check` in Learn | It works, and it is not added to the list | ☐ |
| g | Only with the learner's agreement, on a material they do not need: note an Ask Scholar entry asked about it, then delete the material | That entry goes. A search with no link to the material stays | ☐ |

Turn it back on before the next section if the learner wants it on.

## One learner cannot see the other

| # | Do | Expect | Pass |
|---|---|---|---|
| 12 | Signed in as A, copy the address of A's history with a material filter on. Open it signed in as B | B sees nothing of A's | ☐ |
| 13 | Compare the two lists | No entry from one is in the other, and B's list does not hold A's `history check` search | ☐ |

## Clear

**Clear has no undo in the page.** It removes the learner's whole history view, but none of their learning. It was proven on staging, so on production use it only if the learner agrees.

| # | Do | Expect | Pass |
|---|---|---|---|
| 14 | Click **Clear all**, then **Cancel** | Nothing changes | ☐ |
| 15 | Only with the learner's agreement: click it again, then **Yes, clear my search history** | The list is empty. Their My Library, lessons and progress are as before | ☐ |

## After

| # | Do | Expect | Pass |
|---|---|---|---|
| 16 | Run `PROD-COUNTS-992.sql` again and compare | `artefacts`, `sessions`, `attempts`, `materials`, `cards`, `notes` unchanged, apart from what step g deleted with the material. `events` and `ai_rows` rise only by what steps 2-6 did: step 6 asked one question, and opening a saved answer or saved lessons adds neither | ☐ |
| 17 | In HQ, look for the learner's searches | They appear nowhere in HQ | ☐ |
| 18 | Run `consent/PRECHECK-993-prod.sql` again | `ai_consents` and `ai_consents_v3_granted` are unchanged | ☐ |

## Roll back

- **Quickest:** set `scholar_search_history` OFF in HQ. The page and capture stop at once, and nothing else changes. Learners also cannot reach their entries to delete them while it is off.
- **993:** `consent/ROLLBACK-993.sql` refuses once any learner has made this choice.
- **Full:** `ROLLBACK-992.sql` refuses while any entry exists. Those are learner records, so removing them is your decision by hand.
