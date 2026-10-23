# COMPETEN-LEGAL-001 — Terms and Privacy: publication requirements and structure

> **DRAFT — NOT LEGALLY APPROVED.** This document sets out requirements and structure only. It contains
> **no legal text**, approves nothing, and names no legal entity beyond what the owner has stated. No
> document described here may be presented to anyone as approved until §7's sign-off is recorded.

| | |
|---|---|
| **Date** | 2026-10-22 |
| **Authority** | Owner brief "Infrastructure closure & IND-003 readiness", item 3 |
| **Rulings it serves** | COMPETEN-IND-001 D6 and D8 (operator and pending name), COMPETEN-IND-003 D2 (terms before use) |
| **Status** | Requirements. No implementation beyond what already exists on `ind-003/individual-foundation`. |

## 1. Current state (measured, not assumed)

| Fact | Where |
|---|---|
| No Terms or Privacy document is published anywhere in the product. | No `/legal`, `/terms` or `/privacy` route exists under `src/app`. |
| The site footer shows "Privacy Policy" and "Terms of Service" as **plain text, not links**, because no pages exist. | `FOOTER_LEGAL` (`planned: true`, `href: "#"`) in `src/lib/marketing/home-content.ts`, rendered as `<span>` in `src/components/marketing/SiteFooter.tsx`. |
| Practice records two version **strings** at signup. Its own comment says no published text sits behind them. | `LEGAL_VERSIONS` in `src/lib/practice/catalogs.ts` (`practice-terms-2026-08`, `practice-privacy-2026-08`). |
| Individual reads each entity's versions and URLs from configuration. If none are set, every experience stays closed. | `src/lib/individual/legal.ts` (the `INDIVIDUAL_LEGAL_*` variables), `src/lib/individual/terms.ts` |
| Individual records acceptance. | `individual_membership.foundation_{terms,privacy}_version` + `foundation_accepted_at` (Holdings, shared foundation). `individual_entitlement.{terms,privacy}_version` + `terms_accepted_at` (the experience operator). Both all-or-nothing by CHECK (migration 370). One `audit_log` row (`individual_terms_accepted`) per acceptance. |
| The Scholar operator's registered name is **pending**. | COMPETEN-IND-001 D8. `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_REGISTERED_NAME` is unset, and surfaces show "the Competen Scholar operating company". |
| The data roles are configured and **marked unconfirmed**. | `DATA_ROLES.confirmed = false` in `legal.ts`, also shown in Individual Settings. |

## 2. The document set

Four documents, two per operating entity. Each is versioned independently.

| Code | Document | Operating entity | Covers |
|---|---|---|---|
| `holdings-terms` | Terms of Use | Competen Holdings | The shared foundation (identity, Passport, profile and history, personal AI) and Competen Professional |
| `holdings-privacy` | Privacy Notice | Competen Holdings | Processing for the shared foundation and Professional |
| `scholar-terms` | Terms of Use | Scholar operator (registered name pending) | Competen Scholar's service |
| `scholar-privacy` | Privacy Notice | Scholar operator (registered name pending) | Competen Scholar's processing |

Scope is decided by owner and legal:
- whether the **public website** footer documents are `holdings-*` or a separate pair;
- whether **Competen Practice**'s strings converge onto this structure. Practice is a separate product, so this document does not change it.

## 3. Versioning

- **Identifier:** `<code>-<YYYY-MM-DD>` (effective date), with a `-rN` suffix for a same-day reissue. Example shape only: `holdings-terms-2027-01-15`. Staging uses a `staging-test-` prefix and never a production identifier.
- **Immutable once published.** A published version's text never changes. Any change, including a correction, is a new version.
- **Lifecycle:** `draft` → `legal-review` → `owner-approved` → `published` → `superseded`. Only `published` versions may be configured in any environment or linked publicly.
- **Per version, record:**
  - identifier;
  - document code;
  - entity;
  - effective date;
  - permanent URL;
  - SHA-256 of the published text;
  - who gave legal sign-off and when;
  - who gave owner approval and when;
  - the version it supersedes.

  These go in a register: §7, `docs/legal/REGISTER.md`, to be created at the first publication.

## 4. Public URL structure

| Path | Serves |
|---|---|
| `/legal` | An index of current documents per entity. |
| `/legal/holdings/terms` and `/legal/holdings/privacy` | The **current** published version. |
| `/legal/holdings/terms/<version>` | That version, permanently. This is the URL stored with a consent. |
| `/legal/scholar/terms`, `/legal/scholar/privacy` (and `/<version>`) | The same, for the Scholar operator. |

