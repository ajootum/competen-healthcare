# CPR-IDENT-SURVEY-001 — The professional record, staff, and the practitioner number

Read-only survey. 2026-08-08. Nothing was changed.

Scope was narrowed mid-survey by the user's correction: **Competen Practice is for the independent
practitioner** — one practitioner, one practice, many locations. The passport arc, the practice
identifier, and the tenant-routing reversal are dropped. Four questions remain.

Sections are marked **CODE** (what the code does), **DOCS** (what a document says), or
**RECOMMENDATION**. They are never mixed.

---

## 0. Corrections to the brief, up front

Seven of these. Each is evidence, not opinion.

| # | The brief said | **CODE / live data says** |
|---|---|---|
| 0.1 | "1 workspace with real data (Trial)" | **2 workspaces.** `Trial` (`b7c5dbc1…`, ACTIVE, UG, created 2026-08-02) and `Dr Lifecycle` (`89950fe4…`, ACTIVE, created 2026-08-07). Probed live. |
| 0.2 | `practice_workspace` has no number and no slug — "this is the gap" | Correct as fact, **but it is not a gap in this product.** See §4. |
| 0.3 | "`issueIdentity` is keyed on `userId`, so a second practice yields no second number" | Correct, and it is deliberate: `practice_practitioner_identity.user_id uuid not null unique` (`supabase/migrations/218-practitioner-identity-service.sql:50`), with `primary_workspace_id … on delete set null` (218:87) so the identity survives its workspace. The migration header (218:5-15) states exactly this. |
| 0.4 | "43 identities, 1 claimed handle" | **Confirmed.** 43 rows; statuses `created: 42, active: 1`. One handle: `elisham1` → `CP-000102-9`, "Mullen Elisha", `discovery = link_only`, `status = active`, `primary_workspace_id = b7c5dbc1…` (Trial). |
| 0.5 | Portfolio tables "die with the practice" | True but **understated, and the delete is not the live failure.** Nothing in `src/app/**` or `src/lib/**` deletes a `practice_workspace` row — the only deletes are `scripts/_cleanup.ts:142` and `scripts/practice-privacy-harness.ts:271`. `src/lib/practice/lifecycle.ts:37-42` states "NOTHING IS EVER DELETED". **The record is lost without any delete at all — see §1.2. That is worse, because it is reachable today.** |
| 0.6 | (memory) "`practice_public_signup` is ON (live)" | **It is OFF.** Live `practice_platform_flags`: `practice_sign_in = true`, `practice_pilot_provisioning = true`, `practice_public_signup = false`. |
| 0.7 | "`practice_portfolio_entry.detail` is free text and can carry patient-identifying content" | Correct, and it is the only free-text field that would travel. But `title` (3-300 chars) and `organisation` are the same risk and were not named. See §2. |

**On the passport, one paragraph, as asked.** The user is right and the earlier framing was wrong.
`src/app/practice/**` and `src/lib/practice/**` contain **zero** reads or writes against any
passport table. Every occurrence of the string "passport" in those trees is a *patient identity
document type* — e.g. `src/lib/practice/facilities.ts:46` (`{ key: "passport", label: "Passport" }`),
`src/lib/practice/patient-workspace-constants.ts:128,140`,
`src/app/practice/(shell)/patients/UniversalSearch.tsx:22,134,257`. The competency passport is a
separate estate (`employment_records`, migration 027; `passport_share_tokens`, migration 122;
`/dashboard/passport`, `/verify/[token]`), scoped on `nurse_id` + `hospital_id`, with no FK, no
join and no shared code path to any `practice_*` table. **DOCS:** `COMPETEN-STRATEGY-001` §9 lists
"Is Practice the same brand as the passport, or deliberately separate?" as an **open question**, and
§10 says "Not a build authorisation. Nothing here starts." The strategy doc describes intent; it has
not been built as a link, and this survey does not propose one.

---

## 1. The professional record — the one real finding

### 1.1 CODE — what is there

`supabase/migrations/217-practice-professional-portfolio.sql` creates two tables, **both**
workspace-cascading:

