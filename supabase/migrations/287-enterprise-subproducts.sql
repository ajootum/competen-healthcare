-- ====================================================================================================
-- MIGRATION 287: THE EIGHT ENTERPRISE SUB-PRODUCTS -- A DIMENSION OF THE LINE, NOT PEERS OF IT
--
-- ENT-DEC-001 D3, taken by the owner on 2026-08-11. Sibling of migration 281, which froze the five
-- product lines this file deliberately does not touch.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- ENT-GOV-001 section 2 requires eight Product Owner appointments -- Workforce, Assessment, Competency,
-- Learning, Mock Code, Quality, Simulation, Intelligence -- and an appointment binds to a product line
-- by foreign key onto plat_product_line, a frozen five-row taxonomy. A Workforce Product Owner
-- appointment is therefore LITERALLY UNWRITABLE today. This file makes it writable without adding a
-- single row to the frozen taxonomy.
--
--     plat_product_line (5, FROZEN, untouched here)
--       platform | enterprise | individual | practice | recruitment
--                      |
--                      v
--     plat_enterprise_subproduct (8, created here)
--       workforce | assessment | competency | learning | mock_code | quality | simulation | intelligence
--
-- ----------------------------------------------------------------------------------------------------
-- READ THIS BEFORE APPLYING.
--
-- NOTHING GRANTS ANYTHING. This file creates a catalogue and two NULLABLE columns. Every existing
-- appointment keeps a null subproduct_code, which means what it meant yesterday: the appointment covers
-- its whole product line. No access path changes, nobody gains authority and nobody loses it.
--
-- ----------------------------------------------------------------------------------------------------
-- LIVE STATE READ BACK BEFORE WRITING THIS FILE (probed, not assumed from a migration):
--
--   plat_product_line             5 rows: enterprise, individual, platform, practice, recruitment
--   plat_enterprise_subproduct    does not exist (PGRST205 on a REAL select -- head+count returns
--                                 count null with no error on a missing table and proves nothing)
--   hq_position                   keyed on code, carries product_line_code, no subproduct column
--   ogs_office_appointments       2 rows, carries product_line_code, no subproduct column
--   plat_products                 8 engine codes: coe, competency, lms, mclip, passport, pce,
--                                 practice, simulation
--
-- ----------------------------------------------------------------------------------------------------
-- !! THE STRING COLLISION, NAMED SO NOBODY JOINS ACROSS IT.
--
-- Two of the eight codes below -- competency and simulation -- ALSO exist as engine codes in
-- plat_products, where they name a different thing (a platform engine, not an Enterprise sub-product).
-- Migration 281 header warned about exactly this bug class when plat_plans and plat_product_line both
-- held the string enterprise. The rule: THE TWO AXES ARE NEVER JOINED BY STRING. A sub-product code is
-- only meaningful against plat_enterprise_subproduct, an engine code only against plat_products, and any
-- query that feeds one into the other is wrong even when it appears to work.
--
-- The spec document ids (ENT-WF-001, ENT-ASMT-001, ...) are carried in spec_code as data, so the
-- catalogue can cite its sources without the codes themselves leaving the house style.
--
-- ----------------------------------------------------------------------------------------------------
-- THE TRAPS THIS FILE WAS WRITTEN AROUND (the 279 list, mechanically checked by
-- scripts/migration-house-rules.ts before sending):
--
--   1. NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT, INCLUDING INSIDE A COMMENT.
--   2. NO -- SEQUENCE INSIDE A STRING LITERAL.
--   3. NO do-blocks, no plpgsql, no functions. Plain statements only.
--   4. UPSERT TARGETS ARE FULL UNIQUE INDEXES OR PRIMARY KEYS. Never partial.
--   5. ASCII ONLY.
--   6. notify pgrst LAST.
-- ====================================================================================================


-- ---- 1. THE CATALOGUE ------------------------------------------------------------------------------
--
-- Keyed on code, like plat_product_line, because the code is what an appointment names and what the
-- registry work under ENT-DEC-001 D5 will key navigation on. The house code shape is enforced by CHECK
-- so a spec-style id like ENT-WF cannot arrive here by accident -- it lives in spec_code.
create table if not exists plat_enterprise_subproduct (
  code text primary key,

  -- WELDED TO THE ENTERPRISE LINE, AND THE CHECK IS THE DECISION. D3 says the eight are a dimension OF
  -- the enterprise line. A foreign key alone would let a later row claim a different line and quietly
  -- become the sixth product line by the back door -- the exact mistake the frozen taxonomy exists to
  -- prevent. The column stays explicit rather than implicit so joins read naturally, and the CHECK
  -- makes any other value unwritable.
  product_line_code text not null default 'enterprise' references plat_product_line(code),

  name text not null,
  description text not null,

  -- The governing specification document, as data. ENT-DEC-001 D8 records that document ids in this
  -- programme have already collided once, so the catalogue cites its sources explicitly.
  spec_code text not null,

  sort integer not null default 0,

  -- A sub-product that is withdrawn is deactivated, never deleted: an appointment may still reference
  -- it, and a dangling reference to a deleted catalogue row is a question nobody can answer later.
  is_active boolean not null default true,

  created_at timestamptz not null default now()
);

