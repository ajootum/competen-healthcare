# Competen Scholar: Terms of Use (Scholar operating entity)

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED AND NOT PUBLISHED.** Nothing here has legal effect until it is signed off, approved and published with a version (COMPETEN-LEGAL-001).

| | |
|---|---|
| Document reference | COMPETEN-SCHOLAR-LEGAL-TERMS-001 |
| Draft | counsel-draft-1, 25 October 2026. It is drawn from §6 of the owner's interim Individual Terms Draft 0.1, completed for the pilot as built. |
| Planned publication path | `/legal/scholar/terms/<version>` |
| Operating entity | **[OWNER SLOT: full registered legal name of the Scholar operating entity, pending incorporation or confirmation]**, registration number [OWNER SLOT], registered address [OWNER SLOT]. [COUNSEL: if the entity is not yet incorporated, approve the interim arrangement and say who issues these Terms until it is.] |
| Contact | Scholar support [OWNER SLOT]. Privacy [OWNER SLOT]. |
| Counsel sign-off | **[COUNSEL SLOT]** |
| Owner approval | [OWNER SLOT] |

**Read with:**
- the Competen Individual Terms of Use (Competen Holdings) (01), which govern the shared foundation (identity, profile, Passport, Personal AI);
- the Competen Scholar Privacy Notice (04).

---

## 1. About these Terms

1.1 Competen Scholar is the study experience of Competen Individual. These Terms are issued by the Scholar operating entity and govern your use of Scholar.

1.2 You accept these Terms, with the Holdings Individual Terms and the applicable Privacy Notices, before you first use Scholar.

## 2. The pilot, and who may use Scholar

2.1 Scholar is in an **invitation-only pilot**.
- There is no public sign-up.
- **No fees are charged.**

2.2 **You must be 18 or over.** The administrator who invites you to Scholar confirms this, and the confirmation is recorded with your access. You must not use Scholar if you are under 18 (Adult Eligibility Statement, 07).

## 3. What Scholar provides in the pilot

3.1 Scholar provides:
- **uploading your own study materials** (notes, slides and documents in the supported formats);
- **AI-assisted explanations and guided learning** grounded in the passages of your notes you ask about;
- **practice questions** generated from your notes, with **revision and spaced recall**;
- **AI evaluation of short answers.** It is always labelled as an AI evaluation, and is never a mark of competence;
- **private clinical reasoning cases** generated from your notes, for your own practice;
- **your progress**, and **self-directed achievements** you may choose to show in your Passport.

3.2 **Not available in the pilot:**
- the shared, clinically approved case library;
- any contribution of your material or cases to a shared library;
- AI feedback on clinical-reasoning answers. You review your own reasoning against the case. [PRODUCT: this is true only once the Individual policy `scholar_case_reasoning_feedback` is set to "the student's own review only", on staging and in production. Confirm it before publication.]

Anything marked "not available yet" is not promised.

## 4. Your study materials

4.1 **Upload only material you have the right to use.** That means your own notes, or material you are permitted to upload and process for your study.

4.2 **Do not upload identifiable patient information or confidential clinical records.** Examples drawn from practice must be de-identified and lawful to use.

4.3 **For each upload you confirm two things** (Upload Attestation, 08):
- that the file contains no identifiable patient information;
- that you have permission to upload and use it.

Scholar may refuse an upload that appears to break these rules. Automated screening cannot detect every identifier.

4.4 Your materials are private to you. They are not shared with other learners, not used to train AI models, and not added to any library.

4.5 **You can delete a material at any time.** Deleting it also removes what was derived from it in your study record, such as the passages, questions and sets that relied only on it.

## 5. AI-assisted learning

5.1 **AI help is optional, and asked for separately.** Before you first use it, you are shown the Scholar AI-Processing Notice (06) and asked to agree.
- You can turn AI help off at any time. That stops new AI requests and deletes nothing.
- If the notice changes, you are asked again.