```
practice_practitioner_profile        217:50-74
  workspace_id uuid not null references practice_workspace(id) on delete cascade   217:52
  user_id uuid not null                                                            217:53
  full_name, profession, specialty, sub_specialty,
  registration_number, registration_body, registration_expires_on,
  practising_since, summary
  unique (workspace_id, user_id)                                                   217:76-77

practice_portfolio_entry             217:84-109
  workspace_id uuid not null references practice_workspace(id) on delete cascade   217:86
  user_id uuid not null                                                            217:88
  kind in (qualification|certification|publication|achievement|
           teaching|leadership|research|other)                                     217:90-92
  title (3-300), detail, organisation, occurred_on, expires_on, reference
```

Live: **both tables hold 0 rows.** Probed 2026-08-08. This is free to change.

**Nothing in the codebase writes to either table except the portfolio engine itself.** The only
insert paths are `saveProfile` (`src/lib/practice/portfolio.ts:134-135`) and `addEntry`
(`portfolio.ts:165-171`). Both stamp `workspace_id: ctx.workspaceId`. No clinical engine
auto-populates a portfolio entry — every row is typed by a human. That matters for §2.

**⚠ There is already a second store, and it is not the passport.** `practice_practitioner_identity`
(migration 218) — which *is* person-scoped, `user_id unique`, and survives workspace deletion — already
holds:

| `practice_practitioner_identity` (person, migration 218) | `practice_practitioner_profile` (workspace, migration 217) |
|---|---|
| `display_name` (218:62) | `full_name` |
| `specialties` (218:66) | `specialty`, `sub_specialty` |
| `qualifications` (218:65) | — |
| `biography` (218:67) | `summary` |
| `languages`, `consultation_types` (218:68-69) | — |
| `licence_verified_at/by/reference` (218:81-83) | — |
| — | `profession` |
| — | `registration_number`, `registration_body`, `registration_expires_on` |
| — | `practising_since` |

Two tables describe one person's professional identity. One of them is correctly person-scoped and
already carries a permanent number and a handle; the other is workspace-scoped and cascades. The
codebase's own warning about building a second store applies here — it just already happened,
between migrations 217 and 218, in that order. Live proof of the duplication: the Trial owner's
identity row holds `qualifications: "BSN"`, `specialties: "Pediatric Critical Care"`,
`languages: "English"` — and `practice_practitioner_profile` holds 0 rows, so the *practice-scoped*
copy of the same facts has never been filled in.

### 1.2 CODE — the live failure, which needs no DELETE

The brief framed this as a cascade risk. The reachable failure is worse and needs nothing destructive:

1. `src/lib/practice/access.ts:84` — `resolveWorkspaceContext` returns `WORKSPACE_INACTIVE` unless the
   workspace status is `ACTIVE`, `ONBOARDING` or `PROVISIONING`. An **ARCHIVED, SUSPENDED, CLOSING or
   CLOSED** practice cannot be entered at all.
2. `src/lib/practice/portfolio.ts:235-258` — `buildPortfolio` filters every read on
   `.eq("workspace_id", ctx.workspaceId)`, and `getProfile` (`portfolio.ts:95-97`) does the same.
3. `exportPortfolio` (`portfolio.ts:345-348`) calls `buildPortfolio` with the same context, so **the
   escape hatch also requires an enterable workspace.**
4. `src/app/api/v1/practice/provisioning/individual/route.ts:75-77` — the one-practice-per-person rule
   excludes `CLOSED` and `FAILED`. A practitioner whose practice is CLOSED **may provision a second
   one**, and it gets a fresh `workspace_id`.

So: retire, archive, reopen elsewhere — and the qualifications, the registration number, the
publications and the fellowships are still sitting in the table, **unreadable by the only person
entitled to them, forever.** No row was deleted. The record simply became unreachable.

