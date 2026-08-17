-- MIGRATION 311: THE PRACTICE PRODUCT DIRECTOR CAPABILITY MATRIX (CPR-PD-014 build 2)
--
-- PD-014 build 2: "Define server-side capabilities for module view plus privileged actions such as
-- provision, approve, activate, rollback, export, accept risk and change production flags" and, in its
-- own words, "Do not equate Product Director with Super Admin."
--
-- WHY THIS MIGRATION EXISTS AT ALL. Today the Practice product plane has three capability codes, and
-- every privileged Practice ACTION is gated on isSuper() rather than on any of them -- provisioning a
-- practice, changing production launch flags, and the operator user search. That breaks in both
-- directions at once. A real Practice Product Director opens the console the position exists for and
-- every button refuses them, because the two Practice pages are read-only for anybody who is not an
-- owner. And any super_admin performs the products most dangerous writes while holding no HQ position
-- at all, so the HQ plane records nothing and governs nothing.
--
-- !! CAPABILITIES AND GRANTS SHIP IN THE SAME MIGRATION, AND THAT IS NOT TIDINESS.
-- This estate has twice inserted a capability catalogue without the grant that makes it reachable, and
-- twice locked existing holders out while every harness stayed green (migrations 303 and 305, healed by
-- 307). On the HQ plane the grant IS the backfill: resolveHqPositions reads hq_position_capability by
-- POSITION code, so a grant to a position reaches every live appointment to it immediately, with no
-- per-appointment write. A catalogue insert on its own would therefore be exactly as inert here, and
-- exactly as invisible.
--
-- !! AND MAKER-CHECKER MEANS THE DIRECTOR IS NOT THE APPROVER.
-- PD-014 build 2 asks for "maker-checker/segregation-of-duties hooks for high-risk configuration,
-- release and governance actions". A separation where the same position holds both halves is not a
-- separation. So hq.practice.change.approve and hq.practice.risk.accept are deliberately NOT granted to
-- practice_product_director: the Director proposes, somebody else disposes. If the owner decides a
-- Director may accept low-severity risk unaided, that is a governance decision to record, not a default
-- to assume -- and the safer default is the one that can be widened later without an incident.
--
-- !! WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: create new HQ positions. PD-014 names five roles to
-- map -- Product Director, HQ administrator, specialist approver, support/operations and read-only --
-- and only three have a seeded equivalent (practice_product_director, platform_director,
-- quality_council_member, plus chief_executive above them). Inventing a support-operations position or
-- a read-only position would be inventing governance, which is the owners to decide. Reported, not
-- assumed.

-- -- 1. THE MODULE VIEW CAPABILITIES, ONE PER FROZEN DESTINATION ----------------------------------
--
-- PD-001 s7 requires that sidebar visibility be capability and entitlement driven, and that access is
-- never hard-coded from a job title alone. Twelve destinations, so twelve view capabilities. The
-- existing hq.practice.operations.view is the twelfth and already
-- exists and is not restated here -- inserting it again would either conflict or silently do nothing,
-- and either way would hide whether the row it depends on is really present.

insert into hq_capability (code, space, label, description) values
  ('hq.practice.mission.view',       'practice', 'Practice Mission Control',   'Practice product command centre, exceptions and priorities'),
  ('hq.practice.practices.view',     'practice', 'Practices',                  'Practice estate, lifecycle and Practice 360'),
  ('hq.practice.practitioners.view', 'practice', 'Practitioners',              'Practitioner estate, activation and Practitioner 360'),
  ('hq.practice.intelligence.view',  'practice', 'Product Intelligence',       'Usage, adoption, cohorts and product performance'),
  ('hq.practice.adoption.view',      'practice', 'Adoption and Growth',        'Acquisition, onboarding, activation and retention'),
  ('hq.practice.commercial.view',    'practice', 'Commercial',                 'Plans, trials, subscriptions, conversion and revenue signals'),
  ('hq.practice.health.view',        'practice', 'Product Health',             'Service health and product-facing reliability'),
  ('hq.practice.support.view',       'practice', 'Support and Incidents',      'Support demand, incidents, escalation and resolution'),
  ('hq.practice.governance.view',    'practice', 'Governance and Risk',        'Product risk, controls, obligations, decisions and evidence'),
  ('hq.practice.configuration.view', 'practice', 'Product Configuration',      'Product-level configurable settings and controlled change'),
  ('hq.practice.releases.view',      'practice', 'Releases and Capabilities',  'Capability registry, releases, rollout and launch controls')
on conflict (code) do nothing;

