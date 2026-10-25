# Competen Individual: AI allowance and fair-use statement (for students and professionals)

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED AND NOT PUBLISHED.** This statement describes the pilot as configured on 25 October 2026. If the configuration changes, the statement changes with it.

| | |
|---|---|
| Reference | COMPETEN-IND-LEGAL-AI-FAIR-USE-001, counsel-draft-1, 25 October 2026 |
| Issued by | Competen Holdings, for the shared Personal AI. The Scholar operating entity, for Scholar. [OWNER SLOT: registered names] |
| Counsel sign-off | **[COUNSEL SLOT]** |

## The statement (user-facing text)

**AI help in Competen Individual: what's included**

**AI help is included in the pilot at no charge.** You are never charged for using AI in Competen Individual during the pilot, and no payment details are asked for.

**There is a fair-use limit.** To keep AI help reliable and fair for everyone, each person can make a set number of AI requests per hour. At present that is **up to 30 per hour**, and it may be set lower.

**When you reach the limit, AI help pauses until it resets.** Nothing else is affected.
- Your notes, saved questions, cases, CPD records and progress all stay available.
- Every feature that doesn't need AI keeps working.
- You'll see a message saying you've reached the hourly limit and to try again later.

**Some requests are refused for safety, not because of the limit.**
- A request that contains patient-identifiable details is refused before anything is sent.
- AI output that can't be checked against your own notes is withheld.

**If this changes, we'll tell you first.** If Competen later introduces a monthly AI allowance, or paid plans, we'll tell you what's included, and how any limit or charge works, before it applies to you. Nothing changes without notice.

---

## For counsel and the owner: what the statement rests on, and what changes it

**Today (pilot), as configured:**
- **No charges.** Charging (`individual_commerce`) is OFF, and no payment provider is involved.
- **The hourly limit.** AI metering (`ai_fair_use`) is OFF, so the limit is the hourly request limit: the tighter of the estate `AI_HOURLY_LIMIT` (30) and the Individual policy `ai_hourly_limit` (unset, so 30).
- **The message people see** at the limit is the product's: "You have reached the limit of 30 AI requests an hour. Try again later." (`individualQuotaRefusal`). Some routes name the kind of request instead, for example "30 questions an hour".
- **An unreadable count refuses.** If the request count cannot be read, the request is refused (it fails closed). It is never let through unlimited.

**When metering is activated** (a separate owner GO), this statement must be replaced before activation, because the experience changes. It would need to describe:
- **a monthly allowance** in Competen AI units: 4,000 a month, a 500 essential reserve, and a rolling five-hour limit of 1,000 (owner D3, provisional);
- **the service levels people see:**
  - "Your AI help is available."
  - "running in an efficient mode"
  - "nearly used. Essential help … is still available."
  - **Continuity Mode:** "Your AI allowance for this period is used. Everything you have saved stays available, and new AI help returns when your allowance renews."
- **the anniversary reset**;
- **that people see a band, never a unit count**;
- **for Professional,** that the allowance replaces the hourly limit (#83).

**When charging is activated** (separate GO): commercial terms (PRODUCTION-READINESS §5, item 11) are needed. They are not part of this pilot set.

**Questions for counsel:**
1. Is a statement in the app, accepted with the Terms, enough? Or should it form part of the Terms (Holdings Terms §9, Scholar Terms §8)?
2. Consumer-protection review of "no unexpected charges" for any later paid plan.