5. And the last resort does not cover it either. `EXPORT_SECTIONS` in
   `src/lib/practice/lifecycle.ts:591-610` lists **18 tables** — patients, appointments, encounters,
   problems, diagnoses, treatments, procedures, follow-ups, documents, locations, configuration,
   availability, booking rules, memberships, lifecycle transitions. It contains **neither
   `practice_practitioner_profile` nor `practice_portfolio_entry`.** The whole-practice export omits
   the practitioner's own professional record.

### 1.3 ⚠ What a half-built version destroys, concretely

This is the specific harm, because it is not hypothetical for this product:

- **The failure is silent and the discovery is late.** A practitioner assembles a portfolio over three
  years — a fellowship, four publications, a BLS certificate with an expiry, a committee chairmanship.
  They archive the practice on retiring, or reopen after moving cities. The new practice's portfolio
  page renders **empty and correct-looking**: 0 entries, a coverage statement that honestly says
  "nothing has been recorded", no error. Nothing tells them anything was lost. They find out at
  revalidation, when an appraiser asks for the evidence.
- **It cannot be reconstructed.** `reference` held a DOI, a certificate number, an award citation.
  There is no file storage in this product (`portfolio.ts:76-79`), so the practitioner's own copy of
  those references *was* the record. A partially-portable version — one that carries the declared
  entries but silently drops the registration number and `practising_since`, or vice versa — is worse
  than none, because the practitioner has no way to see which half survived.
- **The honesty doctrine makes it sharper, not softer.** `portfolio.ts:59-90` (`PORTFOLIO_LIMITS`) is
  an unusually careful piece of work about not overstating. A product that is that scrupulous about
  what a figure means, and then loses the whole document on a lifecycle transition, fails at a lower
  level than the one it is being careful about.
- **The clock is running.** 0 rows today. Every day the product is live is a day this stops being free.

### 1.4 RECOMMENDATION — the minimum correct scoping

Not "move everything to person". Three scopes, and the boundary is *what the practice is controller
of*, not what is convenient.

**(a) `practice_portfolio_entry` → person-scoped.** Drop the workspace cascade. Key on `user_id`.
Keep `workspace_id` as a **nullable provenance pointer with `on delete set null`** — so "where was
this entered" stays answerable for a data-protection question without the entry dying with the
answer. This is the exact pattern migration 218 already uses for
`primary_workspace_id … on delete set null` (218:87), so it is this codebase's own established shape,
not a new one. Nothing in a `qualification`, `publication` or `fellowship` row is the practice's
property: it describes the person, and the practice merely hosted the typing.

**(b) The self-declared professional facts → fold into `practice_practitioner_identity`.** Add
`profession`, `registration_number`, `registration_body`, `registration_expires_on`,
`practising_since` to the identity table (which is already `user_id unique` and already survives
workspace deletion), and retire `practice_practitioner_profile` rather than re-keying it. Re-keying
leaves two person-scoped tables describing one person, which is the duplication in §1.1 preserved
under a new name. **⚠ Do not skip the labelling:** migration 217's header and `portfolio.ts:20-23`
insist these are `self_declared` and that nothing verifies them, while
`practice_practitioner_identity` carries `licence_verified_at/by/reference` (218:81-83) — a
*verified* concept. Putting an unverified typed registration number in the same table as a verified
licence state, without the provenance distinction surviving the move, would manufacture exactly the
assurance both migrations refuse to manufacture.

**(c) Everything clinical stays where it is.** `practice_encounter`, `practice_procedure`,
`practice_clinical_activity`, `practice_reflection`, `practice_case_learning` — workspace-scoped, and
correctly so. The practice is the controller of the patient record.

**(d) The `recorded` half must not be re-derivable after departure — it must be *snapshotted*.**
`buildPortfolio` (`portfolio.ts:290-307`) computes consultations, distinct patients, procedures by
label, teaching sessions and CPD minutes by joining `created_by` / `performed_by` / `author_id`
against workspace-scoped clinical tables. These outputs are aggregate counts and carry no patient
identifier — but the *derivation* requires standing access to the patient record. A practitioner who
has left must not retain that. So the counts travel only as a **frozen extract taken while they were
still there**, stamped with the coverage window and the practice it came from — never as a live query
the departed practitioner can re-run. `EXPORT_SECTIONS` is the wrong vehicle for this; the portfolio
export (`portfolio.ts:345-373`) already produces exactly the right artefact and just needs to become
something that can be *retained*, not only *generated*.