Rules:
- Pages render only `published` content. Drafts are never routed publicly, not even behind `noindex`.
- Every page shows the entity's registered name once confirmed, and the descriptive label until then.
- Once published, `FOOTER_LEGAL` gets real hrefs and drops `planned`. That is a website change, outside IND-003. The public experience pages `/scholar` and `/professional` link to their entity's pair.

## 5. Mapping a published version to configuration

Per environment, per entity:

```
INDIVIDUAL_LEGAL_<ENTITY>_TERMS_VERSION    = <published identifier>
INDIVIDUAL_LEGAL_<ENTITY>_TERMS_URL        = <permanent /legal/.../<version> URL>
INDIVIDUAL_LEGAL_<ENTITY>_PRIVACY_VERSION  = <published identifier>
INDIVIDUAL_LEGAL_<ENTITY>_PRIVACY_URL      = <permanent URL>
INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_REGISTERED_NAME = <only once the owner confirms it>
<ENTITY> = COMPETEN_HOLDINGS | SCHOLAR_OPERATOR
```

- An entity counts as published only when **both** of its documents are set (`publishedVersions`, `legal.ts`).
- Order of change:
  1. Publish the page.
  2. Add the register entry.
  3. Set the staging variables and verify the acceptance screen shows the right version and link.
  4. Set the production variables.

  Never set a version whose page is not live.
- Setting a new version is what triggers re-consent (§6).

## 6. Consent records and re-consent

**Today** (in this branch):
- Acceptance stores the version identifiers and the acceptance time per entity, and writes one audit row with both pairs and the entities.
- The person accepts the versions displayed. If the configuration changed while the page was open, the request is refused (409).
- **Re-consent is automatic.** The gate compares stored versions with the configured ones, so publishing a new version of either document closes the affected experience until it is accepted again. A new Holdings version closes both experiences.

**Requirements before production pilot use.** These are gaps against a defensible consent record. Each needs owner and legal confirmation, and the schema items wait for the production schema freeze to lift (owner brief item 5):

| # | Requirement | Why |
|---|---|---|
| R1 | An **append-only consent ledger**, one row per acceptance: person, entity, document code, version, permanent URL, text SHA-256, accepted at (database clock), experience, channel. It should use the cascade-allowance pattern. | Today a re-consent overwrites the stored columns, so earlier acceptances survive only in `audit_log`, which is not guaranteed append-only. |
| R2 | Store the **URL and hash** of what was accepted, not only the identifier. | It proves which text was shown. |
| R3 | Record acceptance time on the **database clock**. | The current route uses the app clock. Fine for display, but the ledger should not depend on it. |
| R4 | Define **withdrawal**: what withdrawing a privacy consent does, against ceasing to use the service. | The lawful basis is a legal question, not a product one. |
| R5 | Decide whether a **non-material** update may skip re-consent. If so, add a per-version `requires_reconsent` flag. Until then every version change forces re-acceptance, the conservative default. | Avoids consent fatigue without guessing at materiality. |
| R6 | Keep **age eligibility** (D8, 18+) in the grant record. No minor-consent flow exists, and none may be implied. | Owner ruling D8. |

## 7. Review and publication workflow

1. **Entity confirmation.** The owner confirms the Scholar operator's registered name, and whether Holdings' registered name differs from "Competen Holdings".
2. **Data roles.** Legal confirms the controller/processor allocation for the shared foundation and each service, including the intra-group arrangement. Then `DATA_ROLES.confirmed` may be set to `true`.
3. **Drafting** by counsel, for each jurisdiction where pilot users are, starting with Uganda's Data Protection and Privacy Act 2019. Nothing in this repository is a draft of that text.
4. **Legal sign-off**, recorded in the register: reviewer, date, version, SHA-256.
5. **Owner approval**, recorded in the register.
6. **Publication:** the page goes live at its permanent URL, and the register entry is marked `published`.
7. **Configuration:** staging first, verified, then production (§5).
8. **Supersession:** the previous version is marked `superseded`. Its permanent URL stays live.

## 8. Open decisions (owner / legal)

- Which entity's documents the public footer shows.
- Whether Practice converges onto this structure.
- Jurisdictions in scope for the pilot.
- The non-material-change policy (R5).
- Timing of the consent-ledger migration (R1), which is behind the production schema freeze.
- Whether Scholar has its own contact mailbox, and translation requirements.

---

# Part B — Pilot readiness (added 2026-10-23, owner GO "INDIVIDUAL RELEASE PREPARATION", item 4)

