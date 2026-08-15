-- ====================================================================================================
-- 303  PRACTICE PAYMENTS, PHASE 1  (CPR-PAY-001 s23 Phase 1 + CPR-PAY-002)
-- ====================================================================================================
--
-- >>> APPLY THIS FILE WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Sections 10 and 11 contain function bodies with internal semicolons inside $$ ... $$, exactly like
-- migrations 195 and 289. Everything before section 10 is plain statements and survives either way.
-- If sections 10 or 11 fail to apply, every table is still correct -- the allocator and the guards
-- are additive, and the harness asserts their presence by name so an absence is visible, never silent.
--
-- WHAT THIS IS
--   The practitioner's own patient-billing store: fee catalogue, charges, invoices, payments,
--   allocations, receipts and adjustments. It is the PRACTICE charging PATIENTS. It is not, and must
--   never touch, the platform estate that charges practices (plat_plans, plat_invoices, BILL) -- no
--   FK crosses that boundary in either direction.
--
-- THE TWO RULES THE SCHEMA ENFORCES BY SHAPE
--   COLLECTED IS NOT RECEIVED (PAY-001 s9). Every payment records WHO collected it. Nothing in this
--   schema lets a facility-collected payment masquerade as money in the practitioner's hands --
--   settlements are Phase 2, and until then the collector column keeps the question honest.
--   BALANCES ARE DERIVED, NEVER STORED (PAY-001 s20). There is no balance column anywhere in this
--   file. Paid, part-paid and overdue are computed from allocations against totals at read time, so
--   two figures cannot disagree about the same invoice.
--
-- MONEY IS INTEGER MINOR UNITS (bigint), THE FIRST SUCH COLUMNS IN THIS PRODUCT. Every existing money
--   column in the repo is numeric and every one of them is another plane. PAY-001 s20 forbids binary
--   floating point and this file forbids numeric too: amount_minor is the amount in the currency
--   minor unit, exact, summable, comparable. Currency is a 3-letter column with NO DEFAULT -- s19
--   forbids hardcoding UGX into the data model, so the engine must always say which currency it means.
--
-- DELIBERATELY ABSENT, AND WHY
--   balance / paid_amount columns   derived, see above.
--   PART_PAID / PAID / OVERDUE      derived statuses. Stored status is only DRAFT / ISSUED / VOID --
--                                   the three facts that are ACTS rather than arithmetic.
--   patient invoice issuer columns  PAY-002 s2 (the issuer rule) is an ENGINE decision made before an
--                                   invoice row is created, not a column on the result.
--   settlement tables               Phase 2, by the spec's own phasing. The collector column is the
--                                   Phase 1 hook they will join against.
--   tax columns                     s5 says future/conditional. A column nothing reads is the dead
--                                   FK class wearing fiscal clothes.
--   a billing_document_snapshot     folded into the rows that need it: practice_invoice carries
--   table                           issued_snapshot jsonb frozen at issue, practice_receipt carries
--                                   snapshot jsonb frozen at creation. The version-table shape (246,
--                                   244) exists for documents that keep changing -- these never do.
--   DELETE triggers                 the migration 202/247 lesson: a BEFORE DELETE guard breaks the
--                                   workspace cascade delete that practice erasure and every harness
--                                   cleanup depend on. Never-hard-delete is enforced by the ENGINE
--                                   (no delete verb exists) and audited. The DB guards UPDATE only.
--
-- NUMBERING (PAY-002 s5/s6): a counter table with an atomic single-statement allocator, migration
--   289's proven shape -- no MAX()+1, no browser-side numbers, gaps acceptable, reuse never. The
--   allocator returns a NUMBER and the application formats it (the 220 lesson: a format defined in
--   two places is guaranteed to disagree). Formats are pinned by CHECK: CP-INV-YYYY-NNNNN and
--   CP-RCT-YYYY-NNNNN, five digits growing to seven so issuance does not brick at 100000. The
--   identifier-format registry (220) is not used: its prefix check is letters-only and these
--   prefixes carry a hyphen -- a second registry row shape for one consumer is not worth the drift.
--
-- CAPABILITIES (PAY-001 s18, PAY-002 s21): financial permissions are DISTINCT from clinical ones.
--   Seven codes, each backing a verb Phase 1 actually builds: billing.view, fee.manage,
--   invoice.draft, invoice.issue, payment.record, billing.adjust (adjust, void and refund records),
--   billing.export. Owner and practitioner get all seven. The dormant billing_reporting role gets
--   billing.view and billing.export -- the two verbs its name has promised since migration 191.
-- ====================================================================================================