---

## 2. `detail` — what must be true for an entry to be portable

### 2.1 CODE

`detail` is `text` with no constraint (`217:96`). `title` is `check (char_length(title) between 3 and 300)`
(`217:94`). `organisation` and `reference` are unconstrained text. `addEntry`
(`portfolio.ts:147-179`) validates `kind`, title length, date format, and that `expires_on >=
occurred_on` — **and nothing about content.** No clinical engine writes these fields; every value is
typed by a human (§1.1).

### 2.2 RECOMMENDATION

The **container** is safe to make portable: nothing about a `qualification` or `publication` row
requires a practice. The **content** is not automatically safe, and the honest answer is that you
cannot fix this at the point of departure.

A paediatric urologist writing a `publication` entry will plausibly type: *"Case report, posterior
urethral valves in a 4-year-old presenting at Nsambya, J. Paediatr. Urol."* That is one identifiable
child in a small country in a named hospital. Retro-scanning free text for this is not reliable and
should not be promised.

**Three things must be true, and only the first is negotiable in shape:**

1. **The practitioner is told, at the moment of writing, that this entry outlives the practice.** The
   sentence has to be at the field, not in a settings page, and it has to say the consequence: *this
   travels with you and leaves this practice's control, so it must not name a patient.* This product
   already writes at this register — `FORMAT_CHANGE_ACKNOWLEDGEMENT` in
   `src/lib/practice/identifier-format.ts:129` is a whole sentence a human must retype precisely
   because a yes/no is clicked unread.
2. **The provenance pointer survives.** `workspace_id` kept as nullable provenance (§1.4a) means a
   subject-access or erasure request against the old practice can still find an entry that mentions
   its patient. Dropping the column entirely makes the entry portable *and untraceable*, which trades
   one data-protection problem for a worse one.
3. **Nothing auto-populates these fields from a clinical record — ever.** This is true today and must
   stay a rule, not an accident. The moment a "promote this procedure to your portfolio" convenience
   writes a clinical `detail` string into a portable row, every guarantee above is void and the
   breach is systematic rather than individual.

**What this does not do:** it does not make an entry *safe*. It makes the practitioner the author of
the risk with knowledge, which is the same position `portfolio.ts:9-10` already takes about the
document as a whole — *"if it overstates, it is the clinician who signed it."*

---

## 3. Staff are not practitioners — **already fully built, nothing needed**

The expectation in the brief was right. This is the strongest "stop" in the survey.

### 3.1 CODE

`practice_membership.role_code` (`191:65-66`) has five roles:
`practice_owner | practitioner | practice_assistant | billing_reporting | read_only_auditor`.
`practice_role_capabilities` holds **87 live rows** (probed) across those five roles.
`practice_role_assignment` holds **120 live grants**.

The desk/clinical split, from the seeds across migrations 191-258:

| | `practice_assistant` (25 capabilities) | `practitioner` (44 capabilities) |
|---|---|---|
| Diary, queue, registration | `practice.calendar.view`, `appointment.manage`, `queue.manage`, `patient.create/edit/list/view`, `search.use` | same |
| Desk work | `task.view/manage`, `message.use`, `inbox.record`, `comm.record`, `document.view`, `document.author`, `medication.record`, `parameter.record`, `encounter.list`, `followup.view`, `pathway.view` | same |
| **Clinical — assistant has NONE of these** | — | `encounter.create`, `encounter.edit`, `encounter.sign`, `document.sign`, `diagnosis.record`, `treatment.record`, `procedure.record`, `medication.override`, `inbox.review`, `parameter.configure`, `pack.install`, `pathway.design`, `pathway.assign`, `patient.merge`, `followup.manage`, `access.review`, `data.export` |

