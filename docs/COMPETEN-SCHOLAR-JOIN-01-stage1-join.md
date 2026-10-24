# COMPETEN-SCHOLAR-JOIN-01: Stage 1 Join, J1–J3 (build record)

**Status:** development authorised; **production activation not authorised.** **Stage 1 closed for development, 2026-10-24 (§7).**

- Every join surface sits behind `individual_self_registration` (no row is written by any migration, so it is OFF) *and* the Individual release gate `individual_app`.
- **Owner ruling:** public self-registration stays disabled pending legal confirmation and separate production approval.

**Migrations:** 402 and 403 are this build's. Number 404 was allocated and is released unused.

**Stacking:** the branch `scholar/join-01` is stacked on `holdings/commercial-foundation`, because J3 uses the 399 interfaces (`plan_code`, the `signup` source).

## 1. The journey

Get Started (`/individual/join`) → Create Account → Verify Email → Educational Context and Activate Scholar (`/individual/join/start`, two short steps) → Welcome (**Upload my notes**) → terms (D2, as today) → Scholar upload.

- **J1, an existing account.**
  - A signed-in person with no Individual membership sees "Add Competen Scholar" on `/individual/access`.
  - A Professional member reaching `/individual/scholar` sees the same offer.
  - In both cases Scholar is activated on the account and membership the person already has: no new identity, no second membership.
  - The invitation flow (378) is untouched and does not read the join flag (foundation harness 14f).
- **J2, a new account.**
  - `POST /api/individual/join/register` creates the identity with Supabase auth sign-up and email confirmation.
  - It refuses a signed-in caller, and offers sign-in for an email that already has an account; GoTrue's no-identities answer is treated the same way. A second account is never created.
  - The new identity's `profiles.role` is cleared to null (no estate role), as Practice signup and Individual invitations already do.
  - Nothing Individual is created until the person returns verified.
- **J3, subscription-ready entitlement.**
  - Activation writes through `grants.ts`, which is still the one writer of gate-3 rows.
  - The membership gets source `signup` when none exists. The Scholar period gets source `signup`, with an optional `plan_code` from 399.
  - No payment provider is involved, and identity is independent of payment. A later paid period appends (P1 Commercial).
  - Scholar and Professional stay independent.

## 2. Owner rulings, and how each is met

| Ruling | Implementation | Pinned by |
|---|---|---|
| **AGE**: 18+, an explicit declaration with timestamp and eligibility-policy version; self-declaration, not verified age; no documents, no external service | Migration 403 adds `individual_age_declaration`: `declared_at` from the database clock, the exact statement, `policy_version` and `source`. It is append-only. A self-activated Scholar period names its declaration (`adult_declaration_id`), and `adult_confirmed_by` stays null. A new CHECK makes HQ-confirmed and self-declared exclusive. The 370 D8 CHECK is unchanged. The API refuses a missing declaration or a stale policy version. | unit tests; foundation 14d; staging A2, A5, A6, H3 |
| **Self-registration DISABLED** pending legal and production approval | `individual_self_registration`, with no row. The join pages and routes return 404 while it is off. | foundation 14a, 14b; staging F0, F1 |
| **EDUCATIONAL CONTEXT**: current *and* historical; a change must not overwrite the context of earlier learning | Migration 402 keeps `individual_scholar_learner` as the current pointer, adding level and institution (code plus the label shown). Its trigger copies every change into the append-only `individual_scholar_learner_context` as a period on the database clock. A record's context is the period containing its `created_at` (`contextAt`), so learning tables need no new column. | foundation 14e; unit tests; staging A7, H1, H2 |
| **CONFIGURATION**: reuse CONFIG-002/WCE, with no-code admin for programmes, levels, institutions and fields; no parallel engine | Four policies in the existing Individual catalogue, each with a control on `/super-admin/individual/configuration` behind `hq.individual.config.manage`, versioned, audited and rolled back by WCE: `scholar_onboarding_programmes` (which 387 programme rows are offered), `scholar_programme_levels` (per programme), `scholar_institutions`, `scholar_onboarding_fields`. Programme and level names are checked against active programme rows on write and on every read. | unit tests; config harness 36/36 |
| **IMPLEMENTATION**: existing Holdings identity, entitlement, governance and commercial infrastructure | Supabase auth with one identity; gate-3 rows through `grants.ts`; WCE for configuration; 399 plan and source interfaces; the D2 terms gate as today. | — |

