# Competen Scholar: AI-processing notice and consent, v3 (`scholar-ai-uploads-notice-v3`)

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED.** The text below is the product's current notice, reproduced **word for word** from `src/lib/individual/scholar/config.ts` (`CONSENT_NOTICE`, `CONSENT_NOTICE_VERSION`).
>
> It was approved by the owner on 23 October 2026 as v2 with seven consistency corrections, and is pinned by `scholar-learning-harness`.
>
> **No word may change without a new version.** A new version makes every user agree again (`consentIsCurrent`).

| | |
|---|---|
| Version | `scholar-ai-uploads-notice-v3` |
| Feature | `ai_processing_uploads` (migration 215, a per-person switch) |
| Issued by | the Scholar operating entity [OWNER SLOT: registered name] |
| Counsel sign-off | **[COUNSEL SLOT]** |

## The notice, as shown

**AI-assisted learning and your information**

Competen Scholar uses artificial intelligence to help you study, understand learning materials, generate practice questions and clinical cases, and receive personalised explanations, and feedback on practice questions drawn from your notes.

AI-generated information may be incomplete or incorrect. It is intended to support learning and does not replace approved clinical guidance, professional supervision or independently verified competency assessment.

When you use AI features, relevant information you provide may be processed by Competen and its authorised technology providers to deliver those features. Your private uploads are not shared with other learners, and Competen does not use them to train AI models.

Please do not upload identifiable patient information or material you do not have permission to use.

*How it works:*
- Only the passages of your notes that you ask about are sent to the AI.
- Explanations are shown to you and not saved.
- Practice questions are saved with the passage they came from, so you can check them.
- Turning AI help off stops new AI requests. It deletes nothing: your notes, questions and progress stay until you delete them.

You can review the applicable Privacy Notice and Terms of Use before continuing.

**Statement agreed to:** "I understand how AI-assisted learning works and agree to the processing necessary to provide the AI features, as described in the Privacy Notice."

**Shown instead, until the Terms and Privacy Notice are published:** "AI help will be available once our Privacy Notice and Terms of Use are published."

**Shown after a new version:** "We have updated how we describe AI help. Please review the notice and agree again to keep using it."

## How the product records it

- **The agreement is separate from accepting the Terms,** and is off until given. Each grant stores the notice version and the time (`individual_scholar_consent`).
- **A grant counts only for the current version.** An earlier grant is kept as a record, and the person is asked again.
- **Withdrawal** (turning AI help off) stops new AI requests and deletes nothing.

## For counsel

1. **Lawful basis.** Is consent the basis for Scholar AI processing, or performance of the service with this agreement as an added safeguard? The Privacy Notice (04, §1) follows the answer.
2. **"Competen and its authorised technology providers".** Should the notice name the provider (Anthropic) and the responsible entity, or is the Privacy Notice reference enough?
3. **Accuracy against the pilot.**
   - "Generate … clinical cases": true. These are private cases from the student's notes, labelled not clinically reviewed.
   - "Feedback on practice questions drawn from your notes": true. It is short-answer AI evaluation, labelled as such.
   - AI feedback on clinical-reasoning answers is **not** named in the notice, and is to be off for the pilot.
4. **Any wording change** needs a v4. The code and harness then change together, and every user agrees again.
