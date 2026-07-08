-- Fix: infinite recursion in profiles RLS policies
--
-- Both "Super admin reads all profiles" and "Admins view hospital nurses" call
-- SECURITY DEFINER functions that query profiles, triggering the same policies
-- again → 42P17 infinite recursion. This breaks ALL profile reads via user client.
--
-- All admin data fetching already uses createAdminClient() (service role, bypasses
-- RLS), so these extra-read policies are not needed. Only self-read is required.

-- Drop the recursive policies
DROP POLICY IF EXISTS "Super admin reads all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins view hospital nurses" ON profiles;
DROP POLICY IF EXISTS "super_admin_reads_all_profiles" ON profiles;

-- Drop the recursive helper functions
DROP FUNCTION IF EXISTS public.current_user_is_super_admin();
DROP FUNCTION IF EXISTS public.is_super_admin_check();
DROP FUNCTION IF EXISTS public.current_user_is_hospital_admin_for(uuid);

-- Ensure exactly one simple, non-recursive SELECT policy exists
DROP POLICY IF EXISTS "Users see own profile" ON profiles;
DROP POLICY IF EXISTS "users_read_own_profile" ON profiles;
CREATE POLICY "users_read_own_profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);
