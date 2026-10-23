# COMPETEN-LEGAL-002: Governed legal-document register (DESIGN ONLY)

| | |
|---|---|
| **Status** | DESIGN. Nothing in this document is implemented. No migration exists. No code reads it. |
| **Owner GO** | COMPETEN-CONFIG-002 item 9, confirmed by the owner continuation GO ("Produce the design-only legal-document register with recorded legal approval, versions, URLs and effective dates"). |
| **Depends on** | COMPETEN-LEGAL-001 (Parts A and B), COMPETEN-IND-003 ruling D2, ADR-016, migration 281 (`plat_product_line`). |
| **Not legal advice** | This designs the RECORD of approval. It drafts no legal text and names no legal entity. |

## 1. The problem

Today, `src/lib/individual/legal.ts` reads each entity's terms and privacy versions and URLs from environment variables (`INDIVIDUAL_LEGAL_<ENTITY>_{TERMS,PRIVACY}_{VERSION,URL}`). There are three consumers.

| Consumer | What it treats as "published" |
|---|---|
| `termsGate` (`src/lib/individual/terms.ts`), used by the experience layout, every experience page and API, and `/api/individual/terms` | Both versions are set in env (`publishedVersions`). A URL is not required. |
| `consentDocuments` (`src/lib/individual/scholar/consent-gate.ts`), the Scholar AI-uploads consent | Both versions **and** both URLs are set in env. |
| Settings (`[experience]/settings`) | The registered name, from env. |

These gates have three gaps:
1. **Approval.** A string in a deployment's environment is the whole proof of publication. Whoever can edit Vercel environment variables can make a document "published", and so make the person accept it. Nothing records who approved the document, when, or on whose legal sign-off.
2. **Effective date.** There is none. A version takes effect the moment it is deployed.
3. **History.** There is none in a place the application can read. LEGAL-001 §9 defines `docs/legal/REGISTER.md`, a human record that no gate can enforce.

CONFIG-002 forbids exactly this: "Do not allow configuration alone to imply legal approval."

## 2. Decisions

- **D-1. A dedicated, typed register table, not configuration.** Legal approval is evidence: who signed off, when, which text, which URL. It is not a setting.
  - **Not the Workspace Configuration Engine** (migration 076). WCE's `workspace_config_overrides` stores untyped `jsonb` draft and published pairs, scoped by hospital, unit, role and user. There, *publishing is the act*, which is precisely the conflation of configuration and approval CONFIG-002 forbids. The audit trail is also too weak: WCE rows can be reset and rolled back.
  - **No parallel configuration system either.** The register holds no product settings. It records legal facts, and the existing gates read them.
- **D-2. Platform-level, scoped by product line.** The register lives at platform level (`plat_` prefix), with each row scoped to a governance product line (`plat_product_line.code`, migration 281).
  - **Not Individual-owned:** a legal entity (Competen Holdings) and its documents are facts about the company, not about one product. Practice or Recruitment will need the same evidence later, and a second register per product would drift.
  - **Product separation holds through the scope column:** Individual reads only rows scoped to `individual`. No Individual code reads another product's rows, and vice versa.
- **D-3. Owner-only approval.** Only a platform owner can approve or withdraw a document. That is the same predicate HQ uses for `isOwner`: `super_admin`, or `platform_role = platform_owner`. No HQ position grants approval, including the Individual Product Administrator and any `hq.individual.*` right (CONFIG-002: "Do not grant Individual administrators super-admin or landlord authority").
- **D-4. The gates require an approved, effective row.** "Published" becomes: an `approved` row, not withdrawn, whose `effective_from` has passed by the **database clock**, for both terms and privacy of the entity. The entity's `url` is mandatory on an approved row. A version in an environment variable never satisfies a gate in production.
- **D-5. Approved rows are immutable.** A correction is a new version. An approved row's content columns can never change. Its only transition is to `withdrawn`, with a reason.
- **D-6. Acceptance stays keyed by version strings.** The existing acceptance columns (`foundation_terms_version`, `terms_version`, and so on on `individual_membership` and `individual_entitlement`) keep working unchanged. Uniqueness of (entity, document, version) in the register makes each recorded string resolve to exactly one row. A later migration may add row-id columns. That is not needed to be correct.

## 3. Schema sketch (illustrative, not a migration)

Two tables and one view. The names are proposals.

### 3.1 `plat_legal_entity`: who the documents belong to

| Column | Type | Rule |
|---|---|---|
| `code` | text PK | `competen_holdings`, `scholar_operator`. Matches `OperatingEntity` and the CHECK on `individual_entitlement.operating_entity` (370). |
| `label` | text not null | The descriptive name shown while the registered name is unconfirmed. |
| `registered_name` | text null | Null until confirmed. **Never guessed.** |
| `registration_number`, `jurisdiction` | text null | |
| `confirmed_by` | uuid → profiles | |
| `confirmed_at` | timestamptz | |
| CHECK | | `registered_name` is null, or both `confirmed_by` and `confirmed_at` are not null. |

This replaces `INDIVIDUAL_LEGAL_<ENTITY>_REGISTERED_NAME`. Confirming a name is also owner-only (D-3).

### 3.2 `plat_legal_document`: one row per document version

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `entity_code` | text not null → `plat_legal_entity` | |
| `product_line_code` | text not null → `plat_product_line` | `individual` for everything in scope today. |
| `document_kind` | text not null | CHECK in (`terms`, `privacy`). Extensible by migration only. |
| `version` | text not null | The identifier people accept. CHECK: no `staging-test-` or `dev-test-` prefix (see §6). |
| `url` | text not null | A permanent URL. CHECK: begins with `https://` or `/legal/`. |
| `text_sha256` | text not null | Hash of the published text (LEGAL-001 §9), so the URL's content can be checked later. |
| `effective_from` | timestamptz not null | When the version starts governing. May be in the future. |
| `status` | text not null default `draft` | CHECK in (`draft`, `approved`, `withdrawn`). |
| `legal_signoff_by` | text null | Counsel's name or firm. Counsel need not hold a Competen account. |
| `legal_signoff_at` | date null | |
| `approval_reference` | text null | The LEGAL-001 register entry, for example `REGISTER.md#REG-0003`. |
| `approved_by` | uuid null → profiles | |
| `approved_at` | timestamptz null | |
| `withdrawn_by` | uuid null → profiles | |
| `withdrawn_at` | timestamptz null | |
| `withdrawn_reason` | text null | |
| `created_by` | uuid → profiles | |
| `created_at` | timestamptz default now() | |

Constraints. These make a wrong state **unrepresentable**, per CLAUDE.md.
- `unique (entity_code, product_line_code, document_kind, version)`. This is a plain unique constraint, because house rules forbid partial unique indexes.
- An approved or withdrawn row must carry `legal_signoff_by`, `legal_signoff_at`, `approval_reference`, `approved_by` and `approved_at`, all not null. **This CHECK is the line between configuration and approval:** a row cannot be `approved` without its evidence.
- A withdrawn row must carry `withdrawn_by`, `withdrawn_at` and a `withdrawn_reason` of at least 8 characters.
- `approved_at <= effective_from` is NOT required: an owner may approve a version that took effect earlier, for example a backfill of a version already in force. The gate reads `effective_from`.

Trigger (`APPLY THIS FILE WHOLE` banner, per house rules):
- **UPDATE is allowed only for two transitions:**
  - `draft` → `draft` (any column; drafts are editable);
  - `draft` → `approved`, or `approved` → `withdrawn`, changing only the status and evidence columns.
- **Every other UPDATE raises.** That includes any change to `version`, `url`, `text_sha256`, `effective_from`, `entity_code`, `document_kind` or `product_line_code` once a row is past `draft`, and any transition out of `withdrawn`.
- **DELETE is allowed only for `draft` rows,** plus the established cascade allowance (`pg_trigger_depth() > 1`), so a parent row stays deletable. This is the known pattern for "the trail can never be removed by anybody".

RLS is enabled, matching every service-role-only `plat_` table. Reads and writes go through the service role behind the API checks in §4.

### 3.3 `plat_legal_document_current`: what is in force now (view, `security_invoker`)

For each (`entity_code`, `product_line_code`, `document_kind`): the `approved` row with the greatest `effective_from <= now()`. Withdrawn rows are excluded. `now()` is the database clock, the same rule as `individual_live_entitlement` (ADR-016): never compare an application clock with `effective_from`.

If an approved version is withdrawn, the view falls back to the previous approved version that is still effective. If none exists, the entity is **unpublished** and the experience closes, which is the current behaviour for an unset environment variable.

## 4. Authority and workflow

All of this reuses the existing HQ machinery: `hqApiGate` and `requireHqCapability` for access, `audit_log` for the trail, and an owner check identical to `/api/hq/appointments`' `OWNER_ONLY`.

| Act | Who | Where | Enforcement |
|---|---|---|---|
| Draft a version (create, edit, delete a draft) | Owner, or a holder of a new `hq.platform.legal.draft` capability, granted through the existing HQ catalogue to a platform-space position chosen by the owner. **Not** to any `individual_*` position. | `/super-admin/legal` (new route-intent entry, platform space) | Page: `requireHqCapability`. API: `hqApiGate`. Schema: drafts carry no approval evidence. |
| Approve | **Owner only** | Same screen | The API refuses non-owners with 403 `OWNER_ONLY` before reading the body. The schema CHECK refuses an approval without evidence. A foundation-harness check pins that no capability string opens approval. |
| Withdraw | **Owner only** | Same screen | As for approval, plus a mandatory reason. |
| Confirm a registered name | **Owner only** | Same screen | As above. |
| Read the current documents | The Individual gates (server) | `legal.ts` | Reads `plat_legal_document_current` through the service role. |

Every act writes an `audit_log` row (actor, row id, from and to status, `approval_reference`). The register row itself is the durable evidence. The audit row records the act.

Separation of duties: with one owner, the drafter and the approver may be the same person. Both are recorded, `created_by` and `approved_by`. Requiring different people is an owner decision (§9 Q3).

## 5. How the gates change (later implementation)

- **`entityLegal(entity)` becomes an async resolver** reading `plat_legal_entity` and `plat_legal_document_current` (scope `individual`). It keeps its return shape (`EntityLegal`), so `termsGate`, `acceptanceState`, the terms API and the experience layout keep their logic. They receive a resolved value instead of reading env.
  - It is resolved once per request. It would be cached alongside `individualShell` in `shell-context.ts`, the same `cache()` pattern, so a page and its layout cannot see two different registers.
- **"Published" tightens to approved and effective.** `publishedVersions` keeps returning `{ terms, privacy } | null`, now from approved rows only. A URL is guaranteed by the schema, so `consentDocuments`' `published` and `termsGate`'s `unpublished` mean the same thing for the first time.
- **A failed register read is unpublished, never published.** It fails closed, as `individualAppEnabled` does. The person sees "terms not published yet", and nothing on their account changes.
- **Re-acceptance:** a new approved version with a later `effective_from` changes `publishedVersions` at that moment, so `acceptanceState` returns `required` and the person is asked again (LEGAL-001 §6). The change is scheduled in data, not in a deploy.

## 6. Transition off `INDIVIDUAL_LEGAL_*`

| Phase | Production | Staging, Preview, Development |
|---|---|---|
| **0, today** | Env vars unset, `individual_app` OFF. Every experience shows "terms not published". | Staging uses `staging-test-*` env versions (launcher) so the gate can be exercised. |
| **1, migration applied** (per the four-state rule) | Register first. **Env never satisfies a production gate:** with the table present and no approved row, documents are unpublished; with the table absent (migration not applied), they are unpublished too. Fail closed. | Register first. If the register has no approved row, env versions are honoured **only** when they begin with `staging-test-` or `dev-test-` and the deployment is not production (`VERCEL_ENV !== "production"`). The UI labels these as test documents. |
| **2, after the first approved production rows** | Env reading is removed from `legal.ts`. The `INDIVIDUAL_LEGAL_*` variables are deleted from Vercel. | Test fixtures insert `draft` and `approved` register rows on staging, with an `approval_reference` of `staging-fixture`, instead of env. The §3.2 prefix CHECK and staging fixtures pull in opposite directions; how they coexist is §9 Q5. |

So no production state exists in which configuration alone opens a gate: phase 1 closes that path the moment the code ships, even before the register has any rows.

**Migration dependencies** (number to be assigned by the main session; 376 is IND-007's, and 377 may go to IND-007's effective-dates proposal):
- 281 (`plat_product_line`), `profiles`, and 370 (`OperatingEntity` values must match).
- It depends on no Individual table, so it can be applied before or after 374, 375 and 376.
- It is idempotent, ASCII-only, `notify pgrst` last, and carries the `APPLY THIS FILE WHOLE` banner (trigger).
- Applied and verified on staging before PR review. Production only with a separate owner GO and the OPS-001 safeguards.
- The code that reads it ships behind the existing default-OFF `individual_app` gate, and also fails closed when the table is absent.

## 7. Relationship to the LEGAL-001 register

`docs/legal/REGISTER.md` (LEGAL-001 §9) stays the human, reviewable record, with one row per version and counsel's notes. `plat_legal_document.approval_reference` points at its entry. The database row is what the gates enforce. The markdown entry is where the reasoning lives. The register's `SHA-256 of published text` column and `text_sha256` must agree. An implementation harness checks that every approved row's hash matches its REGISTER.md row.

## 8. Verification plan (for the implementation, not run now)

1. **Schema:**
   - an `approved` row without evidence is refused;
   - changing an approved row's `version`, `url`, `effective_from` or `text_sha256` is refused;
   - `withdrawn → approved` is refused;
   - deleting an approved row is refused, while a cascade from a parent row is still allowed;
   - a duplicate (entity, product line, document, version) is refused;
   - a `staging-test-` version is refused.
2. **The current view uses the database clock:**
   - a future `effective_from` is not current;
   - withdrawal falls back to the previous approved version;
   - no approved row means unpublished.
3. **Authority:**
   - a non-owner holding `hq.platform.legal.draft` can draft but gets 403 on approve and withdraw;
   - an Individual Product Administrator, or a holder of `hq.individual.config.manage`, gets 403 on every register route;
   - foundation-harness check: no capability string grants approval.
4. **Gates:**
   - production mode with env versions set and an empty register means `unpublished`;
   - an approved, effective pair means `required` and then `accepted` after acceptance;
   - a new approved version with a past `effective_from` means `required` again;
   - Scholar consent shows `awaiting_legal` until both entities have approved, effective pairs.
5. **Prove each control can fail:** plant the violation, watch it go red, restore.

## 9. Open questions for the owner

1. **Scope placement.** Platform-level with a `product_line_code` (recommended, D-2), or `individual_legal_document` until a second product needs it?
2. **Drafting right.** Create `hq.platform.legal.draft` for a platform-space position, or keep drafting owner-only too during the pilot?
3. **Separation of duties.** Must the approver differ from the drafter once there is more than one owner?
4. **Counsel evidence.** Is a name and date enough, or must the signed approval itself (a PDF) be stored? If stored, in which private bucket, and who may read it?
5. **Staging fixtures.** Allow `staging-test-` versions in the staging database (a CHECK that depends on the environment is not possible in SQL), or keep the env fallback on staging permanently and drop the prefix CHECK?
6. **Other products.** Should Practice's privacy notice (`practice_booking_*.privacy_notice`, migration 254) move to this register later? Out of scope here, but D-2 leaves room for it.

## 10. Out of scope

- Drafting legal text.
- Choosing entities or registered names.
- Implementing anything.
- Programme catalogues, clinical review engines, CPD frameworks and billing (CONFIG-002 boundary).
- Changing acceptance storage beyond D-6.
- Any production migration, deployment or activation.