> **DRAFT — NOT LEGALLY APPROVED.** These are templates, checklists and procedures. They contain no legal
> text and no legal names. A blank cell is a blank to be filled by the owner or counsel, never an omission
> to be guessed.

## 9. Document register template

Create this as `docs/legal/REGISTER.md` at the first legal sign-off. One row per document version. Rows are append-only: a superseded version keeps its row and its URL.

| Entity (registered name) | Document | Version | Effective date | Permanent URL | SHA-256 of published text | Legal sign-off (who, date) | Owner approval (who, date) | Status | Supersedes |
|---|---|---|---|---|---|---|---|---|---|
| *Competen Holdings, as registered: to confirm* | Terms of Use | | | `/legal/holdings/terms/<version>` | | | | draft | — |
| *Competen Holdings, as registered: to confirm* | Privacy Notice | | | `/legal/holdings/privacy/<version>` | | | | draft | — |
| *Scholar operator, registered name PENDING* | Terms of Use | | | `/legal/scholar/terms/<version>` | | | | draft | — |
| *Scholar operator, registered name PENDING* | Privacy Notice | | | `/legal/scholar/privacy/<version>` | | | | draft | — |

**Status values:** `draft` → `legal-review` → `owner-approved` → `published` → `superseded` (§3). Only a `published` row may be referenced by configuration (§10).

## 10. Configuration per environment

These are read by `src/lib/individual/legal.ts`. Unset means the document is unpublished, and the experience it governs stays closed.

| Variable | Development (`.env.local`) | Staging (dev launcher / staging deploy) | Vercel Preview | Production |
|---|---|---|---|---|
| `INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION` | unset, or `dev-test-…` | `staging-test-…` only | unset | the **published** identifier, after register entry and staging verification |
| `INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_URL` | unset | unset | unset | the permanent `/legal/holdings/terms/<version>` URL |
| `INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION` | as above | as above | unset | published identifier |
| `INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_URL` | unset | unset | unset | permanent URL |
| `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION` | as above | as above | unset | published identifier |
| `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_URL` | unset | unset | unset | permanent URL |
| `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION` | as above | as above | unset | published identifier |
| `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_URL` | unset | unset | unset | permanent URL |
| `INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_REGISTERED_NAME` | unset | unset | unset | **only after the owner confirms the name** |
| `INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_REGISTERED_NAME` | unset | unset | unset | only if it differs from the "Competen Holdings" label |

**Rules:**
- No `staging-test-` or `dev-test-` identifier is ever set in Production.
- Changing a production version forces re-acceptance (§6).
- **The release flag is not an environment variable.** `practice_platform_flags.individual_app` is a database row and stays absent until release checklist item 12.

## 11. D2 confirmation checklist for the owner's counsel

These are questions only. This document draws no conclusions. Record each answer and the date in the register's notes.

1. **Entities.**
   - What are the registered legal names and registration numbers of the Holdings company and the Scholar operating company?
   - In which jurisdictions are they registered?
2. **Shared foundation.** For the identity, Competen Passport, profile and history, and personal AI that both experiences share:
   - Which entity is the controller?
   - Is the arrangement sole or joint control, or controller and processor?
   - What written agreement records it?
3. **Scholar service.** For Scholar's own processing (study materials, explanations, questions, attempts, review cards):
   - Which entity is the controller?
   - What is Holdings' role, if any?
4. **Professional service.** Is Holdings the sole controller of the Professional records (registration, plan, CPD, evidence, shares)?
5. **Intra-group sharing.** What intra-group data-sharing or processing agreement is required between Holdings and the Scholar operator, and what must it contain?
6. **Lawful basis.** For each processing purpose:
   - What is the lawful basis: contract, consent or legitimate interests?
   - Does any purpose need explicit consent? In particular: AI processing of uploaded material, and sharing a Passport link with a third party.
7. **AI processing.** Personal data is sent to a third-party AI provider through `generate()`.
   - What disclosures, international-transfer safeguards and processor terms are required?
   - Is the current "not saved, general guidance" notice sufficient?
8. **Uploaded content.** What must users be told, and what must they warrant, about patient-identifiable information in material they upload?
9. **Retention.** For each record class:
   - What retention period applies?
   - What happens on account closure, experience end or membership revocation?
   - Must `audit_log` rows be kept after erasure?
10. **Data-subject rights.** What response times and procedures are required for access, export, correction and erasure? (§13 is the interim procedure.)
11. **Age.** Is "18 and over, confirmed by HQ at grant" (D8) adequate for the pilot jurisdictions, and what evidence of age is acceptable?
12. **Jurisdictions.**
    - Which data-protection laws apply to the pilot users, starting with Uganda's Data Protection and Privacy Act 2019?
    - Is registration with a regulator required before processing begins?