The distinction is enforced, not documented. Examples with lines:

- `src/lib/practice/medication.ts:486` — *"`medication.override` **PRACTITIONER ONLY**. It is the
  authority to prescribe weight-based when the weight is absent or stale"*; enforced at
  `medication.ts:1416` and `1672`, gated in the API at
  `src/app/api/v1/practice/medications/route.ts:107`, and surfaced in the UI at
  `src/app/practice/(shell)/patients/[patientId]/page.tsx:203`.
- `supabase/migrations/200-practice-communication.sql:169` — *"`inbox.review` for the **PRACTITIONER
  ONLY**: deciding a lab result needs nothing is a clinical judgement"*.
- `supabase/migrations/246-practice-clinical-parameters.sql:825` — *"`parameter.configure` and
  `pack.install` are **PRACTITIONER ONLY**. A threshold is a…"*.
- `src/lib/practice/team-constants.ts:11-12` describes the assistant as *"The desk: diary,
  registration, tasks, the inbox. **No clinical record access.**"*

The invitation flow to add that person exists: `practice_invitation` (migration 201), a single-use
revocable **code** the owner hands over (201:34-41 explains why there is no email), engine at
`src/lib/practice/team.ts` (482 lines), capability `practice.members.manage` held by the owner only.
`ux_practice_owner_single` (`191:78-79`) keeps exactly one owner.

