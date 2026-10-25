# Competen Knowledge & Research Intelligence: research governance policy

> **DRAFT FOR COUNSEL / ETHICS REVIEW. NOT ADOPTED.** This policy describes rules the product already enforces and the
> decisions still needed. Adoption needs counsel, an ethics adviser and the owner. Production research-data
> collection, external sharing and publication stay OFF until a separate owner GO.

| | |
|---|---|
| Reference | COMPETEN-CKRI-POLICY-001, counsel-ethics-draft-1, 25 October 2026 |
| Applies to | Competen Holdings, the Scholar operating entity, and every person appointed to a CKRI position |
| Sign-off | **[COUNSEL SLOT] [ETHICS SLOT] [OWNER SLOT]** |

Each rule cites what enforces it: a migration (440–444), a harness check (`scripts/ckri-harness.ts`), or "policy"
where it rests on people.

## 1. Principles (owner, 25 October 2026)

1. Research participation is separate and optional.
2. Personal AI consent is not research consent.
3. Each processing purpose has a documented lawful basis.
4. Withdrawal and deletion rights are preserved.
5. Research begins only after ethics review or a documented exemption.
6. External partners get access only under an agreement and with authorisation.
7. Development uses synthetic or appropriately authorised data.

## 2. Roles

| Role (HQ position) | May | May not |
|---|---|---|
| Research Governance Officer, Quality Council Member (`hq.quality.research.govern`) | activate and retire purposes; publish the policy; decide projects; record ethics approvals and exemptions; record and authorise agreements; appoint teams; approve datasets; decide publication | activate a purpose they authored; decide, exempt, approve data for, or decide publication of a project they propose or are on; authorise an agreement they recorded (440, 443, 444) |
| Research Lead (`hq.quality.research.propose`) | propose and lead a project; write and freeze its documents; request publication | approve anything on their own project |
| Research Scientific Reviewer (`hq.quality.research.review`) | review frozen manuscripts and outputs | review a project they are on or proposed (443) |
| Knowledge Educator (`hq.learning.ckri.educator`) | see released aggregates; raise needs; draft and submit resources | publish; approve clinically (442) |

## 3. Purposes and lawful basis

- **A purpose is in force only once a governor who did not write it activates it** (440), **and only with its lawful
  basis and the decision reference recorded** (444). Both are frozen once it is in force.
- **The register** of purposes and their bases is draft 11.

## 4. Participation

- **Two CKRI choices,** each recorded on its own:
  - collective analytics, one per person;
  - a research study, one per person per study.
  Both are opt-in, recording the notice version shown (440). There is no combined consent.
- **Withdrawal is never blocked** by any switch (harness K1-5).
- **Withdrawal excludes the person from every later count** (441).
- **Erasure of the account removes the choices and their history** (440).
- **Nothing in Scholar reads a research choice** (K1-4). Declining changes no learning.
- **The Scholar AI consent is never read as research consent** (K5-1).

## 5. Data minimisation and disclosure

- **Eligible data** is a closed, code-reviewed list of structured fields (data-contracts.ts). Uploads, conversations,
  free text, AI feedback and clinical narrative are never eligible (K2-1, K2-2).
- **Counting happens in the database.** No row of learner evidence reaches the application or a researcher (441).
- **Disclosure thresholds:**
  - minimum group size set by policy, never below 5 (441 CHECK);
  - complementary suppression;
  - rounding;
  - no person column in any reported cell.
- **Residual risk is acknowledged.** These steps reduce re-identification risk and do not remove it.
  [ETHICS: is a periodic disclosure-risk review needed?]

## 6. Ethics review or documented exemption

- **No project recruits** without a recorded ethics approval **or** a documented exemption (444).
- **No data is released** to a project before one is recorded (444).
- **A research study is never exempt.** Its purpose always requires ethics review (440 CHECK, 444).
- **An exemption is recorded by a governor who is not the proposer,** with its reference and basis. It is frozen once
  research begins (444).
- [ETHICS SLOT: which committee or committees review CKRI studies; what may be exempted, for example aggregate
  analysis of suppressed counts for internal quality improvement; who decides an exemption, and how it is documented.]

## 7. Partner agreements and external access

- **An agreement is recorded by a governor and put in force by a different governor** (444). It must state:
  - scientific leadership;
  - data responsibilities;
  - intellectual property;
  - authorship;
  - publication rights.
  It must also record where the signed copy is kept, and its signing and expiry dates.
- **External team members** are appointed only under an agreement in force for that project (444), with aggregate-only
  access (443).
- **Ending or expiry of an agreement ends every external appointment made under it** (444). Ending never waits for a
  launch switch.
- **An institution-sponsored study** recruits only with an agreement in force with that institution (444).
- **No external account is created and no dataset is shared** by the product (policy, owner GO §7). New partnerships
  need separate owner authorisation.

## 8. Projects, outputs and publication

- **Before submission,** a protocol (population, selection, instruments, scoring, missing data, methods, limitations,
  generalisability) and an analysis plan are frozen (443).
- **Outputs** use only the project's approved datasets and carry their full integrity record. Outputs that use
  AI-marked figures must say they are not validated measurements (443).
- **Publication needs:**
  - an independent endorsement of the exact manuscript;
  - a governor not on the team;
  - the integrity attestation: no patient-outcome claims from Scholar performance, and no AI evaluation presented as
    validated (443).
- **Corrections and withdrawals are recorded, never edited** (443).

## 9. Retention

| Record | Proposed retention | Enforced by |
|---|---|---|
| Aggregate snapshots | policy setting, 30 to 1825 days (default 365). Extended only to an approved project's date. | 441, 443 |
| Participation choices and history | while the account exists. Removed on erasure. | 440 |
| Projects, decisions, reviews, publications, agreements | [COUNSEL: research records retention period] | append-only (440, 443, 444) |

## 10. AI and cost

- **Collective analytics use no AI** (441).
- **AI used for shared content or research** is charged to a platform or institution budget through the Holdings AI
  ledger, never to a learner (421 and the CKRI attribution, #109).
- **No AI model is trained on learner uploads** (policy).

## 11. Development and testing data

- **Staging and development use synthetic data only.**
- The CKRI database tests (`scripts/ckri-db/test-44x.sql`) create synthetic people inside a transaction that is
  rolled back, on a local disposable database.
- **No real learner data is copied** into development.

## 12. Review

[OWNER/COUNSEL/ETHICS: review cycle, for example annually and before any production activation.]
