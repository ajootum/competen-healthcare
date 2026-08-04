# ENT-REVIEW-001 — Review of three enterprise specifications

Covers **PIS-000 v1.0 (Frozen)**, **CPR-PRM-001 v1** and **IAM-000 v1**, read in full on 2026-08-04.
CPR-250 (Competency & CPD) is paused at the user's instruction to make room for these.

---

## 1. What each document actually is

The three are not the same kind of document, and treating them as one work item would be a mistake.

| Spec | Kind | State here |
|---|---|---|
| **PIS-000** | A concrete feature specification, marked **Frozen for Development** | Almost entirely greenfield |
| **CPR-PRM-001** | A consolidation of two earlier registration specs | **Substantially already built** |
| **IAM-000** | A platform *architecture standard*, not a feature spec | Mostly satisfied, partly infrastructure |

**Dependency order is fixed by the documents themselves.** CPR-PRM-001 §8 says "Integrate with
practitioner booking URLs/handles. Practitioner resolved automatically from invitation/self-booking
link" — those URLs and handles are PIS-000's. IAM-000 is the umbrella both sit under. So: **PIS-000
first**, then CPR-PRM-001's genuine gaps, with IAM-000 as a conformance audit across both.

PIS-000 is done, and is the subject of §3 below.

---

## 2. Two conflicts with settled doctrine, surfaced rather than silently resolved

### 2.1 PIS-000 §11 requires OTP, and this product sends nothing

> "OTP verification before booking confirmation."

Sending a one-time code to a patient needs an SMS or email channel. **This product has none**, by a
decision taken in CPR-320 and CPR-340 and enforced structurally by their harnesses — there is no channel
column and no `sent_at` anywhere, deliberately, so that nothing can ever claim to have messaged somebody.

A code that cannot reach the patient is not a verification, so it is **absent rather than stubbed**, and
the public profile page says so where the booking button would be. Everything else in §11 — resolving a
handle, a practitioner number, a QR code or a direct URL to a practitioner — is built.

**This is a product decision, not a technical one.** Opening patient-initiated booking means either
adding a real delivery channel (a significant change with cost, deliverability and privacy consequences)
or gating bookings some other way. Flagged for the user.

### 2.2 PIS-000 publishes real people

§6 and §7 make a practitioner's name, qualifications, specialties, biography and locations publicly
searchable. The site is currently `noindex` for authenticated surfaces and takes an explicit position on
`/verify`: *reachable by link, never by search — unguessable is not the same as unpublished.*

Resolved by following the spec's own §1 ("Privacy by default; discoverability is configurable"):
**discovery defaults to `hidden`**, all five §7 modes are implemented, and only `public` reaches search
or carries an indexable `robots` tag. Going public is a deliberate act by the practitioner, and the mode
picker says in as many words that it publishes them.

---

## 3. PIS-000 as built (migrations 218 + 219)

`src/lib/practice/identity-service.ts` · `/@handle` · `scripts/practice-identity-service-harness.ts`
(63 assertions, six deliberate breaks proven)

### The architectural crux: this identity is not workspace-scoped

Every other `practice_*` table hangs off `practice_workspace`, because a consultation belongs to a
practice. **An identity does not.** §1 "independent of employers", §15 "remains valid when changing
workplaces". Had this row been workspace-scoped, the workspace cascade would delete a practitioner's
permanent number along with a practice they closed.

So `practice_practitioner_identity` is keyed on `user_id`, and the workspace a booking lands in is a
**nullable pointer** with `on delete set null`. The harness deletes the workspace and asserts the number,
the handle and the resolving URL all survive.

### The number is never reused, and that needed a sequence

§2 says "permanent, never reused". `max(number) + 1` is correct under concurrency (the unique index
settles the race) but **wrong about reuse**: delete CPR-000005 and the next practitioner is handed
000005 again — a number that meant one clinician on a printed card now means another. Migration 219 adds
a plain-SQL allocator over a real sequence, whose body contains no semicolon so it survives the
`;`-splitting migration runner. A missing allocator now **fails loudly** rather than silently
downgrading the guarantee.

### A released handle stays claimed

§3 and §8 require legacy URLs to redirect after a handle change. The obvious implementation frees the
old handle; this one retires it into `practice_handle_history` instead, for a reason the spec does not
state: **printed posters, cards and QR codes carrying the old handle are still in circulation**.
Reassigning it would route a stranger's patients to somebody new. The break-test confirms the harm —
with retirement disabled, a second practitioner successfully claimed the first one's released handle.

### Other decisions worth recording

- **Titles are not names.** "Dr Elisha Okaisu" must not yield `@dokaisu`; the generator strips
  dr/prof/mr/mrs/ms/sr/sister/nurse/mx before taking an initial.
- **A hidden practitioner is a 404, not a refusal.** "This person exists but will not see you" is a
  disclosure about a named individual.
