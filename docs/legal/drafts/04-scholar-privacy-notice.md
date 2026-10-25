# Competen Scholar: Privacy Notice (Scholar operating entity)

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED AND NOT PUBLISHED.** Bracketed slots are owner facts or counsel decisions (COMPETEN-LEGAL-001).

| | |
|---|---|
| Document reference | COMPETEN-SCHOLAR-LEGAL-PRIVACY-001 |
| Draft | counsel-draft-1, 25 October 2026. It is drawn from the Scholar parts of the owner's interim Individual Privacy Notice Draft 0.3. |
| Planned publication path | `/legal/scholar/privacy/<version>` |
| Responsible entity | **[OWNER SLOT: full registered legal name of the Scholar operating entity]**, registration number [OWNER SLOT], registered address [OWNER SLOT] |
| Role | **[COUNSEL SLOT: confirm. Proposed in the Data Roles memo (05): controller for Scholar study processing.]** |
| Privacy contact | [OWNER SLOT]. Responsible officer: [OWNER SLOT] |
| PDPO registration | [COUNSEL SLOT] |
| Counsel sign-off | **[COUNSEL SLOT]** |
| Owner approval | [OWNER SLOT] |

**Scope.** This Notice covers your study in Competen Scholar. Your Competen identity, profile, Passport and the shared AI infrastructure are covered by the Competen Individual Privacy Notice (Competen Holdings) (02).

---

## 1. What Scholar processes, and why

| Activity | Information | Purpose | Proposed lawful basis [COUNSEL] |
|---|---|---|---|
| **Your study materials** | Files you upload, the text extracted from them, and the passages they are divided into | To let you study your own material | Performance of the service |
| **Your upload confirmation** | That you confirmed the file has no identifiable patient information and that you may use it, and when (Upload Attestation, 08) | Accountability for what is uploaded | Legal obligation and accountability |
| **AI-assisted learning** | The passages you ask about, your question, and the AI's answer | Explanations, guided learning, practice questions and short-answer evaluation | **Your consent to AI processing (06)**, given separately and revocable. [COUNSEL: whether consent is the right basis, or performance of the service with consent as an added safeguard.] |
| **Your AI-processing agreement** | The notice version you agreed to, and when. Withdrawal. | To ask again when the notice changes, and to honour withdrawal | Legal obligation and accountability |
| **Practice and revision** | Questions (saved with their source passage), your answers, recall ratings, revision schedule, saved items | Revision and spaced recall | Performance of the service |
| **Clinical reasoning cases** | Private cases generated from your notes, your decisions and written reasoning, and your case history | Educational case practice | Performance of the service |
| **Progress and achievements** | Your progress. Achievements you choose to show in your Passport. | To show your progress, and to let you present selected achievements | Performance of the service, at your choice |
| **Study context** (if you give it) | Your programme, level or institution, as you enter them, for tailoring | Tailoring | Performance of the service |
| **Adult eligibility** | The inviting administrator's confirmation that you are 18 or over | The pilot's age restriction | Legal obligation [COUNSEL] |

## 2. AI processing in Scholar

2.1 **AI help is off until you agree to the Scholar AI-Processing Notice (06).** You can turn it off at any time: that stops new requests and deletes nothing.

2.2 **What is sent, and what is kept:**
- Only the passages of your notes you ask about are sent to the AI, with your request.
- Explanations are shown to you and **not saved**.
- Practice questions are **saved with their passage**, so you can check them.

2.3 **Screening comes first.** Requests and uploads are screened for patient identifiers first. Screening is a safeguard that cannot catch everything, and you must not upload identifiable patient information.

2.4 **The provider.** AI requests go through Competen's AI gateway to **Anthropic**. Competen's logs keep usage metadata (model, request size, outcome, cost), not your text. [COUNSEL: the provider terms, retention and transfers (Holdings Notice §6 and §7).]

2.5 **No training.** Your materials are not used to train AI models, are not shown to other learners, and are not added to any library.

## 3. Who sees your study

3.1 **Your study is private.** No employer, institution or educator sees your materials, answers, accuracy, cases or AI interactions through Competen.

3.2 **Only what you show:** an achievement appears in your Passport only if you choose it, and you can remove it. Removing it does not delete your study.

3.3 **Recipients:**
- Competen Holdings, as the provider of the shared foundation and infrastructure (Data Roles memo, 05);
- service providers under contract (Holdings Notice §6);
- authorities where the law requires.

3.4 **No contribution.** In the pilot, nothing you create in Scholar is offered to, or used in, any shared case library.

## 4. How long we keep it, and deleting it

4.1 **Your materials and what was made from them are kept until you delete them**, or until your account is closed, subject to [COUNSEL: retention criteria].

4.2 **Deleting a material deletes it in full:**
- its stored file;
- its passages;
- the questions, sets and sessions that relied only on it.

4.3 **Withdrawing AI consent** stops new AI processing and deletes nothing you saved.

4.4 **Your agreement record and audit records** are kept as accountability evidence [COUNSEL: period].

4.5 **When your Scholar access ends**, Scholar closes to you. Records are then kept or deleted under the retention schedule [COUNSEL and OWNER: approve].

## 5. Security, rights, children, changes and contact

5.1 **Security:**
- your files are kept in private storage, reachable only through short-lived signed links;
- you can read only your own rows;
- writes go through the server;
- administration is audited.

The Holdings Notice §9 applies, including incident handling.

5.2 **Your rights:** the same as in the Holdings Notice §10. Make requests to [OWNER SLOT: Scholar privacy contact]. You may complain to Uganda's Personal Data Protection Office [COUNSEL: confirm the channel].

5.3 **Children.** Scholar is for people aged 18 or over during the pilot, and there is no service for children.

5.4 **Changes.** Versioned, with permanent URLs. You are asked again where required.

5.5 **Contact:** [OWNER SLOT: Scholar operating entity, registered name, address, privacy contact, responsible officer].

---

### For counsel

**Checked against the product as built (25 October 2026):**
- AI consent v3 (`scholar-ai-uploads-notice-v3`): a separate, revocable consent that is asked again for a new version;
- explanations are not stored;
- questions are stored with their passage;
- deletion prunes what was derived from a material;
- the upload attestation is required, stored with its timestamp;
- identifier screening on uploads and AI requests;
- no educator access to private study;
- the case library and contribution are OFF.

**⚠ One product setting to confirm before publication.** AI feedback on clinical-reasoning answers is to be off for the pilot (owner, 25 October 2026). It is off only once the Individual policy `scholar_case_reasoning_feedback` is set to "the student's own review only". This Notice does not describe that feedback as available.

**Open:**
- the entity, its incorporation or interim arrangement;
- the role allocation (05);
- the lawful basis for AI processing (consent, or contract plus consent);
- retention;
- PDPO registration.
