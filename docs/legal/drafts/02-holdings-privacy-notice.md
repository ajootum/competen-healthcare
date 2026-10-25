# Competen Individual: Privacy Notice (Competen Holdings)

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED AND NOT PUBLISHED.** Bracketed slots are facts the owner must supply or decisions counsel must make. Nothing here has legal effect until it is signed off, approved and published with a version (COMPETEN-LEGAL-001).

| | |
|---|---|
| Document reference | COMPETEN-IND-LEGAL-PRIVACY-001 |
| Draft | counsel-draft-1, 25 October 2026. It completes the owner's interim Draft 0.3 and the Holdings Platform Privacy Notice Draft 0.1. |
| Planned publication path | `/legal/holdings/privacy/<version>` |
| Responsible entity | **[OWNER SLOT: full registered legal name of Competen Holdings]**, registration number [OWNER SLOT], registered address [OWNER SLOT] |
| Role | **[COUNSEL SLOT: confirm. Proposed in the Data Roles memo (05): controller for the activities in §2.]** |
| Privacy contact | [OWNER SLOT: verified address and email]. Responsible officer: [OWNER SLOT] |
| PDPO registration | [COUNSEL SLOT: registration status with Uganda's Personal Data Protection Office] |
| Counsel sign-off | **[COUNSEL SLOT]** |
| Owner approval | [OWNER SLOT] |

**Scope.** This Notice covers what Competen Holdings does with your information in Competen Individual:
- the shared foundation: your identity, profile and history, the Competen Passport and its sharing, and Personal AI;
- Competen Professional.

Competen Scholar has its own Notice, issued by the Scholar operating entity (04).

---

## 1. Who we are and what this Notice covers

1.1 Competen Individual is Competen's personal learning and professional development service, offered during an **invitation-only pilot**. It has two experiences, Scholar and Professional, on one shared foundation.

1.2 **Competen Holdings is responsible for:**
- (a) the shared foundation;
- (b) Competen Professional.

The Scholar operating entity is responsible for Scholar (see its Notice). Where Scholar uses the shared foundation, Competen Holdings processes that information as described in the Data Roles memo (05). [COUNSEL: confirm the roles and record them in the intra-group agreement.]

## 2. What we process, why, and on what basis

| Activity | Information | Purpose | Proposed lawful basis [COUNSEL to approve each] |
|---|---|---|---|
| **Your account and sign-in** (shared Competen identity) | Name (and optional given and family names), email, authentication status and events, sign-in security data | To let you sign in securely to one Competen identity | Performance of the service you asked for. Legitimate interest in security. |
| **Invitations and access** | Who invited you, the invitation and its expiry, your Individual membership, entitlements and their dates, the inviting administrator's 18+ confirmation (for Scholar) | Invitation-only access control | Performance of the service. Legal obligation (age restriction) [COUNSEL]. |
| **Your acceptance of the Terms and this Notice** | The versions you accepted and when | To show which documents applied | Legal obligation and accountability |
| **Profile and history** | What you add to your profile. Your history across experiences (entitlement periods). | To give you one continuous record | Performance of the service |
| **Competen Professional** | Profession, registration body and number, country and renewal date (self-declared). Development needs and goals. CPD entries and reflections. Competency evidence and documents. Competency links (your own, or AI suggestions you accepted). Reminder preferences. | To provide Professional | Performance of the service. Some reflections may contain health-related or other sensitive information [COUNSEL: the condition for sensitive data]. |
| **The Passport and share links** | Records you select, their provenance (issued by an organisation or added by you), and your share links (period, revocation) | To let you present and share selected records | Performance of the service, at your instruction |
| **Personal AI** | The text you submit for an AI request, and the selected records it needs. Usage metadata (model, request size, outcome, cost). | To give AI help you ask for, and to control usage and cost | Performance of the service. Legitimate interest (fair use). [COUNSEL: whether a separate notice or consent is required for Professional AI, as Scholar has.] |
| **Reminders** | Dates you recorded, and your reminder preferences | In-app reminders (on by default). Email reminders (off unless you turn them on). | Performance of the service. Consent for email, by switching it on. |
| **Security, audit and support** | Audit records of administrative and privacy-relevant actions, and security and diagnostic logs | To protect accounts, investigate misuse and keep an accountable record | Legitimate interest. Legal obligation. |

**Terms acceptance is not blanket consent.** Where a feature relies on consent, it is asked for separately and can be withdrawn.

## 3. Where your information comes from

3.1 It comes from:
- you;
- the administrator who invited you (your email, optional name, the experiences offered, the eligibility confirmation);
- organisations that issued records to you through Competen;
- the technical services that run the platform.

3.2 Having one identity across Competen products does not make one product's records visible in another.

## 4. Artificial intelligence

4.1 **When you ask for AI help, the text of your request is sent to our AI provider, with the records it needs.** In Professional, for example, your development needs and CPD entries are sent for a CPD plan.
- The provider in the pilot is **Anthropic** (its API). Requests are routed through Competen's own AI gateway.
- [COUNSEL: the provider entity, its data-processing terms, its retention of API inputs and outputs, and the transfer basis (§7).]

4.2 **Screening comes first.** Before a request is sent, Competen screens it for patient identifiers and refuses one that contains them. Screening is a safeguard and cannot catch everything.

4.3 **What Competen keeps:**
- Professional AI drafts are shown to you and **not saved** unless you save them.
- Personal AI has **no conversational memory**.
- Competen's AI logs keep **metadata** (model, operation, request size, outcome, cost), **not** the text of your questions or answers.

4.4 **No training.** Competen does not use your information to train AI models. [COUNSEL: confirm the provider's contractual no-training term for API data.]

4.5 **AI output is a suggestion.** It is not a decision about you, and nothing it produces becomes part of your record unless you save it. No automated decision with legal or similarly significant effect is made about you (§10).

## 5. Who sees your information

5.1 **Your private Individual records are not visible to any employer or organisation through Competen.** This is so even when you also hold an organisational Competen membership.
- An organisation keeps access to records it issued to you.
- It does not gain access to your other Individual records.

5.2 **Recipients:**
- (a) **people you share a Passport link with**, for the records you selected, until the link expires or you revoke it;
- (b) **authorised Competen personnel**, where needed to run, support and secure the service, under access controls and audit;
- (c) **the Scholar operating entity**, for the shared-foundation information Scholar needs, as the Data Roles memo describes;
- (d) **our service providers**, under contract (§6);
- (e) **authorities**, where the law requires.

5.3 We do not sell your information, and we do not use it for advertising.

## 6. Service providers (processors)

| Provider | Service | Where [COUNSEL to confirm] |
|---|---|---|
| Supabase | Database, authentication, private file storage | Production database in AWS eu-west-1 (Ireland), per COMPETEN-OPS-001. [Confirm the project region and the data-processing terms.] |
| Vercel | Application hosting and delivery | Global edge network. [Confirm the processing locations and terms.] |
| Anthropic | AI processing (§4) | [Confirm the processing locations and terms.] |
| Email delivery: Supabase's mailer, or the configured SMTP provider. Notifications through Resend where configured. | Invitation, sign-in and reminder emails | [OWNER and COUNSEL: name the production SMTP and email providers and their terms.] |

No payment provider processes Individual information during the pilot: no charges are made.

## 7. International transfers

Our providers may process information outside Uganda (§6). [COUNSEL: map each transfer, and confirm the legal conditions for it and the safeguards in each provider's terms, under the Data Protection and Privacy Act, 2019 and its Regulations.]

## 8. How long we keep information

[COUNSEL and OWNER: approve a retention schedule. The facts it must reflect are below.]

**Account and identity:** kept while you have a Competen account.

**When your Individual access ends:**
- Your membership and entitlement records are kept as history.
- Your own Passport records remain readable to you.

**Professional records** (needs, goals, CPD, evidence, documents) are kept until you delete them, or until your account is closed, subject to [COUNSEL: the retention criteria].
- A deleted item is removed.
- Its document file is removed from private storage.

**Share links:**
- They expire automatically, after one year at most.
- A revoked or expired link stops working.

**Acceptance and audit records** are kept as accountability evidence [COUNSEL: the period].

**AI usage metadata** is kept for usage control, cost reconciliation and audit [COUNSEL: the period].

**Backups:** encrypted backups are kept on a rolling schedule and are restored only for recovery [OWNER: the retention period, per OPS-001].

## 9. Security

**Safeguards include:**
- secure authentication, and product entitlements checked on the server;
- row-level security on Individual tables, so you can read only your own rows;
- no browser writes to Professional tables;
- private file storage with short-lived signed download links;
- restricted, audited administration;
- encrypted backups.

No system is completely secure. Please protect your sign-in and tell us about suspected misuse.

**If a personal-data incident occurs**, we will contain it, assess it, record it, and notify the regulator and affected people where the law requires.

## 10. Your rights

10.1 Subject to the law, you may:
- ask what we process;
- get a copy;
- correct it;
- ask for erasure where available;
- withdraw consent where we rely on it;
- object or ask for restriction where available.

You may also ask about any automated processing.

10.2 **What you can do yourself:**
- You can edit or delete your own Professional records in the app.
- You can revoke share links.
- You can switch email reminders off.
- An organisation's record about you may need correction by that organisation. Competen can record a dispute without presenting a record as verified.

10.3 Send requests to [OWNER SLOT: privacy contact]. We may verify your identity first. We reply within the statutory period. You may complain to Uganda's Personal Data Protection Office [COUNSEL: confirm the current complaint channel] or to another competent authority.

## 11. Cookies

Competen uses strictly necessary authentication and security cookies. [TECHNICAL and COUNSEL: confirm the inventory of cookie names, purposes and durations, and confirm that there are no analytics or marketing cookies on Individual pages.]

## 12. Children

Competen Professional is for professionals. The Scholar pilot is restricted to adults aged 18 or over. Competen Individual offers no service intended for children.

## 13. Changes to this Notice

Each version has a version identifier, an effective date and a permanent URL. Material changes are notified, and where acceptance is required, you are asked before you continue. Earlier versions stay available at their URLs.

## 14. Contact and complaints

Competen Holdings: [OWNER SLOT: registered name, number, address, privacy contact, responsible officer]. Website: https://www.competenhealthcare.com

---

### For counsel: the facts this Notice rests on, and what is still open

**Checked against the product as built on 25 October 2026:**
- **Invitation-only pilot.** Self-registration, charging, AI metering and the case library are OFF.
- **The Individual release gate is OFF in production.** These documents gate first use when it is switched on.
- **Personal AI:** identifier screening (M6), no memory, no saved drafts, metadata-only logs.
- **Share links:** expire within 365 days, and can be revoked.
- **Reminders:** in-app ON and email OFF by default (migration 374).
- **Private storage:** short-lived signed URLs. Professional documents are capped at 4 MB.

**Open:**
- the registered entity and contacts;
- the role allocation (05);
- the lawful bases and sensitive-data condition per row of §2;
- provider terms and transfers (§6, §7);
- the retention schedule (§8);
- PDPO registration;
- the cookie inventory;
- whether Professional AI needs its own notice or consent (as Scholar has, 06).