- **The search filter is in the query, not applied to results** — filtering afterwards is the classic
  leak where a total discloses that a hidden practitioner exists. Same position CPR-350 took.
- **The canonical host is configurable**, not hardcoded to `practice.competenhealthcare.com`. A booking
  URL printed on a physical card has to resolve, and hardcoding a host this deployment may not serve
  would put a dead address on paper.
- **QR codes are generated in process** — no external image service ever sees a practitioner's booking
  URL, and a printed card does not depend on somebody else's uptime. SVG and PNG; **PDF is not built**.
- **§12's "WhatsApp, SMS and email templates" are honourable**: they are *text to copy*, not sending.
  The toolkit returns `sentByThisProduct: false`.
- **Licence verification records who checked**, with a reference and a timestamp. Nothing contacts a
  council — §14 lists that as future work — so this is provenance, not verification, exactly as CPR-240
  concluded about registration numbers.

### A naming collision to note

§2 specifies the practitioner number format `CPR-000001`. In this repository a bare `CPR-nnn` is a
**specification number** (`CPR-240` is the portfolio spec). The two are distinguishable only by digit
count — three versus six. Followed as frozen, and the content harness still reports 121, but it is worth
a conscious decision if the format is ever revisited.

---

## 4. CPR-PRM-001 — most of it is already built

Checked against the schema before planning any of it (the CPR-320 lesson):

| Spec section | State |
|---|---|
| §4 Patient Profile | **Built** — `practice_patient` (migration 193), with generated normalised columns |
| §5 Registration, search-first, duplicate detection | **Built** — `patients.ts`, three-branch duplicate doctrine |
| §7 Multi-facility identifiers | **Partly built** — `practice_patient_identifier` already carries `identifier_type`, `issuer` and `location_id`; needs facility-scoped uniqueness and active/historical status |
| §8 Booking integration | **Now possible** — PIS-000 supplies the handles and URLs |
| §11 Business rules | **Built** — age calculation, duplicate detection, profile persists across locations |
| §6 Relationships (guardian / next-of-kin) | **Not built** — no table |
| §9 Configuration framework (templates, custom fields, conditional rules) | **Not built** |
| §10 Data-processing consent, communication preferences | **Not built** — `practice_patient_contact` has `preferred` but no consent record |
| §4 Practice tags, practice notes | **Not built** |

So the remaining work is four things, not thirteen: **relationships**, **the configuration framework**,
**consent and communication preferences**, and **tags/notes** — plus tightening facility identifiers.

---

## 5. IAM-000 — a standard, and mostly already met

IAM-000 is explicit that "no product shall implement its own authentication or authorization stack".
Read as a conformance checklist against what exists:

**Already satisfied**

- Identity provider, email/password, email verification — Supabase Auth
- RBAC with time-bounded grants, delegation, temporary permissions, break-glass — `practice_role_assignment` (CPR-310) and `practice_break_glass` (CPR-370)
- Sessions, device management, revocation, idle timeout, MFA policy — CPR-370, migration 213
- Immutable audit of logins, role changes, patient access, configuration and AI actions — `practice_audit_event` and `practice_access_log`, the latter append-only in the database
- Workspace context and switching without re-authentication — `resolvePracticeAccess`, active-workspace cookie, re-validated every request
- Permission recalculation on context change — `resolveWorkspaceContext`

**Infrastructure, not application code** — TLS, encryption at rest, secrets management, API gateway,
WAF, DDoS protection. These are deployment concerns and cannot be closed by a migration.

**Genuine gaps, all substantial**

- SSO / OAuth2 / OIDC / SAML federation; Entra ID, Google, Apple
- Passkeys / WebAuthn (the spec itself marks these future)
- SMS OTP and email OTP — the same missing channel as PIS-000 §11
- `OtpChallenges`, `TrustedDevices` and `PasswordHistory` as first-class objects
- Refresh-token rotation (Supabase handles tokens; rotation policy is not ours today)
- A central IAM SDK and shared middleware across all workspaces

**One thing to note about scope.** IAM-000 governs the entire platform — twelve workspaces, not just
Competen Practice. Everything above was assessed against the practice tenancy. A platform-wide
conformance audit is its own piece of work and would need the other workspaces read as carefully.

---

## 6. Recommended order from here

1. **PIS-000 — done.** Migrations 218 and 219 applied, 63 assertions, six breaks proven.
2. **CPR-PRM-001's four real gaps**, in this order: relationships (clinically load-bearing — a guardian
   for a child under 18), then consent and communication preferences, then tags and notes, then the
   configuration framework (largest, and the least urgent).
3. **IAM-000 conformance**, written up as an audit against all twelve workspaces rather than built as a
   module. The buildable parts are OTP infrastructure and federated sign-in, both of which are product
   decisions with cost attached.

Two things need the user's decision before they can move: **whether to add a delivery channel** (blocks
PIS-000 §11 booking and IAM-000's OTP), and **whether to open public practitioner discovery** at all
while the site is pre-launch.
