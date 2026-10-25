# Competen Scholar: adult eligibility statement (`scholar-eligibility-18plus-2026-10`)

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED.** The statement below is the product's text, word for word, from `src/lib/individual/join.ts` (`SCHOLAR_ELIGIBILITY`). A new wording is a new `policyVersion`.

| | |
|---|---|
| Policy version | `scholar-eligibility-18plus-2026-10` |
| Issued by | the Scholar operating entity [OWNER SLOT: registered name] |
| Counsel sign-off | **[COUNSEL SLOT]** |

## The rule

**The Competen Scholar pilot is for people aged 18 or over.** Competen Professional has no separate age statement: it is for practising professionals.

## How eligibility is established in the pilot, which is invitation-only

1. **The inviting administrator confirms it.** An HQ Individual Product Administrator inviting a person to Scholar, or granting Scholar to an existing account, must confirm that the person is eligible.
   - Without the confirmation the request is refused: "The Competen Scholar pilot is for people aged 18 or over. Confirm eligibility to invite to Scholar."
   - The confirmation, who gave it and when are recorded with the invitation and the grant (migrations 370 and 378).
2. **The person accepts the Terms**, which state the restriction (Holdings Terms §3.3, Scholar Terms §2.2) and that an administrator's confirmation does not relieve them of giving true information.

## The self-declaration, for self-registration (OFF)

If self-registration is ever opened (`individual_self_registration`, OFF by owner decision), the person declares:

> "I confirm that I am 18 years of age or older."

The declaration is stored with its policy version and time (migration 403).

## The evidence model, for counsel and the owner to accept or change

- **Age is confirmed, not verified.** It rests on the administrator's confirmation or the person's own declaration. No identity document is checked.
- **Detection.** Competen may ask for verification where there is reason to doubt it, and may suspend access.
- **Under-18 users.** Expanding to them would need a guardian-consent design and separate review. It is not built.

**Owner and counsel decision needed:** accept this model for the invitation-only pilot. [COUNSEL SLOT]