-- ---- 1. THE FEE CATALOGUE -- PAY-001 s5 -------------------------------------------------------------

create table if not exists practice_service_fee (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  name text not null,
  service_type text not null default 'consultation',
  code text,
  amount_minor bigint not null,
  currency text not null,
  active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table practice_service_fee drop constraint if exists practice_service_fee_name_check;
alter table practice_service_fee add constraint practice_service_fee_name_check
  check (char_length(btrim(name)) between 2 and 160);
alter table practice_service_fee drop constraint if exists practice_service_fee_type_check;
alter table practice_service_fee add constraint practice_service_fee_type_check
  check (service_type in ('consultation', 'follow_up', 'teleconsultation', 'procedure', 'report_document', 'other'));
alter table practice_service_fee drop constraint if exists practice_service_fee_amount_check;
alter table practice_service_fee add constraint practice_service_fee_amount_check
  check (amount_minor >= 0);
alter table practice_service_fee drop constraint if exists practice_service_fee_currency_check;
alter table practice_service_fee add constraint practice_service_fee_currency_check
  check (currency ~ '^[A-Z]{3}$');
alter table practice_service_fee drop constraint if exists practice_service_fee_dates_check;
alter table practice_service_fee add constraint practice_service_fee_dates_check
  check (effective_to is null or effective_from is null or effective_to >= effective_from);

create index if not exists idx_practice_service_fee_ws
  on practice_service_fee(workspace_id, active, service_type);

alter table practice_service_fee enable row level security;

-- Per-location override -- s5. Locations are deactivated and never deleted (configuration.ts), so
-- there is no cascade path to worry about from that side. One override per fee per location.
create table if not exists practice_service_fee_override (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  fee_id uuid not null references practice_service_fee(id) on delete cascade,
  location_id uuid not null references practice_location(id) on delete cascade,
  amount_minor bigint not null,
  currency text not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_service_fee_override drop constraint if exists practice_fee_override_amount_check;
alter table practice_service_fee_override add constraint practice_fee_override_amount_check
  check (amount_minor >= 0);
alter table practice_service_fee_override drop constraint if exists practice_fee_override_currency_check;
alter table practice_service_fee_override add constraint practice_fee_override_currency_check
  check (currency ~ '^[A-Z]{3}$');

create unique index if not exists ux_practice_fee_override
  on practice_service_fee_override(fee_id, location_id);

alter table practice_service_fee_override enable row level security;

-- ---- 2. CHARGES -- PAY-001 s6 -----------------------------------------------------------------------
--
-- A charge is the money-side record of work performed. The clinical row is never modified by it and
-- never references it -- the FK points from here into the clinical estate, one direction only.
-- fee_snapshot photographs the fee rule as applied (default, override, actual, reason) so a later
-- catalogue edit cannot rewrite what was charged -- the display_name_snapshot doctrine, applied to money.

create table if not exists practice_charge (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid references practice_patient(id) on delete set null,
  encounter_id uuid references practice_encounter(id) on delete set null,
  procedure_id uuid references practice_procedure(id) on delete set null,
  service_fee_id uuid references practice_service_fee(id) on delete set null,
  location_id uuid references practice_location(id) on delete set null,
  source text not null default 'manual',
  source_ref uuid,
  description text not null,
  quantity integer not null default 1,
  unit_amount_minor bigint not null,
  amount_minor bigint not null,
  currency text not null,
  fee_snapshot jsonb,
  charged_on date not null,
  performed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_charge drop constraint if exists practice_charge_source_check;
alter table practice_charge add constraint practice_charge_source_check
  check (source in ('consultation', 'procedure', 'report_document', 'manual'));
alter table practice_charge drop constraint if exists practice_charge_description_check;
alter table practice_charge add constraint practice_charge_description_check
  check (char_length(btrim(description)) between 2 and 300);
alter table practice_charge drop constraint if exists practice_charge_quantity_check;
alter table practice_charge add constraint practice_charge_quantity_check
  check (quantity between 1 and 999);
alter table practice_charge drop constraint if exists practice_charge_amounts_check;
alter table practice_charge add constraint practice_charge_amounts_check
  check (unit_amount_minor >= 0 and amount_minor >= 0 and amount_minor = unit_amount_minor * quantity);
alter table practice_charge drop constraint if exists practice_charge_currency_check;
alter table practice_charge add constraint practice_charge_currency_check
  check (currency ~ '^[A-Z]{3}$');

-- s6/s20 idempotency, structural: ONE charge per source entity. A revisited encounter cannot
-- double-charge its consultation because (source, encounter) is unique through the coalesce fold --
-- and manual charges, whose source_ref is null, fold through their own id and never collide.
create unique index if not exists ux_practice_charge_source
  on practice_charge (workspace_id, source, coalesce(source_ref, id));

create index if not exists idx_practice_charge_patient
  on practice_charge(workspace_id, patient_id, charged_on desc);
create index if not exists idx_practice_charge_day
  on practice_charge(workspace_id, charged_on desc);

alter table practice_charge enable row level security;

-- ---- 3. INVOICES -- PAY-002 s4/s5/s7 ----------------------------------------------------------------
--
-- Stored status is DRAFT / ISSUED / VOID only. PART_PAID, PAID and OVERDUE are arithmetic over
-- allocations and the due date, computed at read time -- storing them would be the editable-balance
-- mistake s20 names. issued_snapshot is the immutable document: line items, totals, issuer block and
-- payer exactly as issued, the thing the PDF renders from (s16).

create table if not exists practice_invoice (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  invoice_number text,
  status text not null default 'DRAFT',
  patient_id uuid references practice_patient(id) on delete set null,
  payer_kind text not null default 'patient',
  payer_label text,
  currency text not null,
  subtotal_minor bigint not null default 0,
  adjustment_total_minor bigint not null default 0,
  total_minor bigint not null default 0,
  issue_date date,
  due_date date,
  notes text,
  issued_snapshot jsonb,
  issued_at timestamptz,
  issued_by uuid,
  void_reason text,
  void_at timestamptz,
  void_by uuid,
  replaced_by_invoice_id uuid references practice_invoice(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);

alter table practice_invoice drop constraint if exists practice_invoice_status_check;
alter table practice_invoice add constraint practice_invoice_status_check
  check (status in ('DRAFT', 'ISSUED', 'VOID'));
alter table practice_invoice drop constraint if exists practice_invoice_number_check;
alter table practice_invoice add constraint practice_invoice_number_check
  check (invoice_number is null or invoice_number ~ '^CP-INV-[0-9]{4}-[0-9]{5,7}$');
alter table practice_invoice drop constraint if exists practice_invoice_payer_check;
alter table practice_invoice add constraint practice_invoice_payer_check
  check (payer_kind in ('patient', 'insurer', 'corporate', 'facility', 'other'));
alter table practice_invoice drop constraint if exists practice_invoice_currency_check;
alter table practice_invoice add constraint practice_invoice_currency_check
  check (currency ~ '^[A-Z]{3}$');
alter table practice_invoice drop constraint if exists practice_invoice_amounts_check;
alter table practice_invoice add constraint practice_invoice_amounts_check
  check (subtotal_minor >= 0 and adjustment_total_minor >= 0
    and total_minor = subtotal_minor - adjustment_total_minor and total_minor >= 0);
alter table practice_invoice drop constraint if exists practice_invoice_dates_check;
alter table practice_invoice add constraint practice_invoice_dates_check
  check (due_date is null or issue_date is null or due_date >= issue_date);
-- An ISSUED invoice has its number, snapshot and issue date. A number never exists on a draft.
alter table practice_invoice drop constraint if exists practice_invoice_issued_check;
alter table practice_invoice add constraint practice_invoice_issued_check
  check (
    (status = 'DRAFT' and invoice_number is null and issued_at is null)
    or (status in ('ISSUED', 'VOID'))
  );

-- Unique per workspace, folded through the row id for the drafts that have no number yet -- the full
-- unique index shape this estate uses instead of a partial one. A voided number stays on its voided
-- row forever, which is exactly what makes reuse impossible.
create unique index if not exists ux_practice_invoice_number
  on practice_invoice (workspace_id, coalesce(invoice_number, id::text));

create index if not exists idx_practice_invoice_patient
  on practice_invoice(workspace_id, patient_id, created_at desc);
create index if not exists idx_practice_invoice_status
  on practice_invoice(workspace_id, status, issue_date desc);

alter table practice_invoice enable row level security;

-- Line items derive from charges (s8) -- charge_id is NOT NULL. Whether a charge is already on
-- another active invoice is an ENGINE rule, because void-and-reissue must free the charge and a
-- unique index cannot see status without being partial.
create table if not exists practice_invoice_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  invoice_id uuid not null references practice_invoice(id) on delete cascade,
  charge_id uuid not null references practice_charge(id) on delete restrict,
  description_snapshot text not null,
  quantity integer not null default 1,
  unit_amount_minor bigint not null,
  line_amount_minor bigint not null,
  currency text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table practice_invoice_item drop constraint if exists practice_invoice_item_amounts_check;
alter table practice_invoice_item add constraint practice_invoice_item_amounts_check
  check (unit_amount_minor >= 0 and line_amount_minor >= 0
    and quantity between 1 and 999 and line_amount_minor = unit_amount_minor * quantity);
alter table practice_invoice_item drop constraint if exists practice_invoice_item_currency_check;
alter table practice_invoice_item add constraint practice_invoice_item_currency_check
  check (currency ~ '^[A-Z]{3}$');

create unique index if not exists ux_practice_invoice_item_charge
  on practice_invoice_item (invoice_id, charge_id);
create index if not exists idx_practice_invoice_item_invoice
  on practice_invoice_item(invoice_id, position);

alter table practice_invoice_item enable row level security;

-- ---- 4. PAYMENTS -- PAY-001 s8/s9 -------------------------------------------------------------------
--
-- The collector column IS the collected-versus-received rule. Phase 1 records who took the money.
-- Phase 2 settlements will join against it. Nothing here or later converts a facility collection
-- into practitioner income without a settlement row saying so.

create table if not exists practice_payment (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  patient_id uuid references practice_patient(id) on delete set null,
  payer_kind text not null default 'patient',
  payer_label text,
  amount_minor bigint not null,
  currency text not null,
  method text not null,
  collector text not null default 'practitioner',
  reference text,
  paid_at timestamptz not null,
  location_id uuid references practice_location(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_payment drop constraint if exists practice_payment_amount_check;
alter table practice_payment add constraint practice_payment_amount_check
  check (amount_minor > 0);
alter table practice_payment drop constraint if exists practice_payment_currency_check;
alter table practice_payment add constraint practice_payment_currency_check
  check (currency ~ '^[A-Z]{3}$');
alter table practice_payment drop constraint if exists practice_payment_method_check;
alter table practice_payment add constraint practice_payment_method_check
  check (method in ('cash', 'mobile_money', 'card', 'bank_transfer', 'other'));
alter table practice_payment drop constraint if exists practice_payment_collector_check;
alter table practice_payment add constraint practice_payment_collector_check
  check (collector in ('practitioner', 'facility', 'clinic', 'gateway', 'other'));
alter table practice_payment drop constraint if exists practice_payment_payer_check;
alter table practice_payment add constraint practice_payment_payer_check
  check (payer_kind in ('patient', 'insurer', 'corporate', 'facility', 'other'));

create index if not exists idx_practice_payment_patient
  on practice_payment(workspace_id, patient_id, paid_at desc);
create index if not exists idx_practice_payment_day
  on practice_payment(workspace_id, paid_at desc);

alter table practice_payment enable row level security;

-- Allocation: which invoice or charge a payment amount answers -- s3, split and partial payments both
-- fall out of this shape. Reconciliation of allocations against the payment amount is the engine's
-- arithmetic (a CHECK cannot sum a sibling table).
create table if not exists practice_payment_allocation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  payment_id uuid not null references practice_payment(id) on delete cascade,
  invoice_id uuid references practice_invoice(id) on delete set null,
  charge_id uuid references practice_charge(id) on delete set null,
  amount_minor bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_payment_allocation drop constraint if exists practice_allocation_amount_check;
alter table practice_payment_allocation add constraint practice_allocation_amount_check
  check (amount_minor > 0);
alter table practice_payment_allocation drop constraint if exists practice_allocation_target_check;
alter table practice_payment_allocation add constraint practice_allocation_target_check
  check (invoice_id is not null or charge_id is not null);

create index if not exists idx_practice_allocation_payment
  on practice_payment_allocation(payment_id);
create index if not exists idx_practice_allocation_invoice
  on practice_payment_allocation(workspace_id, invoice_id);

alter table practice_payment_allocation enable row level security;

-- ---- 5. RECEIPTS -- PAY-002 s6/s9 -------------------------------------------------------------------
--
-- A receipt is evidence of money actually received: one per payment, numbered, snapshotted at
-- creation and never updated. The release-register doctrine applies -- once a receipt exists, a copy
-- of that exact document may be outside the practice, so the row can never change.

create table if not exists practice_receipt (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  receipt_number text not null,
  payment_id uuid not null references practice_payment(id) on delete cascade,
  snapshot jsonb not null,
  issued_at timestamptz not null default now(),
  issued_by uuid
);

alter table practice_receipt drop constraint if exists practice_receipt_number_check;
alter table practice_receipt add constraint practice_receipt_number_check
  check (receipt_number ~ '^CP-RCT-[0-9]{4}-[0-9]{5,7}$');

create unique index if not exists ux_practice_receipt_number
  on practice_receipt (workspace_id, receipt_number);
create unique index if not exists ux_practice_receipt_payment
  on practice_receipt (payment_id);

alter table practice_receipt enable row level security;

-- ---- 6. ADJUSTMENTS -- PAY-001 s7, PAY-002 s14 ------------------------------------------------------
--
-- Discounts, waivers, corrections and refunds are ROWS, never edits. A refund references the payment
-- it reverses and does not erase it. write_off is deliberately absent -- s14 marks it future.

create table if not exists practice_billing_adjustment (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  invoice_id uuid references practice_invoice(id) on delete set null,
  charge_id uuid references practice_charge(id) on delete set null,
  payment_id uuid references practice_payment(id) on delete set null,
  kind text not null,
  amount_minor bigint not null,
  currency text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table practice_billing_adjustment drop constraint if exists practice_adjustment_kind_check;
alter table practice_billing_adjustment add constraint practice_adjustment_kind_check
  check (kind in ('discount', 'waiver', 'correction', 'refund'));
alter table practice_billing_adjustment drop constraint if exists practice_adjustment_amount_check;
alter table practice_billing_adjustment add constraint practice_adjustment_amount_check
  check (amount_minor > 0);
alter table practice_billing_adjustment drop constraint if exists practice_adjustment_currency_check;
alter table practice_billing_adjustment add constraint practice_adjustment_currency_check
  check (currency ~ '^[A-Z]{3}$');
alter table practice_billing_adjustment drop constraint if exists practice_adjustment_reason_check;
alter table practice_billing_adjustment add constraint practice_adjustment_reason_check
  check (char_length(btrim(reason)) between 3 and 500);
alter table practice_billing_adjustment drop constraint if exists practice_adjustment_target_check;
alter table practice_billing_adjustment add constraint practice_adjustment_target_check
  check (invoice_id is not null or charge_id is not null or payment_id is not null);
-- A refund reverses a payment, so a refund names one.
alter table practice_billing_adjustment drop constraint if exists practice_adjustment_refund_check;
alter table practice_billing_adjustment add constraint practice_adjustment_refund_check
  check (kind <> 'refund' or payment_id is not null);

create index if not exists idx_practice_adjustment_invoice
  on practice_billing_adjustment(workspace_id, invoice_id);

alter table practice_billing_adjustment enable row level security;

-- ---- 7. CAPABILITIES --------------------------------------------------------------------------------

insert into practice_role_capabilities (role_code, capability_code) values
  ('practice_owner', 'billing.view'),
  ('practice_owner', 'fee.manage'),
  ('practice_owner', 'invoice.draft'),
  ('practice_owner', 'invoice.issue'),
  ('practice_owner', 'payment.record'),
  ('practice_owner', 'billing.adjust'),
  ('practice_owner', 'billing.export'),
  ('practitioner', 'billing.view'),
  ('practitioner', 'fee.manage'),
  ('practitioner', 'invoice.draft'),
  ('practitioner', 'invoice.issue'),
  ('practitioner', 'payment.record'),
  ('practitioner', 'billing.adjust'),
  ('practitioner', 'billing.export'),
  ('billing_reporting', 'billing.view'),
  ('billing_reporting', 'billing.export')
on conflict (role_code, capability_code) do nothing;

-- ---- 8. NUMBER COUNTERS -----------------------------------------------------------------------------

create table if not exists practice_billing_number_counter (
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  doc_kind text not null check (doc_kind in ('invoice', 'receipt')),
  doc_year smallint not null check (doc_year between 2020 and 2200),
  last_sequence integer not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, doc_kind, doc_year)
);

alter table practice_billing_number_counter enable row level security;

-- ---- 9. INDEX NOTE ----------------------------------------------------------------------------------
-- All statements above are plain and splitter-safe. Everything below is the banner's concern.

-- ---- 10. THE ALLOCATOR -- one statement, no internal semicolon, migration 289's shape ----------------

create or replace function practice_next_billing_number(p_workspace_id uuid, p_doc_kind text, p_doc_year smallint)
returns integer
language sql
security invoker
set search_path = pg_catalog, public
as $$
  insert into practice_billing_number_counter (workspace_id, doc_kind, doc_year, last_sequence)
  values (p_workspace_id, p_doc_kind, p_doc_year, 1)
  on conflict (workspace_id, doc_kind, doc_year)
  do update set last_sequence = practice_billing_number_counter.last_sequence + 1, updated_at = now()
  returning last_sequence
$$;

revoke execute on function practice_next_billing_number(uuid, text, smallint) from public, anon, authenticated;
grant execute on function practice_next_billing_number(uuid, text, smallint) to service_role;

-- ---- 11. THE UPDATE GUARDS (plpgsql -- the reason for the banner) -----------------------------------

create or replace function practice_invoice_issued_guard()
returns trigger
language plpgsql
as $$
begin
  if old.invoice_number is not null and new.invoice_number is distinct from old.invoice_number then
    raise exception 'invoice number % is immutable', old.invoice_number;
  end if;
  if old.status = 'VOID' then
    raise exception 'invoice % is void and terminal', old.id;
  end if;
  if old.status = 'ISSUED' and (
    new.status not in ('ISSUED', 'VOID')
    or new.patient_id is distinct from old.patient_id
    or new.payer_kind is distinct from old.payer_kind
    or new.payer_label is distinct from old.payer_label
    or new.currency is distinct from old.currency
    or new.subtotal_minor is distinct from old.subtotal_minor
    or new.adjustment_total_minor is distinct from old.adjustment_total_minor
    or new.total_minor is distinct from old.total_minor
    or new.issue_date is distinct from old.issue_date
    or new.due_date is distinct from old.due_date
    or new.issued_snapshot is distinct from old.issued_snapshot
    or new.issued_at is distinct from old.issued_at
    or new.issued_by is distinct from old.issued_by
  ) then
    raise exception 'invoice % is issued; material changes need an adjustment or a void and reissue', old.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_practice_invoice_issued_guard on practice_invoice;
create trigger trg_practice_invoice_issued_guard
  before update on practice_invoice
  for each row execute function practice_invoice_issued_guard();

create or replace function practice_invoice_item_frozen_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce((select status from practice_invoice where id = coalesce(new.invoice_id, old.invoice_id)), 'DRAFT') <> 'DRAFT' then
    raise exception 'the line items of an issued invoice are frozen';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_practice_invoice_item_frozen on practice_invoice_item;
create trigger trg_practice_invoice_item_frozen
  before insert or update or delete on practice_invoice_item
  for each row execute function practice_invoice_item_frozen_guard();

create or replace function practice_receipt_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'receipt % is issued evidence of a payment and can never change', old.receipt_number;
end;
$$;
drop trigger if exists trg_practice_receipt_immutable on practice_receipt;
create trigger trg_practice_receipt_immutable
  before update on practice_receipt
  for each row execute function practice_receipt_immutable();

create or replace function practice_payment_frozen_guard()
returns trigger
language plpgsql
as $$
begin
  if new.amount_minor is distinct from old.amount_minor
    or new.currency is distinct from old.currency
    or new.method is distinct from old.method
    or new.collector is distinct from old.collector
    or new.payer_kind is distinct from old.payer_kind
    or new.patient_id is distinct from old.patient_id
    or new.paid_at is distinct from old.paid_at
  then
    raise exception 'payment % is a financial fact; corrections are refunds or adjustments, never edits', old.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_practice_payment_frozen on practice_payment;
create trigger trg_practice_payment_frozen
  before update on practice_payment
  for each row execute function practice_payment_frozen_guard();

notify pgrst, 'reload schema';