## 3. Migrations

| File | sha256 (CRLF, applied) | sha256 (LF, git blob) | Depends on |
|---|---|---|---|
| `402-individual-scholar-educational-context-history.sql` (APPLY WHOLE) | `f233ca1ee7dba9272da68ca19c948bf65225b70ad31c8e60fba606a1cea62d0d` | `ea94c2774148dda4ebed343fd3dd5e67e7f9071eb39aa42b7592a1a619374953` | 387 |
| `403-individual-adult-age-declaration.sql` (APPLY WHOLE) | `2d80cbf8eb245aaade93f72e772444d975b82339d405b3fee7b52d225dc16814` | `92c356409a24535fbff1165ef27d2e1043c21172b84b0bb2266125917c79e82b` | 370 |

**Application order:** 402, then 403. They are independent of each other. Both pass `migration-house-rules` with ALL CLEAR; the only warnings are the acknowledgements of the APPLY WHOLE banner.

**Staging state before application** (read-only probe, 2026-10-24):
- the new columns and tables are absent;
- 0 learners;
- one active programme, `nursing-ug-diploma`;
- `individual_app` is ON;
- `individual_self_registration` and `individual_commerce` are absent.

**Staging application** (main session, 2026-10-24, under the owner authorisation for staging 396–401 extended to 402–404):
- Each file was applied twice; all runs reported ok, and the checksums are the CRLF values above.
- **Medium-risk rehearsal.** These files add plpgsql triggers, one of them on an existing table, and 403 alters `individual_entitlement`. Fingerprint over the `individual_%` tables:

| State | Tables | Fingerprint |
|---|---|---|
| PRE | 28 | `809352989ccc` |
| F1, after applying | 30 | `f9243b89796d` |

- **Rollback rehearsal.**
  - `docs/evidence/COMPETEN-SCHOLAR-JOIN-01/ROLLBACK-403.sql` (CRLF sha256 `036d7bd415168b95af81ba75abea80af4efe429e5a9556bdcd1a13a4578252a4`) ran first. Its self-declared-periods guard read 0.
  - `ROLLBACK-402.sql` (`d116e8eb233e8aa00bfd962352b0aa282b5d41b294360c3bc2e7b5296f03ff49`) ran second.
  - After both: **F2 = 28 tables, `809352989ccc`, equal to PRE.**
- **Re-application:** each file applied twice again, all ok. **F3 = 30 tables, `f9243b89796d`, equal to F1.**

**Production:** not applied. With the flag off, code on `main` behaves as follows:
- **Join routes:** they read nothing from 402 or 403.
- **Programme route:**
  - it writes level and institution only when one is chosen;
  - when a programme alone is chosen, it falls back to the 387 write, so it works without 402.
- **Commerce:** its Scholar carry-forward reads `adult_declaration_id`. Commerce is dark, and it needs 399 and 403 before activation.

### Rollback

The rollback files are `docs/evidence/COMPETEN-SCHOLAR-JOIN-01/ROLLBACK-403.sql`, then `ROLLBACK-402.sql`. Both are idempotent and use `IF EXISTS` throughout, and both were rehearsed on staging (see above).

The 403 rollback should be refused, and that refusal is correct, if a self-declared Scholar period still exists: it is evidence behind live access. End the period first.

## 4. Verification

- **Unit tests:** `join.test.ts` covers:
  - the gate;
  - registration and one identity;
  - the declaration;
  - `selfActivateScholar`;
  - the order of `activateScholar`;
  - the policy kinds;
  - the join options;
  - `contextAt`.

  The Individual and Practice suites pass 466/466.
- **Foundation harness: 73/73.** Group 14 is new:
  - 14a dark by default;
  - 14b every entry point checks the flag first;
  - 14c one identity;
  - 14d the declared basis;
  - 14e history is the database's;
  - 14f invitations are independent.

  These checks were updated with stated reasons: 1d (the join's role clear), 2a (the join's writes), 5a (the join routes serve people with no membership yet), 5c (`join.ts` may reach only `selfActivateScholar`), and 6a (`auth.signUp` only in the gated join).
