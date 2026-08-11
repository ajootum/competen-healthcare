# CPR-IMP-001 — Bulk Patient Import (CSV)

Status: **v1.0, governing** — written 2026-08-11, with the build. No prior spec governed patient
import: CPR-PRM-001 lists "Bulk import from external systems" as a *future enhancement*, CPR-005 V3
names an "Imported Patient" registration mode without defining it, and CPR-SET-000 names an
Import & Export module with a bare "CSV" bullet. All 181 CPR documents were searched (2026-08-11)
before this was written.

## Purpose

Two audiences, one mechanism:
1. **Practitioners moving an existing register in** — the real product feature.
2. **Walkthrough and test seeding** — a cohort in one file instead of forty drawer round-trips.

## The two settled decisions (the owner, 2026-08-11)

1. **A row that matches an existing patient is SKIPPED and REPORTED** with the matched candidates.
   Mirrors the screen's own doctrine ("Search first — register only when nobody matches") and
   CPR-DM-001 §6.1 ("probabilistic matching may suggest but never silently merge").
2. **A row whose appointment cannot be honoured still registers the patient.** The appointment is
   dropped and the report says exactly why. A bad time never costs a record its migration.

## The minimum dataset (the owner, 2026-08-11)

**The in-house registration screen's rules govern**, resolving the CPR-005-V3-vs-CPR-V5-006
inconsistency in favour of what is built and used: any one name part; date of birth **or** estimated
age; phone **or** email (a guardian's contact satisfies it for a child, and is stored on the guardian
only); sex optional; national ID optional. Guardian rules, template rules and the duplicate doctrine
are **not restated by the import** — every row goes through `screenRegistration()` / `register()` /
`bookAppointment()`, the same engines behind the New patient drawer.

## The file

CSV, RFC-4180 quoting, UTF-8, ≤ 500 data rows, ≤ 1 MB. Columns (header names, case/space tolerant;
all optional per-row except the minimum dataset above):

```
first_name, middle_name, last_name, date_of_birth, estimated_age, sex,
phone, email, national_id,
guardian_name, guardian_relationship, guardian_phone, guardian_email,
reason_for_visit,
location, appointment_date, appointment_time, appointment_type,
external_id
```

- `date_of_birth` and `appointment_date` are **YYYY-MM-DD only** (03/04 reads two ways).
- `appointment_time` is **HH:MM, 24-hour, in the practice's own timezone** (`practice_workspace.timezone`);
  the DST-correct instant is computed server-side (`instantInZone`).
- `location` is matched by name (case-insensitive) against the practice's **active** locations; an
  unmatched name drops the appointment (decision 2), never the patient.
- `guardian_relationship` must be one of the registration engine's 15 relationship types; legal
  authority follows the engine's own `GUARDIAN_TYPES` set (single-sourced, exported for this use).
- `external_id` is the source system's row key — see idempotency.
- **An unknown header is a named file problem, not ignored** — a typo like `apointment_date` must not
  silently import a register without its appointments.
- A file-level problem (unclosed quote, unknown column, over-cap) refuses the **whole commit**.

## Idempotency (CPR-ARCH-001), two layers

1. **DB constraint**: `claimed_external_id` is set only on ledger rows that created a patient;
   `ux_practice_import_claim (workspace_id, claimed_external_id)` makes a second creation for the
   same external id impossible regardless of code.
2. **File hash**: a file whose sha256 already has a COMPLETED run in this workspace is refused whole
   (409 ALREADY_IMPORTED). Deliberately *not* a unique index, so a FAILED run never blocks the
   corrected retry. Rows without `external_id` fall back to the registration duplicate screen.

## Provenance (CPR-DM-001 §15) and audit (CPR-SEC-001)

The `practice_import_run` / `practice_import_row` ledger (migration 288) **is** the provenance
record: run → actor + file name + sha256 + timestamp; row → external key + outcome + created
patient/appointment. The per-row report is the **reconciliation report** CPR-DM-001 §21 requires —
nothing is silently dropped; every row has a recorded verdict from a closed list
(`REGISTERED`, `REGISTERED_AND_BOOKED`, `SKIPPED_DUPLICATE`, `SKIPPED_ALREADY_IMPORTED`, `ERROR`).
The run itself emits `practice.patients_imported` to `practice_audit_event`; per-patient audit events
come from the engines as usual. Activation telemetry needs nothing special: `booking.first_received`
/ `tenth_received` are count-based by design and correct under bulk booking; there is deliberately no
patient-count activation milestone.

## Surfaces

- **UI**: `/practice/patients/import` (gate: `patient.create`; shell must be READY). Flow: choose
  file → **Check the file** (preview, zero writes — `previewPatientImport`) → **Import** (commit —
  same engine, `commitPatientImport`) → per-row report + persistent run ledger on the page. The
  QuickActions "Import patients" refusal on the Patients workspace retired in the same commit.
- **API**: `GET/POST /api/v1/practice/patient-import` (guard `requirePracticeContext("patient.create")`;
  engines re-check `patient.edit` for guardians and booking capabilities themselves and report drops).

## Out of scope (named, not implied)

Historical **encounters/visits** (this imports people and future appointments, not past clinical
records); update-in-place of existing patients (decision 1 forbids it; CPR-LRE-001 would require
versioned merge); Excel/FHIR (CSV only, per CPR-SET-000's own bullet); column mapping UI (the
template is the mapping); import from URL.
