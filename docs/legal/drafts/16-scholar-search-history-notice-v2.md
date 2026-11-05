# Competen Scholar: My Search History notice, v2 (`scholar-search-history-notice-v2`)

> **SUBJECT TO LEGAL REVIEW. NOT LEGALLY APPROVED.** The text below is reproduced **word for word** from `src/lib/individual/scholar/config.ts` (`SEARCH_HISTORY_NOTICE`) and `search-history.ts` (the short notices). It replaces v1 (`13`) for new learners. **It is not live until the owner's GO.**
>
> **No word may change without a new version.**

| | |
|---|---|
| Version | `scholar-search-history-notice-v2` |
| Authority | Owner decision, 5 November 2026: My Search History on by default, with a one-time notice first. Everything else in the privacy decision and the pilot GO stands |
| Published as | The supplement at `/legal/search-history`. v1 stays at `/legal/search-history/notice-v1` |
| Counsel sign-off | **[COUNSEL SLOT]** |

## The one-time notice

Shown in place, once, the first time a learner with no recorded choice reaches a search or question box. It blocks nothing.

"My Search History is on. From now on, the searches and questions you submit are kept there until you remove them. Answers are not kept. It is not ordinarily visible to other learners, educators or employers. Please do not type patient details."

**Controls:** "Keep it on", "Turn it off", and the link "Manage My Search History".

**If it could not be recorded:** "My Search History could not start just now, so nothing is being kept."

## The notice in the setting

**What My Search History keeps, and your choice**

My Search History is on by default. Once you have seen this notice, the searches you submit and the questions you put to Ask Scholar are kept in My Search History, with the date and where you asked. Anything you type but do not submit is not kept.

Answers are not kept here. A saved answer or lesson stays in My learning library, and your history links to it.

Entries stay until you remove them, clear your history, delete a material they rely on, or your account is closed. Deleted entries can remain in encrypted backups until those backups are replaced on their rolling schedule. Backups are restored only for recovery.

Your history is not ordinarily visible to other learners, educators or employers. Authorised Competen staff and service providers may have access where needed to operate, secure or support the service, or where the law requires it. Personal AI does not use it.

Please do not type identifiable patient information into a search or question.

This is separate from AI help. You can turn it off at any time. With it off, AI help, lessons and searching work the same, and new searches and questions are not kept. Turning it off does not remove what is already kept. You can remove entries or clear your history at any time.

You can review the applicable Privacy Notice and Terms of Use before continuing.

**What changed from v1:** the first sentence ("If you turn this on, the searches you submit...") and the added "You can turn it off at any time." Everything else is word for word v1.

## The setting's status line, by state

| State | Heading | Line |
|---|---|---|
| No choice yet | My Search History has not started | It is on by default, and it starts once you have seen its notice beside a search or question box. Nothing is being kept yet. |
| Saw the notice | My Search History is on | New searches and questions are kept, because you saw this notice on [date]. You can keep it on or turn it off. |
| Chose to keep it on | My Search History is on | New searches and questions are kept (you chose this on [date]). |
| Turned it off | My Search History is off | New searches and questions are not kept (turned off [date]). AI help, lessons and searching work the same. |

The short notices beside each box and the foot of the page are unchanged from v1 (`13`).

## How the product records it

| What happened | `status` | `granted_at` | Audit action |
|---|---|---|---|
| The notice was on screen | `notified` | empty | `individual_scholar_consent_notice_shown` |
| Keep it on, or Turn on | `granted` | set | `individual_scholar_consent_granted` |
| Turn it off | `revoked` | kept if they ever granted, else empty | `individual_scholar_consent_revoked` |

**Seeing the notice is never recorded as a grant,** and the database refuses a `notified` row with a grant time (migration 994). It only fills a gap, so it can never overwrite a choice. **Nothing is kept until it has been recorded.** If recording fails or cannot be read, nothing is kept.

**A choice under v1 stands:** on stays on and off stays off, and neither is asked again. AI notice v3 is not touched.

## For counsel

The questions in `13` stand, with this one added:

1. **Opt-out with notice versus opt-in changes the lawful-basis question already open in `13`.** v1 asked the learner to turn it on. v2 is on once the notice has been seen, so consent may no longer be an available basis for those learners. Which basis applies, and does it hold for free-text searches and questions?
