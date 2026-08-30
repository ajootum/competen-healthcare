# CPR-PROV-DEFAULTS-001 — Default-Source Audit, Baseline Matrix, Architecture, Open Decisions

Surveyed 2026-08-30, before coding, per §14/§17.

## A. Where defaults live today (the source matrix)

| Source | What it defaults | Notes |
|---|---|---|
| DB column defaults (migs 191, 230, 244, 254, 268…) | locale `en-UG`, date format, encounter mode `in_person`, `otp_required` true, `publish_state` draft, `unverified_requests_allowed` false, cancellation notice 0, queue policy first-come, confirmation instant | Schema-enforced; the safest tier. |
| `seedTaxonomy` (provisioning, mig 292 backfill) | 11 visit types + consultation modes, `system_seeded` marked, upsert-idempotent | The one existing provisioning materialisation. |
| `DEFAULT_RULE` / `resolveBookingRule` fallback (availability-config) | the platform-safe booking behaviour when no rule row exists (source: "default") | The de-facto platform baseline for booking — inherited, never copied. |
| Engine constants | `REQUIREMENT_LEVEL_WHEN_UNSET` optional, OTP 5 min, idle observation 30 min, specificity weights | Server-authoritative ✓. |
| UI initial drafts | `blankDraft()` in the rule composer; PublishWorkspace's initial settings draft | Render defaults only — they bind to controls; the server refuses what the engine refuses. Compliant with §2 "UI may render but not define" EXCEPT that blankDraft's values silently become stored values on first save — acceptable because every value passes the engine's validation. |
| Registration | **No default template** — a fresh practice fails `REGISTRATION_FIELDS_VALID` until one is hand-built. `createTemplate(seedCoreFields)` + `SEED_REQUIRED_KEYS` already encode the canonical field policy but nothing calls them at provisioning. | The biggest pure-burden gap. |
| Message channels | No rows — email off until the Patient Communications switch (CPR-BOOK-EMAIL-001). | |
| Security | `getSecurityPolicy` null → OBSERVE mode (no idle lock) | Platform baseline ✓ inherited. |
| Conflicts found | None hard-conflicting. One divergence: §3 prescribes 2 starter appointment types; `seedTaxonomy` seeds 11 (live behaviour since mig 292). See Open Decisions. |

## B. Canonical baseline — Competen Standard Practice V1 (`CP_STANDARD_V1`)

Defined once in `src/lib/practice/baseline.ts`. Per §5.5, only three things are MATERIALISED —
everything else is inherited from the enforcement points above, with the baseline file documenting
each value and where it is enforced (so there is one place to read, without copying rows):

| Area | V1 value | Inherited / materialised |
|---|---|---|
| Appointment types | current `seedTaxonomy` set | materialised (already; unchanged) |
| Booking horizon / cutoff | 120 days / 30 min | **materialised** on the one starter rule |
| Confirmation | immediate | starter rule (engine default anyway) |
| Cancellation / reschedule | allowed, 0 min notice | starter rule (engine defaults) |
| Overbooking / walk-ins | 0 / off | starter rule + session-level default |
| Self-booking required fields | first name, family name (engine floor) + **email** | **materialised**: starter rule's requiredInformation `{contact_email: required}` |
| Optional booking fields | DOB, phone, reason | inherited (`optional` when unset) |
| Guardian logic | canonical `_is_child` condition machinery | inherited |
| Registration form | published starter template, core fields, canonical required keys | **materialised** via `createTemplate`+`publishTemplate` |
| Email channel | enabled with sender = practice name, WHERE the deployment provider is operational | **materialised** via `setChannel`; skipped (not fabricated) when no provider |
| Email verification | required | inherited (`otp_required` DB default true) |
| SMS / WhatsApp | not provisioned, never warned about | inherited (absent) |
| Booking page | NOT created, NOT published | inherited absence — publish stays the deliberate act |
| Security / audit / AI / documents | platform baselines | inherited |

## C. Architecture

- **One module**: `baseline.ts` exports `CP_BASELINE_VERSION`, the documented matrix, and
  `seedBaselineDefaults(admin, workspaceId, ownerId, correlationId)`.
- **Wired into the existing provisioning transaction** inside the `create_onboarding` step (the
  `provisioning_step.step_code` CHECK from migration 191 closes the code list, so the baseline rides a
  step exactly as `seedTaxonomy` rides `create_configuration`): non-fatal, step-noted
  (`BASELINE_SEED_FAILED`), console-logged, auditable (`practice.baseline_seeded`).
- **Canonical services, real context**: the seed resolves a REAL owner context via
  `resolveWorkspaceContext` (PROVISIONING status passes it) and calls `saveBookingRule`,
  `createTemplate`/`publishTemplate`, `setChannel` — every write is therefore capability-checked,
  versioned and audited exactly as a human's would be. Nothing inserts around an engine.
- **Provenance without a migration**: `practice_configuration.feature_flags` (jsonb, exists since mig
  191) gains `baseline_version: "CP_STANDARD_V1"`, written only when absent — a later baseline never
  overwrites an earlier practice's version (§9), and HQ can query adoption via the jsonb key. A typed
  column can arrive later under the §13 governed-migration workflow if wanted.
- **Idempotency (§10)**: every materialisation fires only into emptiness — any existing booking rule,
  any existing registration template, any existing email-channel row, any existing baseline_version
  each skip their step. Retries converge; established practices are structurally untouchable (§12)
  because a practice with any configuration simply has nothing empty to seed.
- **Inheritance presentation (§7)**: no new UI. The starter rule is named "Competen standard booking",
  so the existing clinic panels already render "Behaviour here is inherited from Competen standard
  booking (practice-wide)" with Override/Restore — the §7 language falls out of CPR-RULES-HFE-001's
  machinery.

## H. Open decisions (product-owner calls, shipped with the stated default)

1. **Starter rule visibility = `public`.** The page stays unpublished (nothing is reachable), so the
   single deliberate act of publishing makes the practice bookable — §6's five steps with no hidden
   step-4 editor visit per location. If you prefer visibility to be its own deliberate act, one line
   changes it to `internal`.
2. **Email channel auto-enabled** (sender = practice name) where the deployment provider is
   operational — per §3's "email-capable defaults where service is operational". It sends nothing
   until bookings/publish exist. Reversal: seed `enabled: false` with the sender name prefilled.
3. **Visit types: V1 keeps the live 11-type seed**, reading §3's "New patient; Follow-up" as the
   minimum floor rather than a cap — trimming to 2 would change what existing screens (taxonomy,
   sessions) already offer new practices. Trim on your word.
4. **Provenance in `feature_flags` jsonb**, not a typed column — zero-migration ship; a typed column
   is a one-file governed migration later if HQ reporting wants it.
