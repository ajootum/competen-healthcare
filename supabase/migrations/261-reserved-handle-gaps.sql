-- ============================================================
-- MIGRATION 261: THE RESERVED HANDLE GAPS
-- PIS-000 s4, and the routing shape settled 2026-08-08 (docs/PLAT-ARCH-SURVEY-001.md)
--
-- ----------------------------------------------------------------------------------------------------
-- Migration 218 created practice_reserved_handle with 32 names and said why a table rather than a
-- constant: "so the list can grow without a deploy". This is that growth, and it is the last cheap moment
-- to do it.
--
-- WHY NOW. The settled tenant URL puts the handle in the FIRST path segment -- /practice/{handle}/... --
-- so from this point a handle is not only a name on a public profile, it is a piece of routing. Two
-- classes of name become dangerous at that moment: names that COLLIDE with a static segment already
-- serving under /practice, and names that IMPERSONATE the operator.
--
-- WHY IT IS NOT URGENT, SAID PLAINLY SO NOBODY LATER READS PANIC INTO THIS FILE. Verified live before
-- writing: practice_public_signup is OFF, so no stranger can create an account at all. Zero of the 32
-- practitioner identities have claimed any handle, and practice_handle_history is empty. The exposure is
-- an already-provisioned practitioner picking one of these names before the operator does.
--
-- WARNING: RESERVING A NAME DOES NOT REVOKE AN EXISTING CLAIM. Nothing links this table to
-- practice_practitioner_identity.handle -- identity-service.ts says so in terms, and the reserved check
-- is a READ at claim time, not a constraint. Applying this file to a database where somebody already
-- holds one of these names would leave them holding it. Zero are held today, which is why this is safe
-- to apply now and would not be later.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while the
-- editor still reported success.
-- ============================================================

-- ---- 1. WHAT IS NOT HERE, AND WHY THE LIST IS SHORTER THAN IT LOOKS --------------------------------
--
-- WARNING: 'hq' IS ABSENT AND CANNOT BE ADDED. The column check is '^[a-z][a-z0-9]{2,29}$', which is a
-- minimum of THREE characters. A two-character name cannot be inserted here and cannot be claimed on
-- practice_practitioner_identity either -- both refusals were observed live rather than reasoned about.
-- The survey listed 'hq' as an open gap. It is not a gap, it is an impossibility, and an INSERT naming it
-- would fail this whole migration on a check constraint.
--
-- The same regex retires eight more candidates for free, because it forbids hyphens: access-status,
-- patient-booking, patient-login, select-workspace, sign-in, sign-up, follow-ups and knowledge-studio are
-- all live route segments that no handle can ever spell.
--
-- Names with no rationale were left out DELIBERATELY rather than swept in for safety: 'new', 'edit',
-- 'profile', 'dashboard' and 'team' collide with nothing at the tenant position and impersonate nobody.
-- 218's own argument cuts this way -- the list can grow without a deploy, so the cost of adding a name
-- later is one INSERT, while every name reserved without cause is a name taken from a real practitioner.

-- ---- 2. ROUTING COLLISIONS -------------------------------------------------------------------------
--
-- Read off the filesystem rather than recalled: every static directory under src/app/practice and
-- src/app/practice/(shell) that the handle regex permits. A static segment OUTRANKS a dynamic one in
-- Next's matcher, so the failure here is not that a stranger reaches the platform route -- it is that the
-- practitioner who claimed the name becomes permanently unreachable at their own address, while the
-- product goes on telling them it is theirs.
--
-- WARNING: THIS SET IS ONLY TRUE FOR THE ROUTE TREE AS IT STANDS TODAY. A new static segment added under
-- /practice after this file is a new collision, and nothing in the database will notice. That belongs in
-- the routing work as an assertion over the build manifest, not in a seed list.
insert into practice_reserved_handle (handle, reason) values
  ('activity', 'routing'), ('assistant', 'routing'), ('calendar', 'routing'), ('cases', 'routing'),
  ('documentation', 'routing'), ('documents', 'routing'), ('encounters', 'routing'), ('home', 'routing'),
  ('inbox', 'routing'), ('intelligence', 'routing'), ('join', 'routing'), ('medications', 'routing'),
  ('messages', 'routing'), ('offline', 'routing'), ('onboarding', 'routing'), ('pathways', 'routing'),
  ('patients', 'routing'), ('people', 'routing'), ('portfolio', 'routing'), ('reflection', 'routing'),
  ('reports', 'routing'), ('setup', 'routing'), ('start', 'routing'), ('tasks', 'routing'),
  ('today', 'routing')
on conflict (handle) do nothing;

-- ---- 3. IMPERSONATION ------------------------------------------------------------------------------
--
-- These are the names that would let a handle speak AS the operator. 218 already reserved the obvious
-- brand terms -- competen, competenpractice, practice -- and the governance vocabulary settled this week
-- adds the rest. 'gov' and 'docs' are the two the survey found genuinely open, and both were confirmed
-- insertable by probe, which is how the regex point above came to light.
--
-- 'staff', 'official', 'verified' and 'operator' are here for a different reason from the others: none of
-- them is a route. They are the words a reader uses to decide whether a public profile is endorsed, and a
-- handle is the one part of that page the operator does not write.
insert into practice_reserved_handle (handle, reason) values
  ('gov', 'platform'), ('governance', 'platform'), ('platform', 'platform'),
  ('superadmin', 'platform'), ('operator', 'platform'), ('official', 'platform'),
  ('verified', 'platform'), ('staff', 'platform'), ('docs', 'platform'), ('status', 'platform'),
  ('competenhealthcare', 'brand')
on conflict (handle) do nothing;

-- ---- 4. INFRASTRUCTURE AND LITERALS ----------------------------------------------------------------
--
-- The infrastructure names do not collide with anything under /practice today. They are reserved against
-- the shape the routing work may take next -- a host segment rather than a path segment -- where 'www' and
-- 'app' stop being ordinary words. Cheap now, and unreclaimable if a practitioner takes one first,
-- because changeHandle retires a released handle permanently.
--
-- The literals are a narrower point. A handle of 'null' or 'undefined' produces a URL that is
-- indistinguishable from a bug in every log, ticket and screenshot it ever appears in.
insert into practice_reserved_handle (handle, reason) values
  ('www', 'routing'), ('app', 'routing'), ('cdn', 'routing'), ('static', 'routing'),
  ('assets', 'routing'), ('mail', 'routing'), ('dev', 'routing'), ('staging', 'routing'),
  ('auth', 'routing'), ('oauth', 'routing'),
  ('null', 'routing'), ('undefined', 'routing'), ('none', 'routing')
on conflict (handle) do nothing;

-- ---- 5. RLS ----------------------------------------------------------------------------------------
--
-- Already enabled by 218 and re-asserted here for the reason the house style re-asserts it everywhere:
-- a table whose protection depends on a migration nobody re-reads is a table one CREATE away from being
-- readable by anon. Idempotent, so it costs nothing to say twice.
alter table practice_reserved_handle enable row level security;

notify pgrst, 'reload schema';