alter table plat_enterprise_subproduct drop constraint if exists plat_ent_subproduct_code_shape;
alter table plat_enterprise_subproduct add constraint plat_ent_subproduct_code_shape
  check (code ~ '^[a-z][a-z0-9_]{1,40}$');

alter table plat_enterprise_subproduct drop constraint if exists plat_ent_subproduct_line_welded;
alter table plat_enterprise_subproduct add constraint plat_ent_subproduct_line_welded
  check (product_line_code = 'enterprise');

alter table plat_enterprise_subproduct enable row level security;

-- A catalogue of product names is not sensitive, and the tenant switcher and navigation will want it
-- from the browser. Reads only. There is no insert, update or delete policy: the catalogue changes by
-- migration or by the service role, never from a browser session.
drop policy if exists plat_ent_subproduct_read on plat_enterprise_subproduct;
create policy plat_ent_subproduct_read on plat_enterprise_subproduct
  for select to authenticated using (true);

comment on table plat_enterprise_subproduct is
  'ENT-DEC-001 D3. The eight independently saleable sub-products of the Competen Enterprise line, as a dimension OF that line. This is NOT plat_product_line (the frozen five-line taxonomy) and it is NOT plat_products (the engine catalogue). The strings competency and simulation exist in plat_products with a different meaning, and the two axes are never joined by string.';

comment on column plat_enterprise_subproduct.spec_code is
  'The governing specification document id. Data, not a key: document ids in this programme have collided once already (ENT-DEC-001 D8), so the catalogue cites sources explicitly rather than by convention.';


-- ---- 2. THE EIGHT ROWS -----------------------------------------------------------------------------
--
-- ON CONFLICT against the PRIMARY KEY, so this file is safe to run twice. The names and the order are
-- ENT-001 section 7 and the composition architecture -- Workforce first because it is the stated First
-- Saleable Enterprise Sub-product and everything else consumes its people and structures.
insert into plat_enterprise_subproduct (code, name, description, spec_code, sort) values
  ('workforce',    'Workforce',    'Workforce and organisation management. The canonical people, positions, appointments and structures every other sub-product consumes.', 'ENT-WF-001',   1),
  ('assessment',   'Assessment',   'Assessment management. Versioned instruments, item banks, delivery, scoring, review and results.',                                       'ENT-ASMT-001', 2),
  ('competency',   'Competency',   'Competency management. Frameworks, role profiles, evidence, determination, gaps and revalidation.',                                      'ENT-COMP-001', 3),
  ('learning',     'Learning',     'Learning and development. Catalogue, programmes, enrolment, delivery, completion, CPD and certification.',                              'ENT-LRN-001',  4),
  ('mock_code',    'Mock Code',    'Mock code and readiness. Emergency drill programmes, live capture, debrief, findings and verification.',                                'ENT-MC-001',   5),
  ('quality',      'Quality',      'Quality and improvement. Standards, audits, findings, actions, verification, effectiveness and indicators.',                            'ENT-QLT-001',  6),
  ('simulation',   'Simulation',   'Simulation management. Programmes, scenarios, sessions, resources, debrief and outcomes.',                                             'ENT-SIM-001',  7),
  ('intelligence', 'Intelligence', 'Enterprise intelligence and analytics. Governed measures, dashboards, reports, alerts and insights.',                                  'ENT-INT-001',  8)
on conflict (code) do nothing;


-- ---- 3. APPOINTMENTS MAY NOW NAME A SUB-PRODUCT ----------------------------------------------------
--
-- NULLABLE, AND NULL KEEPS ITS CURRENT MEANING: the appointment covers its whole product line. Every
-- existing row is untouched. A Workforce Product Owner is an enterprise-line appointment that also
-- names workforce -- which the CHECK below enforces, because a sub-product appointment on any OTHER
-- line would be the two axes conflated, this time through the appointments table.
alter table hq_position add column if not exists subproduct_code text references plat_enterprise_subproduct(code);

-- !! coalesce, NOT a bare equality. A CHECK fails only on FALSE, and null = anything is NULL -- so
-- without the coalesce a position with NO product line at all could take a sub-product, which is the
-- conflation arriving through the one row shape nobody thought about. Same trap family as migration
-- 256, where is-not-null passed a blank string.
alter table hq_position drop constraint if exists hq_position_subproduct_needs_enterprise;
alter table hq_position add constraint hq_position_subproduct_needs_enterprise
  check (subproduct_code is null or coalesce(product_line_code, '') = 'enterprise');

alter table ogs_office_appointments add column if not exists subproduct_code text references plat_enterprise_subproduct(code);

alter table ogs_office_appointments drop constraint if exists ogs_appt_subproduct_needs_enterprise;
alter table ogs_office_appointments add constraint ogs_appt_subproduct_needs_enterprise
  check (subproduct_code is null or coalesce(product_line_code, '') = 'enterprise');

comment on column hq_position.subproduct_code is
  'ENT-DEC-001 D3. Null means the position covers its whole product line, which is every position before migration 287. Non-null narrows an ENTERPRISE-line position to one sub-product, and the CHECK refuses it on any other line.';

comment on column ogs_office_appointments.subproduct_code is
  'ENT-DEC-001 D3. Null means the appointment covers its whole product line. Non-null narrows an ENTERPRISE-line appointment to one sub-product, and the CHECK refuses it on any other line.';


-- ---- 4. TELL PostgREST ------------------------------------------------------------------------------
notify pgrst, 'reload schema';
