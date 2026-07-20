-- Migration 045: Lock landlord/tenant tables with Row-Level Security
--
-- WHY: migrations 040-044 created plat_* + tenants + enterprises + audit_log
-- WITHOUT RLS. The app relies on RLS to protect data from the PUBLIC anon key
-- (which ships in the browser bundle), so these tables are currently readable by
-- anyone via the REST API — exposing tenant names, the platform audit trail,
-- subscriptions and plans, bypassing all in-code gating.
--
-- WHY THIS IS SAFE: every application read/write of these tables goes through the
-- service-role client (createAdminClient), which has BYPASSRLS and is unaffected
-- by RLS. NOTHING reads them via the anon/session client. So enabling RLS with NO
-- permissive policy locks the tables to the service role and closes the anon-key
-- hole WITHOUT breaking the app.
--
-- WHY NO RECURSION: no policy is created here, and nothing references the profiles
-- table — sidestepping the repo's known RLS-recursion pitfall (see
-- supabase/fix-super-admin-rls-recursion.sql). Deny-by-default for anon/authenticated;
-- service_role bypasses.
--
-- ROLLBACK (if ever needed): alter table <name> disable row level security;
-- Idempotent — enabling RLS twice is a no-op.

do $$
declare t text;
begin
  foreach t in array array[
    'tenants','enterprises','audit_log',
    'plat_tenant_status','plat_regions','plat_products','plat_plans','plat_subscriptions',
    'plat_feature_flags','plat_feature_flag_assignments','plat_org_templates','plat_audit_events',
    'plat_billing_accounts','plat_invoices','plat_platform_events','plat_support_tickets',
    'plat_idp_configs','plat_deployments'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;
