-- 282 - PLAT-GOV-MC-001 section 7: tenant and operational Mission Control profiles
--
-- WHAT THIS DOES AND, MORE IMPORTANTLY, WHAT IT DOES NOT.
--
-- It seeds the PROFILES section 7 names and teaches the registry to express the two things those profiles
-- need that the HQ ones never did: a capability from a different access PLANE, and a SCOPE.
--
-- It seeds NO WIDGETS for them, and that is a finding rather than an omission. Three things block a real
-- tenant widget today and none is fixed by writing rows:
--
--   1. SCOPE. Section 7 requires tenant Mission Control to be "generated from the customer hierarchy and
--      the active appointment". The composition resolver has no concept of a tenant scope at all - it
--      resolves a profile, never a subject - so a widget asking "how many patients does THIS practice
--      have" has nowhere to read the practice from.
--   2. CONSUMER. Only /super-admin composes a dashboard. A Practice Owner is in /practice, a Unit Manager
--      in /unit-manager, and neither composes anything. Widgets nothing renders are the promise-on-a-screen
--      this project keeps having to remove.
--   3. DATA BOUNDARY. Section 8 is explicit that an HQ Super Admin may NOT read patient clinical records
--      and a Practice Product Director may NOT read practitioner patient information. The only surface that
--      could render a tenant profile today is the OWNER PREVIEW - so seeding a Practice Owner widget over
--      patient data would build the exact disclosure section 8 forbids, and call it configuration.
--
-- So the profiles land, the registry gains the columns they need, and each row says in its own description
-- what is missing. An owner previewing one sees a named frame and an honest empty state.

-- SCOPE TYPE - section 7. Which node in the customer hierarchy an appointment to this profile is rooted at.
alter table hq_mission_profile add column if not exists scope_type text not null default 'none';
alter table hq_mission_profile drop constraint if exists hq_mission_profile_scope_known;
alter table hq_mission_profile add constraint hq_mission_profile_scope_known
  check (scope_type in ('none', 'tenant', 'practice', 'facility', 'department', 'unit'));

-- CAPABILITY PLANE - which authorization plane required_capability belongs to. The three planes are the
-- ones this product already has: landlord/HQ, the practice tenant plane, and the hospital estate.
alter table hq_mission_widget add column if not exists capability_plane text not null default 'hq';
alter table hq_mission_widget drop constraint if exists hq_mission_widget_plane_known;
alter table hq_mission_widget add constraint hq_mission_widget_plane_known
  check (capability_plane in ('hq', 'practice', 'estate'));

-- !! THE FOREIGN KEY TO hq_capability IS DROPPED, AND THAT IS A LOOSENING THAT NEEDS A COMPENSATING CONTROL.
-- It could only ever have held for one of the three planes, so a widget in the practice or estate plane was
-- literally unwritable - the probe that proved it is in the commit. Postgres cannot express a conditional
-- foreign key, so the check moves into code: the catalogue for each plane lives in TypeScript and the
-- harness asserts that every seeded widget names a capability its declared plane actually contains. A
-- capability the database holds and the code has never heard of still grants nothing at runtime, which is
-- the rule this whole programme already runs on.
alter table hq_mission_widget drop constraint if exists hq_mission_widget_required_capability_fkey;

-- DATA CLASSIFICATION - GOV-001 section 8. A widget states the sensitivity of what it reads so the boundary
-- is a property of the configuration rather than an argument somebody has to remember to have.
alter table hq_mission_widget add column if not exists data_classification text not null default 'internal';
alter table hq_mission_widget drop constraint if exists hq_mission_widget_classification_known;
alter table hq_mission_widget add constraint hq_mission_widget_classification_known
  check (data_classification in ('public', 'internal', 'confidential', 'restricted', 'highly_restricted'));

-- The existing three practice-operations widgets are administrative, not clinical.
update hq_mission_widget set capability_plane = 'hq', data_classification = 'internal'
  where code in ('practice_total', 'practice_provisioning_queue', 'practice_launch_flags');

-- -- The profiles from section 7 ----------------------------------------------------------------------
--
-- !! NONE OF THESE CAN CHANGE WHO SEES WHAT. resolveMissionProfile selects a product profile only when
-- governance_level is 'product', and otherwise falls back to hq_super_admin. Every row below is 'tenant' or
-- 'operational', so seeding them is inert for resolution - they are reachable only through the owner
-- preview picker, which is exactly the consumer section 7 needs and the only one that exists.
insert into hq_mission_profile (code, name, governance_level, product_line_code, scope_type, priority, description) values
  ('tenant_enterprise_admin', 'Enterprise Administrator Mission Control', 'tenant', 'enterprise', 'tenant', 300,
   'Section 7: tenant health, users, facilities, licensed capabilities, governance, configuration, support. No widgets yet - the composition resolver cannot yet resolve WHICH tenant, so every widget would have no subject to read.'),
  ('tenant_nursing_director', 'Nursing Director Mission Control', 'tenant', 'enterprise', 'department', 310,
   'Section 7: workforce, acuity, competency, learning, quality, escalations, scoped to a nursing service. No widgets yet - awaits scope resolution from the customer hierarchy.'),
  ('tenant_practice_owner', 'Practice Owner Mission Control', 'tenant', 'practice', 'practice', 320,
   'Section 7: appointments, patients, team, locations, practice health, subscription. No widgets yet - and note that most of that list is CLINICAL, so its widgets must carry a data classification and be rendered only inside the practice, never through an HQ preview.'),
  ('tenant_practice_admin', 'Practice Administrator Mission Control', 'tenant', 'practice', 'practice', 330,
   'Section 7: bookings, registration, schedule conflicts, communications and permitted admin tasks within a delegated practice scope. No widgets yet.'),
  ('operational_nurse_educator', 'Nurse Educator Mission Control', 'operational', 'enterprise', 'facility', 400,
   'Section 7: learners, competency gaps, courses, assessments, overdue learning across assigned facilities or units. No widgets yet.'),
  ('operational_unit_manager', 'Unit Manager Mission Control', 'operational', 'enterprise', 'unit', 410,
   'Section 7: staffing, acuity, competency, due assessments, quality issues for a single unit. No widgets yet - /unit-manager renders its own dashboard and does not compose from this registry.')
on conflict (code) do update set
  name = excluded.name,
  governance_level = excluded.governance_level,
  product_line_code = excluded.product_line_code,
  scope_type = excluded.scope_type,
  priority = excluded.priority,
  description = excluded.description;

-- The three existing profiles need no scope backfill: scope_type is NOT NULL DEFAULT 'none', so adding the
-- column already filled them, and an update looking for nulls could never match a row.

notify pgrst, 'reload schema';