When answered, the owner sets `DATA_ROLES.confirmed = true` in `src/lib/individual/legal.ts`. That is a code change with its own PR.

## 12. Individual Product Administrator appointment procedure

This uses only the existing HQ governance surface. There is no new authority and no grant engine (D9).

1. **Precondition:** migration 370 is applied to production (OPS-002 §3). Until then the position `individual_product_administrator` and its capability `hq.individual.pilot.grant` don't exist there.
2. **Who appoints:** only a platform owner. `POST /api/hq/appointments` refuses everyone else (`OWNER_ONLY`) and refuses appointing yourself.
3. **How:**
   1. Go to Competen HQ → Users → Appointments (`/super-admin/users/appointments`).
   2. Choose the person and the position **Individual Product Administrator**.
   3. Optionally set a term end.
4. **What the appointee holds:** `hq.individual.pilot.grant` (grant and end Scholar and Professional access) and `hq.platform.home.view` (the HQ landing page). Nothing else.
5. **Audit:**
   - The appointment writes an `audit_log` row: actor, position, person.
   - Ending it uses PATCH with an ending status. There is no delete, so the appointment row stays as the record.
6. **Ending:**
   - Use the same board.
   - Ending the appointment removes the capability immediately, because capabilities resolve from active appointments.
7. **Separation:** the administrator can't grant Individual access to themselves (`SELF_GRANT`).

## 13. Pilot entitlement and consent procedure

**Preconditions:**
- Release checklist items 1–8 are met (IND-003 build record).
- The gate is ON (item 12).
- The legal variables (§10) are set in production.

| Step | Who | How | Record |
|---|---|---|---|
| 1. Invitation | Owner / administrator | The person has, or creates, an ordinary Competen account. **No Individual signup surface exists.** | — |
| 2. Age (Scholar only) | Administrator | Confirm the person is 18 or over, on the evidence counsel accepts (§11 Q11). | `adultConfirmed: true` in the grant. The row records `adult_confirmed_at` and `adult_confirmed_by`. The schema refuses a Scholar row without them. |
| 3. Grant | Administrator | `POST /api/hq/individual/grants` `{ targetUserId, experiences, adultConfirmed, note }` | Membership (`source = hq_pilot_grant`), one entitlement per experience (`source = pilot`, `operating_entity`), and an `audit_log` row `individual_pilot_grant` |
| 4. Terms acceptance | The person | At first use, the experience shows the published documents with their versions and links. The person ticks and accepts. | Foundation acceptance on the membership, operator acceptance on the entitlement (versions plus time), and `audit_log` `individual_terms_accepted`. A new version forces re-acceptance. |
| 5. AI and uploads consent | The person | Scholar's consent records for AI processing of uploads (migration 372). | `individual_scholar_consent` rows |
| 6. End one experience | Administrator | `POST /api/hq/individual/grants/end` `{ targetUserId, experience }` | The live rows are cancelled, the rows themselves kept (history), and `audit_log` `individual_experience_ended` is written. The other experience is untouched (D4). |
| 7. Suspend or revoke membership | Owner | **Gap: no route exists.** Interim: an owner-run SQL update of `individual_membership.status` to `suspended` or `revoked`, setting `suspended_at` or `revoked_at` and `revoked_by`. The schema requires `revoked_at` when revoked. | Record the act in `audit_log` by hand until a route exists |
| 8. Data export on request | Owner | **Gap: no self-service export.** Interim: owner-run SELECT of the subject's rows in `individual_membership`, `individual_entitlement`, `individual_scholar_*` and `individual_professional_*`, plus their objects in the two private buckets. Deliver through a secure channel. | Note the request and its fulfilment in `audit_log` |
| 9. Erasure on exit | Owner | **Gap: no self-service erasure.** Interim, keeping the person's Competen identity and any other product:<br>1. revoke Passport share links minted from Individual;<br>2. delete the subject's objects from both buckets;<br>3. delete the subject's rows from `individual_scholar_*` and `individual_professional_*`, then `individual_entitlement` and `individual_membership`.<br>Whether audit rows are kept is §11 Q9. Deleting the auth user would erase the identity across every product, so it is never done for an Individual-only exit. | `audit_log` row recording what was erased and when |

**Gaps to build before a wider pilot:** steps 7–9 need routes. These are requirements only; they aren't scheduled in this document.
- a membership suspend and revoke route behind `hq.individual.pilot.grant`;
- a self-service export;
- a governed erasure.