- **Controls proven red, then restored:** an ungated register route (14b), an HQ confirmer on a self-declared period (14d), and the application writing the history (14e).
- **Config harness:** 36/36.
- **`next build`:** see the PR for the merged-tree result.
- **Staging journey over HTTP:** `scripts/scholar-join-harness.ts`, registered as privileged, run against a staging-pointed dev server on 2026-10-24. Result: **28 pass / 0 fail / 2 PEND.**
  - **F0:** with the flag off, the join answers 404.
  - **R1–R4:** registration works, and one identity is kept:
    - a second sign-up is refused, with sign-in offered;
    - the new identity has no estate role;
    - nothing Individual is created before verification.
  - **V1–V3:** checked on a genuinely unconfirmed identity:
    - sign-in is refused before confirmation;
    - the confirmation token confirms the address;
    - after confirmation the person signs in and reaches the context step.
  - **A1–A7:** activation:
    - the governed programme, level and institution are offered;
    - a missing declaration, a stale policy version and a missing level are refused;
    - the refusals record nothing;
    - activation writes the membership (`signup`), a Scholar period resting on the declaration with no HQ confirmer, a declaration with its time, words, version and source, and the pointer plus its first period with labels.
  - **W1–W3:** the welcome's primary action is "Upload my notes"; the terms gate (D2) appears first; Upload is reachable after acceptance.
  - **H1–H3:** a later change of level closes period 1, which still says Year 1, and opens period 2. The history refuses a rewrite, and the declaration refuses an edit.
  - **E1–E3, J1:** a Professional member is offered Scholar and activates it on the same `hq_pilot_grant` membership. Both experiences are live, the declaration source is `self_activation`, and a repeat activation is reported rather than duplicated.
  - **F1–F2:** after switching off again, the join answers 404 and existing holders are unaffected.
  - **Z1:** fixtures are deleted, and the flag and both policy rows are restored exactly.
  - **The two PENDs:**
    - **V4:** staging auth has `mailer_autoconfirm: true`, unlike production, so the confirm-ON registration answer (`VERIFY_EMAIL`) is proved by unit test and by V1–V3, not by a sign-up on staging.
    - **V5:** delivery to a real mailbox is not proved, because fixtures use `@competen.test`.
- **Mobile check:** `/individual/join` at 375 px renders as one column, with full-width 44 px controls and the sign-in path visible. The flag was switched on for the check and removed after.

## 5. Readiness

