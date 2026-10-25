# Competen Individual: data roles (controller and processor). Memo for counsel

> **DRAFT FOR COUNSEL REVIEW. A PROPOSAL, NOT A DETERMINATION.** `DATA_ROLES.confirmed` in `src/lib/individual/legal.ts` stays **false** until counsel confirms the allocation in writing. Settings tells users this, and nothing in the product reads the allocation as settled.

| | |
|---|---|
| Reference | COMPETEN-IND-LEGAL-DATA-ROLES-001, counsel-draft-1, 25 October 2026 |
| Entities | Competen Holdings: [OWNER SLOT: registered name]. Scholar operating entity: [OWNER SLOT: registered name, or the interim arrangement]. |
| Counsel determination | **[COUNSEL SLOT: confirmed allocation, date, reference]** |

## 1. What the product does today

Owner ruling D2, as configuration (`DATA_ROLES`):
- **The shared foundation is managed by Competen Holdings:** your identity, Passport, profile and history, and personal AI.
- **The experience services:**
  - Scholar is operated by the **Scholar operating entity**;
  - Professional is operated by **Competen Holdings**.
- **One platform.** Both run on one Competen platform: one database project, one hosting deployment and one AI gateway, all contracted and operated by Competen Holdings [OWNER: confirm who holds the provider contracts].

## 2. Proposed allocation, for counsel to confirm or change

| Processing | Proposed controller | Proposed processor(s) | Reason |
|---|---|---|---|
| Competen identity, sign-in, account security | Competen Holdings | Supabase (authentication) | Holdings decides why and how the shared identity exists, across all Competen products |
| Invitations, Individual membership, entitlements, legal acceptances | Competen Holdings | Supabase | Holdings administers access to both experiences (HQ Individual Product Administrator) |
| Profile, history, Passport and share links | Competen Holdings | Supabase, Vercel | The foundation, which the user keeps across experiences |
| Personal AI (shared infrastructure) | **Competen Holdings for Professional and foundation use. For Scholar study use: [COUNSEL: the Scholar operator as controller, with Holdings as processor, OR joint controllers].** | Anthropic, Supabase (usage metadata) | One gateway serves both experiences, but the purpose of a Scholar request is Scholar's |
| Professional records (needs, goals, CPD, evidence, documents, reminders) | Competen Holdings | Supabase (database, private storage), Vercel, email provider | Holdings operates Professional |
| Scholar study (materials, passages, questions, revision, cases, progress, AI consent, upload attestations) | **The Scholar operating entity** | **Competen Holdings as processor** (it runs the platform), and through it Supabase, Vercel and Anthropic as sub-processors | The Scholar operator decides the purposes of study processing. Holdings provides the technology. |
| Audit and security logs across Individual | Competen Holdings (and the Scholar operator for Scholar actions: [COUNSEL]) | Supabase | Platform security is Holdings' function |

## 3. What the allocation needs, if confirmed

1. **An intra-group data-processing agreement:** the Scholar operator as controller, and Competen Holdings as processor, with authority to engage the sub-processors in §2.
2. **Processor terms with each provider**, held by Competen Holdings, and flowed down to the Scholar operator as the sub-processor list.
3. **Where joint control is chosen** for Personal AI, an arrangement setting out each party's responsibilities and one contact point for users.
4. **Publication:** the two Privacy Notices (02 and 04) name the confirmed roles, and the product's entity labels then carry the registered names (`INDIVIDUAL_LEGAL_*`, LEGAL-002).
5. **Uganda Data Protection and Privacy Act, 2019:** registration with the Personal Data Protection Office for each controller, and any processor obligations [COUNSEL].

## 4. What stays true however counsel decides

- **No organisation sees private Individual records.** No employer or institution receives private Individual records through Competen.
- **No sharing between experiences without the user.** Information moves between Scholar and Professional only as the shared foundation (identity, profile, Passport) or as the user chooses.
- **No contribution in the pilot.** No Scholar material is contributed to any shared library (the case library is OFF). A future contribution would add processing that this memo does not cover, and would need its own legal basis and agreement.

**Until counsel confirms, `DATA_ROLES.confirmed` stays `false`.** Changing it is a code change that cites the confirmation.
