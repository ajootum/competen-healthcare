# Individual Privacy Notice: amendment for My Search History (draft)

> **SUBJECT TO LEGAL REVIEW. NOT LEGALLY APPROVED AND NOT PUBLISHED.** Bracketed slots are counsel decisions or owner facts. No period is invented here.
>
> **Written for v1 (opt-in). Not updated for v2 (on by default after a notice, `16`), and not published.** The live disclosure is the supplement at `/legal/search-history`.
>
> **Authority:** owner decision 5 November 2026, items 4, 5 and 6. **Applies to:** the Competen Individual Privacy Notice published at `/legal` (`draft-2026-10-23`, in `src/lib/legal/interim-drafts.json`) and the Scholar Privacy Notice counsel draft (`04`). Section numbers below are `04`'s. In the published notice the same text goes in §4 Information collected, §8 Artificial intelligence, §10 Private learning, §16 Retention and §17 Deletion and withdrawal.

## The text to add

### §1, What Scholar processes: two new rows

| Activity | Information | Purpose | Proposed lawful basis [COUNSEL] |
|---|---|---|---|
| **My Search History** (only if you turn it on) | The searches you submit and the questions you put to Ask Scholar, the date, the kind of activity, links to where you asked (material, section, lesson and step), an optional topic and the number of results, and your pins and removals. Not what you type but do not submit. Not the answers. | To let you find and return to your earlier searches and questions | **Your choice**, given separately and revocable [COUNSEL: consent, or performance of the service with the choice as a safeguard] |
| **Your My Search History choice** | The notice version you agreed to, when, and when you turned it off | To honour your choice | Legal obligation and accountability |

### §2, AI processing: add 2.6

2.6 **My Search History is not AI memory.** Personal AI does not use it. A question you ask is still processed as §2.2 describes, whether or not My Search History is on.

### §3, Who sees your study: add 3.5

3.5 **My Search History** is not ordinarily visible to other learners, educators or employers. Authorised Competen staff and service providers may have access where needed to operate, secure or support the service, or where the law requires it (§3.3).

### §4, How long we keep it: add 4.6 to 4.9

4.6 **My Search History is off until you turn it on.** Turning it off stops new entries. It does not remove what is already kept, and it does not affect AI help, lessons or searching.

4.7 **Entries are kept until you remove them, clear your history, or your account is closed**, as §4.1 says for your other study, subject to [COUNSEL: retention criteria].

4.8 **Deleting a material also removes the entries that relied on it:** those linked to that material, and those asked in a lesson that relied only on it. A search with no link to a material stays until you remove it. [OWNER: see open question 1.] Removing an entry or clearing your history deletes no material, lesson, saved teaching, answer or other learning record.

4.9 **Backups.** A deleted entry can remain in encrypted backups until they are replaced on their rolling schedule [OWNER: the retention period, per OPS-001]. Backups are restored only for recovery.

## What exists today (read 5 November 2026, nothing invented)

| Rule | Where it is | State |
|---|---|---|
| Study records stay until you delete them or your account is closed | `04` §4.1. `02` §8 for Professional | Exists. Retention criteria are a counsel slot |
| Approved retention schedule | Published Individual notice §16 ("[REQUIRED: insert approved retention schedule or meaningful category-specific criteria, including backups.]"), `02` §8, LEGAL-001 §11 Q9 | **Does not exist.** Counsel and owner to approve |
| Deleting a material | `04` §4.2, `03` §4.5: the file, its passages, and the questions, sets and sessions "that relied only on it" | Exists. **Does not mention history.** The rule in 4.8 applies its "relied only on it" test, and that is a reading for the owner and counsel to confirm |
| Backup schedule | OPS-001 §6: **7 daily + 4 weekly**, encrypted, on the owner's PC and copied to a BitLocker SSD when connected. The task now runs every 4 hours and keeps the newest per day | Exists as an operating rule. So a deleted entry can stay in a backup for about 4 to 5 weeks. **The period has never been written into a notice** (published §16 and `02` §8 both still have a slot). OPS-001 §6 still says "daily at 20:30" |
| Deletions after a restore | | **No rule exists.** Nothing says that entries deleted after a backup are deleted again if that backup is restored |
| Account closure and erasure | LEGAL-001 §13 step 9: **no self-service erasure.** Interim, owner-run: delete the subject's `individual_scholar_*` rows, which include this table. The auth user is not deleted for an Individual-only exit. Terms `01` §13.3: "You may ask to close your account" | Exists as a manual procedure. **A learner cannot delete their account themselves,** so the notice says "your account is closed", not "delete your account" |
| Agreement and audit records | `04` §4.4, `02` §8 | Kept as accountability evidence, period a counsel slot. The choice record stays after Clear and after erasing material, as the AI record does |

## Publishing this has a side effect

**Changing a production Privacy Notice version closes the experience until each person accepts it again** (LEGAL-001 §6, `acceptanceState` in `legal.ts`). A new Holdings version closes both experiences. AI consent and saved learning are not touched, but learners are stopped until they accept. There is no "non-material update" path (LEGAL-001 R5 is open). See open question 2.

## Open questions

1. **What "associated" means for entries with no link to the material.** A library or Learn search with no material filter has no link, even if its words name the material. Today it stays. The same applies to "Erase all my study material": linked entries go, unlinked searches stay. Should erasing everything also clear the history?
2. **How the amendment reaches learners**, given the side effect above.
3. **Which notice carries it.** The published Individual notice is what learners accepted, and the counsel drafts (`02`, `04`) are not published.
4. **The backup period** to state, and whether deletions need re-applying after a restore.
