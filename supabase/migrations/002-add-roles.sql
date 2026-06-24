-- Add assessor and educator roles to the profiles constraint
-- Run this in the Supabase SQL editor

-- Drop old constraint and recreate with all 5 roles
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('nurse', 'assessor', 'educator', 'hospital_admin', 'super_admin'));

-- RLS: super_admin can read ALL profiles
DROP POLICY IF EXISTS "Super admin reads all profiles" ON profiles;
CREATE POLICY "Super admin reads all profiles"
  ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- RLS: super_admin can read ALL hospitals
DROP POLICY IF EXISTS "Super admin reads all hospitals" ON hospitals;
CREATE POLICY "Super admin reads all hospitals"
  ON hospitals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );
