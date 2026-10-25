# COMPETEN-PROFESSIONAL-PASSPORT-01: Stage 7, the Lifelong Competen Passport (build record, P1–P6)

- **Authority:** owner GO "COMPETEN-PROFESSIONAL-PASSPORT-01, Stage 7". It authorises development and staging only. Production deployment, migrations, external sharing activation, public verification, clinical verification activation and assessor appointments each need a separate owner GO.
- **Coordinator ruling (25 Oct):** record-level selection is the **only** way a Professional link carries the person's own records. A link made before 540 carries nothing until it is re-selected. There is no "legacy" mode.
- **Branch:** `prof/passport-01-stage7`, cut from `origin/main` 0e5b2d61.
- **Migration:** 540, staging only.

## 1. Reused, not rebuilt

| Existing | Used for |
|---|---|
| 122 `passport_share_tokens` and `/verify/[token]` | The link, its expiry and its withdrawal. 540 hangs a view off the token. There is no second link, token or verification page. |
| `consent=false` refusal in `/verify` | A draft view. The link is minted closed and opens only on activation. |
| 453 (profile), 491 (learning), 520 (competencies) per-link selections | Read unchanged through their own loaders. Their tables are untouched. |
| 373 CPD and evidence, 375 Scholar Passport items, 427 Scholar Passport evaluations | The records a view can carry, by composite key `(id, user_id)`. Nothing is copied. |
| `loadIndividualPassport`, `loadProfessionalRecord`, `loadSharedProfile`, `loadSharedLearning`, `loadSharedCompetencies` | Composed by the one Passport read. No new credential or evidence engine. |
| Holdings Personal AI via `askProfessionalAssistant` | AI help drafting a view's summary. The gateway is unchanged. |
| WCE Individual policy (CONFIG-002) | 8 new policies. |

## 2. Delivered

| | |
|---|---|
| P1 | **The one Passport.** `src/lib/individual/passport-view.ts` is the single read for the owner's preview, the export and `/verify`. The owner's Passport page gains *At a glance*, *Qualifications and registrations*, *Competencies* (self-assessments shown as self-reported) and *Shared views*. |
| P2 | **Achievements.** Scholar study and evaluations, Professional qualifications, credentials and CPD, Competen Learning completions and 520 competency parts appear with their own class. Scholar history is untouched by Professional activation. |
| P3 | **Provenance.** Every item carries its source service, issuer, date, version, evidence reference, method and authority where they exist, its trust class, its validity and a fixed meaning sentence. |
| P4 | **Selective sharing.** A Passport view is chosen record by record, with a purpose, recipient label and summary. It is created as a draft, previewed exactly as the recipient will see it, then activated once. It is time-limited and can be withdrawn. Unchosen records never travel. |
| P5 | **Trust.** The labels are fixed in `passport-vocabulary.ts`: self-declared, document-supported, educational, assessed, independently verified, and expired, superseded or revoked. Only an organisation's verification or a current assessed outcome reads "independently verified". The legend states that a course completion or formative evaluation is not a verified clinical competence. A C5 decision is independently verified only when current, of class verified and at a level. The per-method outcome code is never read. |
| P6 | **Continuity.** The owner sees every view with its purpose, state, openings and refusals. The access log (540) records the result only, never recipient data. Export is a print of the same view, which says a printed copy cannot be recalled. |
| AI | Draft a summary only, gated by `passport_ai`. It returns text the person may paste. It never saves, shares, invents or changes a status. |

**Stable read for Stage 8 (Document Studio):** `loadPassportSelection(admin, userId, shareTokenId, ctx)` returns `{ meta, items, unreadable }`, with typed `PassportItem` and the label maps exported from `passport-view.ts`.

## 3. Configuration (no code, WCE)

`passport_sections` (order), `passport_shareable_kinds`, `passport_purposes`, `passport_recipient_label`, `passport_presentation`, `passport_validity_display`, `passport_export` and `passport_ai`. No profession, country or assessment method is hard-coded.

## 4. Migration 540 (staging only)

**File:** `supabase/migrations/540-individual-passport-share-views.sql`, **APPLY WHOLE** (plpgsql trigger functions).

**sha256 (LF):** `280fdd87a97c472e82bcfd7c92e18cf994bd4c636ae2ac57e0c12c94723c6c8f`. It is byte-identical with the staged file.

**Depends on:** 122, 373, 393, 375, 427 and 520. It is independent of 453, 491, 510/511 and 530, whose tables it does not touch.

**Adds:**
- `individual_passport_share_view`: one per link. It is fixed once activated and deleted only by cascade.
- `individual_passport_share_record`: exactly one record per row, by composite FK. It is unique per link and record. Updates are refused, and so are inserts once the view is active.
- `individual_passport_share_access`: append-only, recording the result only.
- Five `(id, user_id)` indexes, three of them repeated idempotently.

**Evidence files** (`docs/evidence/COMPETEN-PROFESSIONAL-PASSPORT-01/`):

| File | sha256 |
|---|---|
| ROLLBACK | `6e7271aa…0a5b` |
| VERIFY | `47684ae3…403d` |
| FINGERPRINT | `0a1ef0eb…75f5` |
| staging record | `540-staging-record.md` |

**Local rehearsal** (postgres:17):
- 28 probes, all as designed.
- Applied twice: idempotent.
- Rollback returned to PRE, and the re-apply matched.

**Staging** (coordinating session, guarded runner):

| Step | FINGERPRINT-540 | Items |
|---|---|---|
| PRE | `8c6b78937321b638649878355c23c1bb` | 17 |
| Apply #1 = apply #2 | `3789460a2feab750a6ecb457bae0a82d` | 78 |
| Rollback | = PRE | |
| Re-apply | = apply #1 (**current staging state**) | |

VERIFY-540 matched expectation after apply #2 and again after the re-apply.

**Production:** not applied. Production only on separate owner GO. Production holds 0 `passport_share_tokens` rows (coordinator, 25 Oct), so no existing link changes meaning.

**Application order:** after 520. Code that reads 540 fails closed when it is absent: a Professional link carries no own records.

## 5. Verification

| Check | Result |
|---|---|
| `tsc`, eslint | clean |
| vitest `src/lib/individual` | 545 / 545. The new `passport-view.test.ts` pins two things. A link with no view carries none of the person's CPD, and a view carries exactly the records ticked for it. It also pins the C5 rule: the class decides, never the configured outcome code. Planted removals of the filter and of the class test each turned it red. |
| `professional-passport-harness` (new, in the CI list) | **28 / 28**, including 19 planted reds |
| `individual-professional-harness` | 102 / 102. E5, M4, W1/W2 and D1 were moved to the record-level rule. E6 admits the C5 adapter only while it touches no table. Each change has a plant. |
| `professional-profile`, `individual-foundation`, `professional-competency` | all green |
| **Staging journey, GO §15 items 1–20** (`professional-passport-acceptance-harness`, `/verify` over HTTP) | **19 passed, 0 failed, 3 bounded (not faked)**, including cleanup. A planted defect (a link carrying all CPD) turned items 12, 13 and 18 red. The source was restored. |
| **Staging UI walk** (synthetic identity, deleted after) | See the steps below. |

**Staging UI walk steps:**
- The view was created in the form.
- The preview showed exactly the two ticked records.
- A draft refused an unauthenticated recipient.
- After Activate, the unauthenticated recipient saw only the chosen records, with trust, validity, meaning, purpose and recipient. The unticked record and the email address were absent.
- After Withdraw, the link was refused.
- The owner's history showed the openings and refusals.
- Two wording fixes followed: the refusal count, and the organisation-credentials count.

## 6. Bounded follow-ups

- **Item 4, Competen Learning.** Staging has Learning off, or publishes no external course, so the journey reports this item as bounded. The read is the existing 491 loader.
- **Item 6, Professional evaluations (Stage 6, 530, PR #127).** Not on this branch. Agreed with Stage 6: whichever branch merges second calls `saveShareEvaluations` inside `mintShare`, under its withdraw-on-failure block, and removes the route's post-mint call. `sharedEvaluationsFor` then joins the view as category "evaluation" with trust "educational". It shows no AI text, no notes and no private source names.
- **Item 7, independently verified competency (C5, 510/511).** The Studio is on main (#128) but not yet registered with the adapter. That is the Stage 5 C5 wiring, a separate branch. Until then the adapter answers "not provisioned". After wiring, only `verifiedNow` (current, class verified, at a level) reads "independently verified". Partial reads "assessed".
- **Scholar-only users** cannot create a view yet. Sharing is a Professional surface.
- **Institution records** are included as a whole (`include_institution`), not record by record.
