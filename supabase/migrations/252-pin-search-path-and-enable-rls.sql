-- ============================================================
-- MIGRATION 252: THE LAST FOUR UNPINNED DEFINERS, AND SIX TABLES WITH NO ROW SECURITY
-- COMP-SEC-001, closing out the sweep that migrations 249, 250 and 251 began
--
-- ----------------------------------------------------------------------------------------------------
-- Both lists were READ FROM THE DEPLOYED CATALOGUE, not from migration text, using the registries
-- migration 250 added -- plat_function_attributes() and plat_rls_registry(). Nothing in this repo could
-- read a function attribute before today, which is exactly why these four went unnoticed.
--
-- ---- 1. WHY AN UNPINNED search_path ON A SECURITY DEFINER FUNCTION IS A HOLE ------------------------
--
-- A security definer function runs as its owner -- here postgres. If its search_path is not fixed, the
-- CALLER chooses which schema each unqualified name resolves to. A caller who can create a table in a
-- schema earlier on their own search_path can make `profiles` mean THEIR profiles, and the function will
-- read it with the owner's authority and answer yes.
--
-- All four below decide authorization or write scores. Two of them, current_user_is_group_admin_for and
-- current_user_is_hospital_admin_for, are called from RLS policies across this database -- so the answer
-- they give IS the access decision.
--
-- WARNING: ALTER FUNCTION, NEVER create-or-replace. Replace resets the whole attribute set: a create-or-replace
-- that forgot to restate `security definer` would silently downgrade the function to security invoker and
-- break authorization everywhere, quietly. ALTER changes one attribute and touches nothing else. This is
-- the device migration 251 used for the same reason.

alter function public.current_user_is_group_admin_for(uuid)
  set search_path = pg_catalog, public;

alter function public.current_user_is_hospital_admin_for(uuid)
  set search_path = pg_catalog, public;

-- These two write competency scores rather than decide access, so the failure mode differs -- a hijacked
-- unqualified name would have them read and write the wrong tables with the owner's authority. Same fix.
alter function public.recalculate_competency_score(uuid, uuid)
  set search_path = pg_catalog, public;

alter function public.recalculate_domain_score(uuid, uuid)
  set search_path = pg_catalog, public;

-- ---- 2. SIX TABLES WERE CARRYING NO ROW SECURITY AT ALL ---------------------------------------------
--
-- Not "weak policies" -- RLS was OFF, so every policy-bearing check in this database simply did not apply
-- to them. With the anon key holding the usual table grants, they were readable and WRITABLE by anyone
-- with the public key.
--
-- WARNING: cycle_assessors is the one that matters most: it decides WHO ASSESSES WHOM. A row inserted there is
-- an authority claim.
--
-- WHY THIS IS SAFE TO DO NOW, AND WHY IT WOULD NOT HAVE BEEN LATER. All six are EMPTY -- verified live,
-- 0 rows each. Enabling RLS with no policies means deny-by-default, and a denied read of an empty table
-- returns the same zero rows an ungoverned read of an empty table returns. So nothing changes behaviour
-- today. What changes is that the first write from a browser client is now refused instead of accepted.
--
-- Do this once they hold data and the calculation inverts: the same statement would silently hide live
-- rows from every reader that is not the service role, and the failure would look like missing data
-- rather than a permission change.
--
-- WARNING: NO POLICIES ARE WRITTEN HERE, AND THAT IS DELIBERATE. Six tables, six different access questions,
-- and this file has evidence for none of them -- department_frameworks has no reference in src/ at all.
-- Inventing a policy is how a table ends up with a rule nobody chose. Deny-by-default is the honest
-- resting state, and it is this codebase's stated posture. Whoever builds the feature that fills one of
-- these tables writes its policy then, with the access question in front of them.
--
-- The 717 service-role callers are unaffected: service_role bypasses row level security entirely.

alter table public.content_approvals enable row level security;

alter table public.cycle_assessors enable row level security;

alter table public.department_frameworks enable row level security;

alter table public.framework_rules enable row level security;

alter table public.framework_versions enable row level security;

alter table public.practice_clinic enable row level security;

notify pgrst, 'reload schema';
