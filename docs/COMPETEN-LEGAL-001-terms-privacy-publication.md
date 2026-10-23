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
