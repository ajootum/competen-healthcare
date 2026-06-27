-- Fix: infinite recursion in super_admin RLS policies
-- Uses SECURITY DEFINER helper (same pattern as hospital_admin fix)

create or replace function public.current_user_is_super_admin()
returns boolean
language sql
security definer stable
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'super_admin'
  );
$$;

-- Fix super_admin reads all profiles
drop policy if exists "Super admin reads all profiles" on profiles;
create policy "Super admin reads all profiles"
  on profiles for select
  using (
    auth.uid() = id
    or current_user_is_super_admin()
  );

-- Fix super_admin reads all hospitals
drop policy if exists "Super admin reads all hospitals" on hospitals;
create policy "Super admin reads all hospitals"
  on hospitals for select
  using (
    auth.uid()::text = (select admin_id::text from hospitals h where h.id = hospitals.id limit 1)
    or current_user_is_super_admin()
    or auth.role() = 'authenticated'
  );
