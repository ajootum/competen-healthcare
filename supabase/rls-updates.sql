-- COMPETEN HEALTHCARE — Additional RLS policies
-- Run in Supabase SQL Editor to enable full module functionality

-- Allow nurses to add their own competency records
do $$ begin
  create policy "Users insert own competencies"
    on nurse_competencies for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Users update own competencies"
    on nurse_competencies for update using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Hospital admins can view nurses in their hospital
do $$ begin
  create policy "Admins view hospital nurses"
    on profiles for select
    using (
      auth.uid() = id
      or exists (
        select 1 from profiles admin
        where admin.id = auth.uid()
          and admin.role = 'hospital_admin'
          and admin.hospital_id = profiles.hospital_id
      )
    );
exception when duplicate_object then null; end $$;

-- Hospital admins can view competencies of nurses in their hospital
do $$ begin
  create policy "Admins view hospital nurse competencies"
    on nurse_competencies for select
    using (
      auth.uid() = user_id
      or exists (
        select 1 from profiles admin
        join profiles nurse on nurse.id = nurse_competencies.user_id
        where admin.id = auth.uid()
          and admin.role = 'hospital_admin'
          and admin.hospital_id = nurse.hospital_id
      )
    );
exception when duplicate_object then null; end $$;

-- Hospital admins can view CPD logs of nurses in their hospital
do $$ begin
  create policy "Admins view hospital CPD logs"
    on cpd_logs for select
    using (
      auth.uid() = user_id
      or exists (
        select 1 from profiles admin
        join profiles nurse on nurse.id = cpd_logs.user_id
        where admin.id = auth.uid()
          and admin.role = 'hospital_admin'
          and admin.hospital_id = nurse.hospital_id
      )
    );
exception when duplicate_object then null; end $$;

-- Hospital admins can view enrollments of nurses in their hospital
do $$ begin
  create policy "Admins view hospital enrollments"
    on course_enrollments for select
    using (
      auth.uid() = user_id
      or exists (
        select 1 from profiles admin
        join profiles nurse on nurse.id = course_enrollments.user_id
        where admin.id = auth.uid()
          and admin.role = 'hospital_admin'
          and admin.hospital_id = nurse.hospital_id
      )
    );
exception when duplicate_object then null; end $$;

-- Allow authenticated users to view hospitals (for profile setup)
do $$ begin
  create policy "Authenticated users view hospitals"
    on hospitals for select using (auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
