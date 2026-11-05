# Competen Scholar: My Search History notice, v1 (`scholar-search-history-notice-v1`)

> **SUBJECT TO LEGAL REVIEW. NOT LEGALLY APPROVED. Owner pilot GO, 5 November 2026.** The text below is reproduced **word for word** from `src/lib/individual/scholar/config.ts` (`SEARCH_HISTORY_NOTICE`, `SEARCH_HISTORY_NOTICE_VERSION`), and from `search-history.ts` for the short notices. Its body is also published as the supplement at `/legal/search-history`.
>
> **No word may change without a new version.** A grant counts only for the current version of this notice.

| | |
|---|---|
| Version | `scholar-search-history-notice-v1` |
| Feature | `scholar_search_history` (migration 993, a per-person choice, recorded apart from AI help) |
| Authority | Owner decision "COMPETEN SCHOLAR: SEARCH HISTORY PRIVACY DECISION", 5 November 2026, items 1, 2, 3, 4 and 5 |
| Issued by | the Scholar operating entity [OWNER SLOT: registered name] |
| Counsel sign-off | **[COUNSEL SLOT]** |

## The notice, as shown in the setting

The setting is on My Search History and in Settings (AI and privacy). While it is off, the whole notice is open.

**What My Search History keeps, and your choice**

If you turn this on, the searches you submit and the questions you put to Ask Scholar are kept in My Search History, with the date and where you asked. Anything you type but do not submit is not kept.

Answers are not kept here. A saved answer or lesson stays in My learning library, and your history links to it.

Entries stay until you remove them, clear your history, delete a material they rely on, or your account is closed. Deleted entries can remain in encrypted backups until those backups are replaced on their rolling schedule. Backups are restored only for recovery.

Your history is not ordinarily visible to other learners, educators or employers. Authorised Competen staff and service providers may have access where needed to operate, secure or support the service, or where the law requires it. Personal AI does not use it.

Please do not type identifiable patient information into a search or question.

This is separate from AI help. With it off, AI help, lessons and searching work the same, and new searches and questions are not kept. Turning it off does not remove what is already kept. You can remove entries or clear your history at any time.

You can review the applicable Privacy Notice and Terms of Use before continuing.

**The control:** "Turn on My Search History" / "Turn off My Search History".

**Shown instead, until the Terms and Privacy Notice are published:** "My Search History can be turned on once our Privacy Notice and Terms of Use are published."

## The short notice, beside every box whose words can be kept

Shown at Learn search, library search, the Ask panel, Ask Scholar in a lesson, and Ask about your notes. Each carries the link "Manage My Search History", which goes to the setting. Nothing is shown where HQ does not offer the feature.

- **On:** "My Search History is on: what you submit here is kept there until you remove it. Please do not type patient details."
- **Off:** "My Search History is off: what you submit here is not kept there."

## At the foot of My Search History

"Not ordinarily visible to other learners, educators or employers. Authorised staff and service providers may have access where needed to operate, secure or support the service, or where the law requires it. Personal AI does not use it. Answers are not kept. Removing an entry or clearing your history does not touch your notes, lessons, saved teaching or materials. Clearing cannot be undone."

## How the product records it

- **Its own record.** One row per person in `individual_scholar_consent`, feature `scholar_search_history`: status, notice version, when granted, when turned off. No row means off.
- **It is apart from AI help.** AI help reads only its own row (`ai_processing_uploads`). A learner who agreed to AI notice v3 is not asked again.
- **Each change writes one audit row** naming the feature and notice version, never a search or a question.
- **Fails closed.** No row, turned off, an earlier version, unpublished documents or an unreadable row all mean that nothing new is kept. The capture route checks this before it reads the words.

## For counsel

1. **Lawful basis.** Is this consent, or performance of the service with the choice as a safeguard? The amendment (15) follows the answer. **Opt-out with notice (v2, `16`) versus opt-in (v1) changes this question.**
2. **"Not ordinarily visible".** No HQ surface reads this table, and the plane boundary refuses any landlord-plane read of it. Database administration and encrypted backups exist. Is the wording on authorised access right, and should it name who?
3. **Retention.** The notice states the existing rules and invents no period. See 15, "What exists today".
4. **Patient details.** Words that look like patient identifiers are screened and not kept, but screening cannot catch everything. Should the notice say so?