5.2 **Only the passages of your notes that you ask about are sent to the AI.**
- Explanations are shown to you and not saved.
- Practice questions are saved with the passage they came from, so you can check them.

5.3 **AI output may be incomplete, wrong or out of date.** It supports learning only. It does not replace approved clinical guidance, your educators, supervision or independently verified assessment.

5.4 **Grounding.** Scholar checks AI output against your notes. Content that cannot be grounded, or that seems to invent a figure, is withheld rather than shown. This reduces errors. It does not remove them.

## 6. Clinical reasoning cases

6.1 **Cases are educational exercises.** A case generated from your notes is private to you, is **not clinically reviewed**, and is labelled as such.

6.2 Completing a case does not show that you are competent to perform any procedure or make any independent clinical decision.

## 7. Practice, evaluation and progress

7.1 Scholar records your answers, revision history and progress, so it can schedule revision and show you your progress.

7.2 **Practice accuracy reflects particular exercises only.** It does not demonstrate mastery, competence or readiness for unsupervised practice. Scholar does not guarantee examination success, progression, graduation or registration.

## 8. AI usage limits

8.1 AI help is subject to a usage limit, during the pilot a number of requests per hour (AI Allowance and Fair-Use Statement, 09).
- At the limit, AI help pauses until it resets.
- Your saved materials, questions and progress stay available.
- **Nothing is charged.**

## 9. Your content and rights

9.1 You keep your rights in your materials.

9.2 You grant the Scholar operating entity a **limited, non-exclusive permission** to store, process, display and technically transform them, only to provide Scholar to you. This includes sending the passages you ask about to the AI provider.

9.3 **This permission does not allow:**
- public sharing;
- disclosure to other learners;
- AI training;
- inclusion in any shared library;
- commercial redistribution.

9.4 You must respect copyright, including any third-party lecture material in your notes.

## 10. Confidentiality

10.1 Your study is private.
- No employer or institution sees your materials, answers, accuracy or AI interactions through Competen, even when you also hold an organisational membership.
- Only achievements you choose to show appear in your Passport, and you can remove them.

10.2 You remain responsible for patient confidentiality and your professional obligations.

## 11. End of access

11.1 When your Scholar entitlement ends or is revoked, Scholar closes to you. Your shared identity and Passport remain, as the Holdings Individual Terms describe.

11.2 You may delete your materials before then, or ask about your data under the Scholar Privacy Notice.

## 12. Disclaimer, changes, law and contact

12.1 **Scholar is a study aid.** It is not formal education, supervised training, assessment or clinical guidance. [COUNSEL: settle the limitation of liability for this entity.] Nothing excludes a liability or right that cannot lawfully be excluded.

12.2 Each version has an identifier, an effective date and a permanent URL. Where acceptance is required, you are asked again.

12.3 Governing law: intended to be the laws of Uganda [COUNSEL: confirm for this entity, and any mandatory rights where users live].

12.4 Contact: [OWNER SLOT: Scholar operating entity, registered name, address, support and privacy contacts].

---

### For counsel

- **What these Terms cover.** They are the Scholar-specific part of the owner's one-umbrella set (owner, 23 October: Scholar and Professional are both Competen Individual).
- **How acceptance is recorded today.** The product records one terms version and one privacy version per acceptance, and both operating entities point at one set (`src/lib/individual/legal.ts`, `INDIVIDUAL_LEGAL_*`). Whether Scholar users accept these Terms as a separate document, or as part of one consolidated set, is a decision for the owner and counsel.
- **Checked against the product as built (25 October 2026):**
  - invitation-only, with 18+ confirmed by the inviter;
  - AI consent v3;
  - no explanation storage;
  - questions saved with their passage;
  - deletion prunes derived records;
  - grounding withholds;
  - private cases are labelled not clinically reviewed;
  - the case library, contribution and AI case-reasoning feedback are off.
