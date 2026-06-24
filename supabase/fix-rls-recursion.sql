-- Fix: infinite recursion in profiles RLS policy
-- The "Admins view hospital nurses" policy queried profiles from within a profiles policy,
-- causing infinite recursion (error 42P17) that broke all course enrollment reads.

-- Step 1: Create a SECURITY DEFINER helper that bypasses RLS when checking admin role
-- This is the standard Supabase pattern to avoid recursive policies.
create or replace function public.current_user_is_hospital_admin_for(target_hospital_id uuid)
returns boolean
language sql
security definer stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'hospital_admin'
      and hospital_id = target_hospital_id
  );
$$;

-- Step 2: Drop the recursive policy and recreate it using the helper function
drop policy if exists "Admins view hospital nurses" on profiles;

do $$ begin
  create policy "Admins view hospital nurses"
    on profiles for select
    using (
      auth.uid() = id
      or current_user_is_hospital_admin_for(hospital_id)
    );
exception when duplicate_object then null; end $$;

-- Step 3: Fix the other admin policies that also referenced profiles inside sub-selects
-- (those inner profiles queries would trigger the profiles RLS → same recursion)

drop policy if exists "Admins view hospital nurse competencies" on nurse_competencies;
drop policy if exists "Admins view hospital CPD logs" on cpd_logs;
drop policy if exists "Admins view hospital enrollments" on course_enrollments;

do $$ begin
  create policy "Admins view hospital nurse competencies"
    on nurse_competencies for select
    using (
      auth.uid() = user_id
      or exists (
        select 1 from profiles nurse
        where nurse.id = nurse_competencies.user_id
          and current_user_is_hospital_admin_for(nurse.hospital_id)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins view hospital CPD logs"
    on cpd_logs for select
    using (
      auth.uid() = user_id
      or exists (
        select 1 from profiles nurse
        where nurse.id = cpd_logs.user_id
          and current_user_is_hospital_admin_for(nurse.hospital_id)
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Admins view hospital enrollments"
    on course_enrollments for select
    using (
      auth.uid() = user_id
      or exists (
        select 1 from profiles nurse
        where nurse.id = course_enrollments.user_id
          and current_user_is_hospital_admin_for(nurse.hospital_id)
      )
    );
exception when duplicate_object then null; end $$;