| Area | Existing (before JOIN-01) | Missing (before) | Action taken / state now |
|---|---|---|---|
| **Identity** | One Supabase identity per person. Invitations (378) create identities without a role. | No self-service identity creation for Individual. | Registration through Supabase sign-up. A signed-in caller or an existing email is refused, with sign-in offered. The estate role is cleared to null. **Done; staging R1–R4.** |
| **Registration** | Practice self-serve signup (the precedent); the estate `/signup` is closed. | No Individual or Scholar registration. | `/individual/join` and `POST /api/individual/join/register`, behind `individual_self_registration` (default OFF). **Done, dark.** |
| **Email verification** | Supabase confirm-email is ON in production; `/auth/callback` exchanges the code. | The join never relied on verification before. | Verification is required before anything Individual is created: the start page and the activate route refuse an unconfirmed email, and the confirmation returns to `/individual/join/start`. **Done; staging V1–V3. PEND:** confirm-ON sign-up on a confirm-ON project (staging auto-confirms), and real-mailbox delivery. |
| **Educational profile** | 387 programmes and a learner pointer, programme only, overwritten on change. | Level, institution and history. | 402 adds level and institution with copied labels, plus a trigger-written, append-only history; records keep their context by time. The programme route changes context later, with history. **Done; staging A7, H1, H2.** |
| **Entitlements** | `grants.ts` as the one writer; 399 plan and source interfaces (merged in #48). | Self-activation, and a self-declared 18+ basis. | `selfActivateScholar`: membership `signup`, a Scholar period `signup` resting on the 403 declaration, optional `plan_code`, no payment provider. Scholar and Professional stay independent. **Done; staging A5, E2, E3.** |
| **Terms and privacy** | The D2 terms gate with versions; Scholar AI consent is separate; uploads are private. | — | Unchanged and reused. The gate appears on first entry to Scholar. **Done; staging W2, W3.** |
| **Welcome** | `/individual/welcome` with a primary-experience choice. | An upload-first action. | When the welcome continues into Scholar, its primary action is "Upload my notes", leading to `/individual/scholar/study#upload`. **Done; staging W1.** |
| **Commercial integration** | P1 Commercial (#48), dark. | — | Self-activation writes the 399 `source` and `plan_code`. Commerce carries a self-declared basis forward as recorded, never upgrading it. **Done.** |
| **No-code configuration** | CONFIG-002/WCE Individual policy page. | Programmes offered, levels, institutions and onboarding fields. | Four new policies on the existing page, versioned, audited and rolled back by WCE, with codes checked against active programme rows. No new engine. **Done; config harness 41/41; staging A1 reads them.** Programmes themselves: see §6. |

**Answers to the five questions:**

1. **Is it functional?** Yes. The full journey runs end to end on staging: Get Started → Create Account → Verify → Context → Activate → Welcome → Terms → Upload, plus a later change of context and the J1 path for an existing member.
2. **Is it implemented?** Yes: J1, J2 and J3, migrations 402 and 403, four governed policies, harness group 14, a staging journey harness, unit tests, and rollbacks rehearsed on staging.
3. **Are there blockers?** None in the code. Before production activation, the owner and legal need to decide the items below.
4. **Does it work on staging?** Yes: 32/32 including programme administration (§6), with 2 PENDs (the confirm-email setting and mailbox delivery). 402 and 403 are applied and rehearsed.
5. **Is it ready for acceptance?** Yes for staging acceptance. Production is not authorised and depends on the list below.

### Production activation dependencies (exact)

1. **Migrations.** A separate owner GO for each of 402 and 403, applied by the owner in the SQL editor with:
   - a recorded recovery reference (COMPETEN-OPS-001);
   - the rehearsed rollbacks;
   - post-application verification.

   P1 Commercial migrations 399 and 400 also need production first, for the `plan_code` column that `selfActivateScholar` may name and that commerce reads. Self-activation itself writes no `plan_code` today, so it needs 403, not 399.
2. **Legal confirmation** of self-declared 18+ in place of HQ confirmation (the evidence-model change), and of the eligibility statement and its version (`scholar-eligibility-18plus-2026-10`).
3. **Owner approval to open self-registration:** write `individual_self_registration = true` in production. This is a new public account-creation surface; CLAUDE.md requires an owner decision.
4. **`individual_app` ON in production** (Individual activation), a separate owner GO.
5. **Real-mailbox proof of the confirmation email**, and that the production auth redirect allowlist includes `/auth/callback?next=/individual/join/start`. If it does not, GoTrue falls back to the Site URL and the person signs in manually; the flow still works, but it is a worse experience.
6. **Scholar legal documents published**, so the D2 gate has versions in production (the staging test versions are not documents).
7. **HQ configuration in production:** programmes and their catalogues on the Scholar programmes page; programmes offered, levels and institutions on the Individual policy page.

### Remaining material risks

- **Evidence model.** Self-declared age is not verified age. It is recorded and exclusive of HQ confirmation, but it is the person's word. The owner and legal must accept this.
- **Staging auth auto-confirms email,** unlike production, so a confirm-ON sign-up has not been exercised end to end on a live project.
- **A self-declared membership is a new route into Individual** alongside invitations and, later, purchase. It is dark today; opening it is decision 3 above.

## 6. Programme administration (Stage 1 acceptance: remaining development)

Owner acceptance, 2026-10-24: Stage 1 is accepted for development and staging. The remaining development was no-code programme administration: create, edit, retire and govern programmes, including profession, levels and catalogue relationships, with no SQL and no parallel engine.

**Built:**

| Piece | What it does |
|---|---|
| `/super-admin/individual/programmes` | HQ page, behind `hq.individual.config.manage`, the right that governs the Individual policy (migration 376). It lists every programme (active or deactivated) with profession, country, qualification and its catalogue links by layer, and has create and edit forms. It links to and from the Individual policy page. Its route-map entry is in `spaces.ts`. |
| `GET/POST /api/hq/individual/programmes` | Behind the same right. It works whether or not Individual is switched on, like the policy route, so HQ can prepare programmes before activation. **Every save is audited** in `audit_log` with the programme as it was before and after (`individual_scholar_programme_created`, `_changed` or `_retired`). |
| `src/lib/individual/programme-admin.ts` | The one writer of `individual_scholar_programme` and `individual_scholar_programme_framework`. Validation mirrors every CHECK in 387 and 389: code shape, label, profession, two-letter country, qualification, the five layers from S1 `COMPETENCY_LAYERS`, and no duplicate links. A catalogue link may name only a **shared, active, published** framework, checked on write and again by Scholar on every read. Links are replaced exactly. **A programme is never deleted:** it is retired by deactivation, its code is fixed, and learners and their 402 history keep its name. |

**Reuse, not a new engine:**
- **Authority:** the existing HQ capability and gate.
- **Audit:** `audit_log` with before and after values.
- **Levels:** stay in the versioned, rolled-back WCE Individual policy (`scholar_programme_levels`), next to programmes offered, institutions and fields.
- **Programmes:** they are **rows**, because the competency mapping and every learner keep a typed foreign key to the code. A programme is therefore administered as governed data with an audited before and after, not as a WCE setting.

**Verification:**
- **Unit tests:** `programme-admin.test.ts` (6).
- **Foundation harness: 74/74.**
  - New check 14g: only the HQ route saves, both handlers check the capability, every save is audited, programmes are never deleted, and links go to shared published catalogues only.
  - 2a names the writer, with its reason.
  - Proven red, then restored: a planted programme delete, and an ungated GET.
- **Config harness 41/41.** G5 knows the new door.
- **scholar-learning 110/110.** K1 still holds: the programme tables remain read-only for Scholar code. That is why the writer sits outside the Scholar store.
- **Staging, `scholar-join-harness` section G (32/32 overall):**
  - G1: create a programme with its catalogue link;
  - G2: a new active programme is offered at join;
  - G3: a link to a catalogue that is not shared and published is refused, and nothing changes;
  - G4: rename and drop the link, then retire it: the row is kept and is no longer offered.
- **Not covered here:** the HQ page was not rendered with a signed-in administrator on staging; `next build` compiles it. **Closed by §7.1.**

## 7. Stage 1 close-out (final development acceptance, 2026-10-24)

**Stage 1 is closed for development.** Production activation is still not authorised. Everything below ran on staging (`ezhvpgtcqcdsgylrxgdb`), from `main` at 852b427, with a dev server pointed at staging.

### 7.1 Authenticated HQ walkthrough

This closes the gap §6 left open ("the HQ page was not rendered with a signed-in administrator on staging").

**Fixtures.**
- **Setup:** an uncommitted fixture script (sha256 `42120d0e…610b`), run by the owner because its appointment grant is an owner action.
- **Holder:** a synthetic account (`harness-hqwalk-holder@competen.test`) with active `platform_membership`, appointed Individual Product Administrator on the HQ platform office. That position resolves to `hq.individual.config.manage`.
- **Non-holder:** a synthetic account (`harness-hqwalk-nonholder@competen.test`) with membership and no appointment.
- **Snapshot:** setup recorded the Individual policy partition and refused to run while any draft was pending.

**Steps.** The screenshots are in `docs/evidence/COMPETEN-SCHOLAR-JOIN-01/`.

| # | Step (as the holder, unless stated) | Result | Evidence |
|---|---|---|---|
| W1 | Sign in, then open `/super-admin/individual/programmes`. | The page renders. The rail names the person "Individual Product Administrator". | 01 |
| W2 | Create `zz-walkthrough-nurs` (Nursing, UG) linked to Competen Foundational, layer foundational. | "Programme created." It is listed Active with its catalogue. | 02, 03 |
| W3 | Edit it: rename it, add the qualification "diploma", and add Nursing: Respiratory Care at layer profession. | Persisted after a reload: the new name, "Diploma", and both catalogues by layer. | 04 |
| W4 | On the Individual policy page, offer Nursing (Uganda) only (the zz programme unticked), give the zz programme the levels Year 1 to 3, and name one synthetic institution. Run the partition check, then **"Publish 3 changes"** (exactly the three). | Published 11:36:30 UTC. The policy page shows the levels Effective now, Source Published. The learner join options (`loadJoinOptions`, the join page's own reader) **leave out** the zz programme and **offer** the institution. | 05, 06, 07 |
| W5 | Re-offer the zz programme. Run the partition check, then **"Publish 1 change"**. | Published 11:37:59 UTC. The join options now offer the zz programme **with Year 1, Year 2 and Year 3**. | — |
| W6 | Retire it with **Deactivate**. The confirmation reads: "Deactivate ZZ Walkthrough Nursing (synthetic, edited)? Nobody new can choose it. Students who chose it keep its name." | Shown as Deactivated. The row is kept (`is_active` false). The join options **no longer offer it, although the offered policy still names it.** | 08 |
| W7 | Sign in as the **non-holder**. | Both HQ pages are locked: "open to platform owners and to people holding an HQ position". Both writes return **403** "You do not hold a position that opens this part of Competen HQ": `POST /api/hq/individual/programmes` (a create) and `POST /api/hq/individual/config` (a publish). Nothing was created. | 09 |

**Restore.** The teardown restored exactly the three paths the walkthrough wrote:
- `scholar_onboarding_programmes`;
- `scholar_programme_levels`;
- `scholar_institutions`.

Before the teardown wrote anything, it confirmed that every other path in the partition was unchanged since the snapshot. Every check printed true. It then removed the zz programme and both fixtures. The learner join options are back to the pre-walkthrough state: Nursing (Uganda) with no levels, and no institutions. IND-007's `professional_catalogues` (published 11:29:54 UTC, before setup) was in the snapshot and was not touched.

**History retained by design.** The walkthrough leaves the following on staging:
- two `workspace_config_versions` rows published by "Harness HQ walkthrough holder" (`0357b656…`, `e9602ae2…`);
- six `workspace_config_audit` rows (four drafts, two publishes);
- the programme's `audit_log` rows (created, changed, retired).

The restore was a direct write of the three override rows, not a publish. The latest version snapshot (`e9602ae2…`) therefore records the walkthrough values, while the live published values are the restored defaults. The runtime reads the override rows, so behaviour follows the restored values.

**Method notes.**
- The Deactivate confirmation was answered by the automation in the page, and its text was captured.
- After "Create programme", the list showed the new row only on reload. The editor calls `router.refresh()`, so this was dev-server compile latency, not a defect.

### 7.2 A learner with no catalogue

The question: can an entitled learner whose programme has **no catalogue** still upload and learn, with the mapping absent and labelled rather than blocking?

**Learner with no programme: proved on staging.** A variant of `scholar-upload-harness` was run (uncommitted). The only change: the fixture learner chooses no programme, so there is no catalogue, and M1 is replaced by NC1. Result: **15/15 GREEN**:
- W1, W2, U1 to U4, T1, P1 and P2: upload, refusals, plain text, sections and the original, all as normal.
- **NC1:** topic finding completes every section with **0 proposals and 0 mapping rows**. The material page labels the mapping as absent: "Choose your programme in My Learning to also see which competencies your notes support."
- **L1:** a cited explanation and practice questions from the notes.
- I1, E1 and Z1: isolation, erasure and cleanup.

**The control fails when it should.** In the same run with the catalogue-linked programme chosen, NC1 goes **RED**: 8 proposals, 8 mapping rows, no absent label.

**Programme chosen, but zero catalogue links (or only links not on the Scholar allowlist): residual R1.** Staging has no such programme, so this was established by reading the code, not over HTTP. Nothing is blocked:
- upload and learn do not read the programme;
- analysis runs with an empty candidate list and finds concepts only.

But the material page then says Scholar "suggests which competencies of {programme} it supports", and **no absent label** is shown. The mapping is absent and unlabelled.

### 7.3 Residual issues

| # | Issue | Disposition |
|---|---|---|
| **R1** | A programme with no usable catalogue claims competency suggestions on the material page and shows no absent label (§7.2). | Accepted by the owner as a genuine residual. To be fixed in **COMPETEN-SCHOLAR-UPLOAD-01 U3/U5** ("missing or uncertain competency mappings must not prevent learning"), pinned by an HTTP check against a catalogue-less `zz-` programme. |

No other defect was found in the walkthrough.

### 7.4 Retained

- **Production dependencies:** all of §5 "Production activation dependencies" stands unchanged. Migrations 402 and 403 are not in production. `individual_self_registration` and `individual_app` stay OFF in production. Each needs a separate owner GO.
- **The two email-verification PENDs stay open:**
  - **V4:** a confirm-ON sign-up on a confirm-ON project. Staging auth auto-confirms.
  - **V5:** delivery of the confirmation email to a real mailbox.

  Both are production-readiness checks, not development work.