-- -- 2. THE PRIVILEGED ACTIONS --------------------------------------------------------------------
--
-- Named for the ACT, not for the screen that offers it, because PD-014s exit gate is that "direct
-- URL/API tests prove that hidden UI controls cannot be invoked without the required capability" -- an
-- API route has no screen to be named after, and the same act reachable from two places must ask for
-- the same thing in both.

insert into hq_capability (code, space, label, description) values
  ('hq.practice.provision.execute', 'practice', 'Provision a Practice',        'Create a Practice workspace through the provisioning saga'),
  ('hq.practice.flags.manage',      'practice', 'Change Production Flags',     'Change Practice launch flags on the live product'),
  ('hq.practice.release.activate',  'practice', 'Activate a Release',          'Activate a capability, release or rollout stage'),
  ('hq.practice.release.rollback',  'practice', 'Roll Back a Release',         'Withdraw or roll back a capability, release or rollout'),
  ('hq.practice.export.execute',    'practice', 'Export Practice Data',        'Export product data out of the Practice plane'),
  ('hq.practice.change.approve',    'practice', 'Approve a Controlled Change', 'The checker half of maker-checker on configuration, release and governance change'),
  ('hq.practice.risk.accept',       'practice', 'Accept Product Risk',         'Record formal acceptance of a Practice product risk'),
  -- Configuration CHANGE, distinct from configuration VIEW above. Added when the five operator routes
  -- were converted and one of them turned out to change the practitioner-number format, which is a
  -- product configuration write that none of the other action codes honestly describes. Gating a write
  -- on a .view capability would have made the matrix say something untrue about what it permits.
  ('hq.practice.configuration.manage', 'practice', 'Change Product Configuration', 'Change Practice product configuration and identifier formats')
on conflict (code) do nothing;

-- -- 3. THE GRANTS --------------------------------------------------------------------------------
--
-- !! THE DIRECTOR SEES EVERY MODULE AND OPERATES THE PRODUCT, BUT DOES NOT APPROVE ITS OWN CHANGES.
-- Twelve views, and the four acts that are the job: provisioning a practice, changing the launch flags,
-- activating a release and rolling one back. Approval and risk acceptance are withheld by design -- see
-- the maker-checker note at the top.
--
-- The insert..select against existing rows is how this stays re-runnable: `on conflict do nothing`
-- cannot be used, because hq_position_capability has no unique constraint on (position, capability) --
-- it is a temporal table with effective_from/effective_to, and a UNIQUE index there would forbid the
-- regrant-after-revoke that the temporal columns exist to allow.

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('practice_product_director')) as p(code)
cross join (values
  ('hq.practice.mission.view'),
  ('hq.practice.practices.view'),
  ('hq.practice.practitioners.view'),
  ('hq.practice.intelligence.view'),
  ('hq.practice.adoption.view'),
  ('hq.practice.commercial.view'),
  ('hq.practice.health.view'),
  ('hq.practice.support.view'),
  ('hq.practice.governance.view'),
  ('hq.practice.configuration.view'),
  ('hq.practice.releases.view'),
  ('hq.practice.provision.execute'),
  ('hq.practice.flags.manage'),
  ('hq.practice.release.activate'),
  ('hq.practice.release.rollback'),
  ('hq.practice.export.execute'),
  ('hq.practice.configuration.manage')
) as c(code)
where not exists (
  select 1 from hq_position_capability x
  where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
);

-- !! THE CHECKER HALF, HELD BY POSITIONS ABOVE AND BESIDE THE DIRECTOR.
-- platform_director is the HQ administrator PD-014 names, and quality_council_member is its specialist
-- approver -- PD-010 makes Governance and Risk the owner of accountable decisions and risk acceptance,
-- and the Quality space is where that council sits. chief_executive holds both because an executive who
-- cannot approve anything is an escalation path that dead-ends.

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('platform_director'), ('chief_executive')) as p(code)
cross join (values ('hq.practice.change.approve')) as c(code)
where not exists (
  select 1 from hq_position_capability x
  where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
);

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('quality_council_member'), ('chief_executive')) as p(code)
cross join (values ('hq.practice.risk.accept'), ('hq.practice.governance.view')) as c(code)
where not exists (
  select 1 from hq_position_capability x
  where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
);

-- !! AND THE HQ ADMINISTRATOR CAN SEE WHAT IT APPROVES. Approving a change to a module you cannot open
-- is a rubber stamp with extra steps, so platform_director gets the three views its approvals touch.

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('platform_director')) as p(code)
cross join (values
  ('hq.practice.configuration.view'),
  ('hq.practice.releases.view'),
  ('hq.practice.governance.view')
) as c(code)
where not exists (
  select 1 from hq_position_capability x
  where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
);

notify pgrst, 'reload schema';