**Live state:** 4 memberships across 2 workspaces. In **both** workspaces the same person holds
`practice_owner` **and** `practitioner` as two separate rows — which is migration 191's stated design
(`191:117-120`: *"workspace administration does not automatically grant unrestricted clinical
access"*), and is exactly the solo-practitioner shape. 0 invitations, 0 delegations, 0 role
templates — built, never exercised.

### 3.2 RECOMMENDATION

**Nothing.** A receptionist is a `practice_assistant` membership created from an invitation code.
Multiple *users* is not multiple *practitioners*, the schema has always known the difference, and the
only thing untested is the human path — the owner has never actually issued an invitation. That is a
walkthrough, not a build.

---

## 4. The locum or covering colleague — expressible today, with one honest limit

### 4.1 CODE

Two mechanisms exist and they are for different things.

**Delegation** — `practice_delegation` (`supabase/migrations/208-practice-delegation-areas.sql:36-55`),
`effective_to timestamptz **not null**` (208:47 — *"an open-ended delegation is a role change wearing
a temporary label"*), optional `location_id` (208:44, **advisory only**, not enforced at the
capability layer per the file's own note), and `withdrawn_at/by/reason` so "why did this stop" has
different answers. The grants it creates are tagged `practice_role_assignment.delegation_id`
(`208:62`) so withdrawing one delegation ends exactly its own grants and not a colleague's role
defaults. Six areas in `src/lib/practice/delegation-constants.ts:26-63`: scheduling, registration,
documentation, communication, tasks, reports.

**⚠ Delegation deliberately cannot cover a locum's clinical work.**
`delegation-constants.ts:67-71` — `NEVER_DELEGABLE` contains `encounter.sign`, `document.sign`,
`diagnosis.record`, `treatment.record`, `procedure.record`, `encounter.create`, `encounter.edit`,
`patient.merge`, `practice.members.manage`, `practice.settings.manage`, `access.review`,
`data.export` — checked at grant time as a second independent statement of the rule, with a harness
asserting it. `document.author` is delegable but the document arrives as a **draft**; only a
practitioner signs.

Capability resolution is time-bounded correctly: `src/lib/practice/access.ts:124-131` compares
`effective_from`/`effective_to` **on the database clock** using two unambiguous queries. The file
records that this was previously `.is("effective_to", null)`, which made every time-bounded grant
invisible while live — fixed.

### 4.2 RECOMMENDATION

**A locum is a membership, not a delegation, and the code already forces that distinction correctly.**
A covering paediatric urologist signs their own consultations, so they need `encounter.sign` — which
delegation may never grant. The right shape is:

- **Locum** → a `practitioner` membership created by invitation, `status` set to `revoked` when the
  cover ends (`team.ts`; `MEMBERSHIP_STATUSES` in `team-constants.ts:19`). Their encounters carry
  their own `created_by`, which is medico-legally what you want.
- **Receptionist covering the desk** → `practice_assistant`, or a time-bounded `practice_delegation`
  over the `scheduling` area if the cover is genuinely temporary.

**One real gap, small:** a membership can only be `active | invited | suspended | revoked` — there is
no *time-bounded membership*. A locum covering 1-14 August must be revoked by hand on the 15th, and
nothing reminds anyone. Delegations cannot expire open-ended (208:47) but memberships can persist
forever. If a locum is a real near-term case, the cheapest correct fix is an `expires_at` on
`practice_membership` honoured in `resolvePracticeAccess` (`access.ts:48-50`) — **not** a new
delegation area, and **not** relaxing `NEVER_DELEGABLE`.

---

## 5. The `CP-` prefix

### 5.1 CODE

The prefix is **already configurable at runtime and versioned** — `practice_identifier_format`
(migration 220), read through `getFormat` (`src/lib/practice/identifier-format.ts:111-126`), changed
through `updateFormat` (`identifier-format.ts:131-209`) with a mandatory reason (≥10 chars), a
`practice_identifier_format_history` row written **before** the change (`:181-190`), an audit event,
and a narrowing guard. Every identity stores the version it was issued under
(`number_format_version`, 218).

Live: `prefix = "CP"`, `digits = 6`, `check_digit = true`, `separator = "-"`, `version = 1`,
**`locked = true`**. Locking is set by `lockFormat` (`identifier-format.ts:212-214`) on first issue,
and unlocking requires retyping *"I understand existing numbers will not change"*
(`identifier-format.ts:129, 144-148`).

`identifier-format.ts:20-23` states the governing rule plainly: **"changes everywhere" means future
issuance, not a rewrite.** An issued number is on printed cards and in QR codes.

The reason for `CP` rather than the spec's `CPR` is recorded at `identifier-format.ts:9-11` and
`218:38-41`: in this repository a bare `CPR-nnn` is a **specification id** (`CPR-240` is the portfolio
spec), and PIS-000 §2's `CPR-000001` differs from it only by digit count — "a distinction a human
skimming a support ticket will miss."

### 5.2 RECOMMENDATION — **leave `CP-` alone.**

The brief's concern is that `CP` reads as "Competen Practice" and therefore brands a *person's*
permanent number with a *product*. That reading is correct. It is still not worth changing, for four
reasons that are all in the code:

1. **Changing it does not fix the 43 that exist.** `updateFormat` changes future issuance only. You
   would end up with `CP-000102-9` and `CX-000271-3` both live and both permanent — two prefixes for
   one register, which is strictly worse branding than one imperfect prefix.
2. **The one public number is `CP-000102-9`**, on a `link_only` booking address that has been
   published. `218:106-114` explains why a released handle is never freed: somebody's patients scan a
   poster and reach a stranger. The same argument applies to a reissued number.
3. **The prefix is not the identifier a patient uses.** The booking route is
   `src/app/practice/book/[handle]` — the **handle**, not the number. The number is the fallback
   lookup path (PIS-000 §11), and the Damm check digit (`identifier-format.ts:46-71`) is the part
   doing the real work there.
4. **It is cheap *later*, not only now.** The mechanism to change it — versioned, history-backed,
   acknowledgement-gated — is fully built. "Cheap now" and "cheap in two years" are the same price
   here, so there is no reason to spend the inconsistency today.

**If you change it anyway,** do it *before* the next issue and accept that the 43 keep `CP`. A
neutral prefix that does not name a product would be one to three letters, e.g. `PR-` or `CN-`; the
validator accepts `^[A-Z]{1,6}$` (`identifier-format.ts:157`).

---

## 6. Tenant routing — D2 stands, and the code already implements the shape you argued for

**CODE.** The handle appears in exactly **one** route: `src/app/practice/book/[handle]` — the public
booking address. Every authenticated page lives under the route **group** `src/app/practice/(shell)/…`,
which has no dynamic tenant segment at all. Tenancy is resolved server-side per request from the
`practice_active_ws` cookie, re-validated against live membership, workspace status and entitlement
every time (`src/lib/practice/access.ts:17`, `74-152`; the file's header at `:5-13` states the cookie
"holds nothing but a workspace id preference" and that "the frontend must not infer permissions").

So the concern in the original brief — a practitioner segment on ~100 routes, each adding an
authorisation question whose failure mode is intra-practice exposure — **does not arise**, because
no such segment exists on any authenticated route. The handle is used exactly where the page is
genuinely *about* a named practitioner: the booking address a patient follows.

**This survey does not reverse D2.** `PLAT-ARCH-SURVEY-001` settled the practitioner handle as the
tenant segment, and for a product where the practitioner *is* the practice, that is right and it is
already what is built. No change.

---

## 7. Decisions for the user

Each of these is a decision because the code and the documents point in different directions, or
because the answer depends on intent that is not written down anywhere.

**D1 — Make the professional record person-scoped.**
*Cannot be inferred:* migration 217 chose workspace-cascade **deliberately** and argued for it
("one row per person **per workspace**", 217:47-48), while migration 218 chose the opposite for the
identity and argued for that ("if this row were scoped to a workspace, the workspace cascade would
delete the identity along with it", 218:12-14). Both are reasoned; they contradict. Only you can say
which the product means. **Recommended: yes**, per §1.4. Free today (0 rows), not free later.

**D2 — Retire `practice_practitioner_profile` into `practice_practitioner_identity`, or re-key it in place?**
*Cannot be inferred:* it is a question about whether unverified self-declared facts may sit in the
same table as a verified licence state. Both migrations have strong, opposite-facing doctrine about
not manufacturing assurance. **Recommended: retire it into the identity**, provided the
`self_declared` provenance is carried on the moved columns and not dropped in the move.

**D3 — Does a portable entry get a write-time warning, and what does it say?**
*Cannot be inferred:* it is a product-voice decision about how loudly to tell a practitioner that
their own words will outlive the practice. **Recommended: yes**, at the field, as a sentence, per §2.

**D4 — Does the `recorded` half travel as a frozen snapshot, or not at all?**
*Cannot be inferred:* "your CPD minutes and consultation counts, as at the day you left" is genuinely
useful for revalidation and genuinely a new artefact that has to be retained somewhere. Not
travelling at all is defensible and cheaper. **Recommended: snapshot**, but this is the one item
here that could honestly be deferred.

**D5 — `CP-` prefix: keep or change.**
*Cannot be inferred:* it is a naming judgement, and the technical case is genuinely balanced.
**Recommended: keep**, per §5.2.

**D6 — Time-bounded membership for locums: build now or wait for a real locum.**
*Cannot be inferred:* it depends on whether a covering colleague is a real near-term case for this
practitioner or a hypothetical. **Recommended: wait.** Everything else about locums works today.

---

## 8. Not surveyed / could not be read

- **Not surveyed** (out of the narrowed scope): the competency passport estate beyond the single
  paragraph in §0; any practice identifier, number or slug; routing alternatives.
- **`src/lib/practice/booking*.ts`, `scheduling.ts`, `availability-config.ts`** — deliberately not
  cited. Another agent is editing them concurrently and no line number in them would be trustworthy.
  The only booking fact used here is the **route directory** `src/app/practice/book/[handle]`, which
  is a filesystem path, not a line.
- **RLS policies** were not enumerated. Every `practice_*` table is `enable row level security` with
  **zero policies** (191:320-333, 217:106-107) and all access goes through the service-role API layer
  — so RLS is not the control surface for anything in this survey. Stated, not proven, because
  proving it would mean a policy sweep that was out of scope.
- **`practice_lifecycle_transition`** contents were not probed; the lifecycle *engine* was read
  (`lifecycle.ts:1-80`, `576-625`) but no live archive/suspend has been exercised.
