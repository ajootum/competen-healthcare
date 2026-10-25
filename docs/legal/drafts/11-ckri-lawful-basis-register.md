# Competen Knowledge & Research Intelligence: lawful-basis register

> **DRAFT FOR COUNSEL / ETHICS REVIEW. PROPOSALS ONLY. NO BASIS IN THIS REGISTER IS DECIDED.** Each row needs counsel's
> decision. The product records the decided basis per purpose: `ckri_purpose.lawful_basis` and `basis_decision_ref`
> (migration 444). A purpose cannot be put in force until both are recorded, and the basis is frozen once it is
> (harness K5-2). Production research-data collection stays OFF.

| | |
|---|---|
| Reference | COMPETEN-CKRI-BASIS-001, counsel-draft-1, 25 October 2026 |
| Law | Data Protection and Privacy Act, 2019 (Uganda), and its Regulations [COUNSEL: confirm, and any other applicable law for partners outside Uganda] |
| Counsel sign-off | **[COUNSEL SLOT]** |

The values the product accepts are `consent`, `contract`, `legal_obligation`, `public_task`, `legitimate_interests` and
`vital_interests` [COUNSEL: confirm this list matches the Act's grounds, and the wording to show].

## Register

| # | Processing purpose | Data | Proposed controller | Proposed basis | How the product enforces it | Counsel decision |
|---|---|---|---|---|---|---|
| P1 | **Personal AI learning** (Scholar) | the learner's own material and learning records | Scholar operating entity (draft 05) | consent, or contract with consent as a safeguard (Holdings counsel item 2) | `individual_scholar_consent` (372). **CKRI never reads it as research consent** (K5-1). | [COUNSEL SLOT] |
| P2 | **Collective educational analytics** | the structured fields in data-contracts.ts, counted in-database; codes for programme, level, institution | [COUNSEL: Holdings, the Scholar operator, or joint] | **consent** (explicit opt-in, as built). Alternatives for counsel: legitimate interests, or public task where an institution has a mandate. | `ckri_participation` (440), opt-in, withdrawable, never gated. In-database counting with suppression (441). | [COUNSEL SLOT] |
| P3 | **Contribution of specific content** | one item the learner offers (a case) | [COUNSEL] | consent plus a licence (pilot item 9/9a) | `case_candidacy` (423). **OFF by owner ruling.** | [COUNSEL SLOT, deferred with pilot items 9/9a] |
| P4 | **An identified research study** (one row per study when it is proposed) | aggregate snapshots approved as the study's datasets | [COUNSEL: Holdings, or joint with the partner institution] | consent to take part, plus research ethics approval (not an alternative to consent) | `ckri_participation` per study (440). Recruiting only with ethics approval (440). A study can never be exempted (444). Data released only after the ethics record (444). | [COUNSEL SLOT, per study] |
| P5 | **Research governance records**: purposes, choices and their history, projects, decisions, audit | person ids of those choosing or acting, timestamps, references | Holdings | legal obligation / accountability [COUNSEL] | append-only trails written only by the database (440, 443) | [COUNSEL SLOT] |
| P6 | **Partner agreement records** and the external team members appointed under them | partner details, agreement terms and references, the member's profile id | Holdings | contract, or legitimate interests [COUNSEL] | `ckri_partner_agreement` (444). External access only under an authorised agreement in force. | [COUNSEL SLOT] |
| P7 | **Aggregate snapshots, kept for their retention period** | counts and rates only, no person column | as P2 | as P2. [COUNSEL: whether suppressed, rounded aggregates are still personal data] | a retention date on every snapshot. Purged after it. Extended only for an approved study (441, 443). | [COUNSEL SLOT] |
| P8 | **Educator-developed knowledge resources** | educator-written content. No learner data. | Holdings | legitimate interests, or contract with the educator [COUNSEL] | no column can reference a learner or their material (442) | [COUNSEL SLOT] |

## Questions for counsel

1. **Controller for P2 and P4.** Scholar data is the Scholar operator's (draft 05). Is analytics a compatible further
   purpose, or a new purpose needing its own basis and an intra-group agreement?
2. **Consent standard.** Do the four separate choices, an opt-in with the notice version recorded, and withdrawal
   always available meet the Act's standard?
3. **Withdrawal effect** on aggregates already built (P7). See notice §5.
4. **Whether rounded, suppressed aggregates are personal data,** and so whether P7 rows need a basis at all.
5. **Transfers.** Do partners outside Uganda receive anything? As built, they receive aggregate outputs only.
6. **Registration** with the PDPO for any new controller role.
