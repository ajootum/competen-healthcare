-- ============================================================
-- PHASE 3: Multinational Organisation Hierarchy
-- Group → Country → Facility → Department → Unit
-- New roles: group_admin, country_admin
-- ============================================================

-- ── Update organisations table ─────────────────────────────
-- 'country' on organisations was ambiguous for multinationals.
-- Rename to hq_country (headquarters location).
-- A group can now have facilities in many countries.
alter table organisations
  rename column country to hq_country;

alter table organisations
  add column if not exists logo_url     text,
  add column if not exists phone        text,
  add column if not exists email        text,
  add column if not exists description  text;

-- ── Add country_code to hospitals for grouping ─────────────
-- hospitals.country already exists; ensure it's present
-- (safe to run even if already added)
alter table hospitals
  add column if not exists country_code char(2);   -- ISO 2-letter e.g. "KE", "UG"

-- ── Update profiles role constraint ────────────────────────
-- Add group_admin and country_admin alongside existing roles
alter table profiles
  drop constraint if exists profiles_role_check;

alter table profiles
  add constraint profiles_role_check
    check (role in ('nurse','assessor','educator','hospital_admin','country_admin','group_admin','super_admin'));

-- ── Add organisation_id and managed_country to profiles ────
-- group_admin: organisation_id set, managed_country null
-- country_admin: organisation_id set, managed_country set to e.g. "Kenya"
alter table profiles
  add column if not exists organisation_id  uuid references organisations(id),
  add column if not exists managed_country  text;

-- ── Helper: is current user a group admin for this org ─────
create or replace function public.current_user_is_group_admin_for(p_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'group_admin'
      and organisation_id = p_org_id
  );
$$;

-- ── Helper: is current user country admin for this hospital ─
create or replace function public.current_user_is_country_admin_for(p_hospital_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from profiles p
    join hospitals h on h.id = p_hospital_id
    where p.id = auth.uid()
      and p.role = 'country_admin'
      and p.organisation_id = h.organisation_id
      and (p.managed_country = h.country or p.managed_country is null)
  );
$$;

-- ── RLS: group_admin and country_admin can read all hospitals
--    in their org (or country within org) ────────────────────
drop policy if exists "Group admin reads org hospitals" on hospitals;
create policy "Group admin reads org hospitals"
  on hospitals for select
  using (
    organisation_id is not null
    and current_user_is_group_admin_for(organisation_id)
  );

drop policy if exists "Country admin reads country hospitals" on hospitals;
create policy "Country admin reads country hospitals"
  on hospitals for select
  using (current_user_is_country_admin_for(id));

-- ── Group/country admin can manage profiles in their scope ──
-- They can view profiles of nurses/assessors in their hospitals
drop policy if exists "Group admin reads org profiles" on profiles;
create policy "Group admin reads org profiles"
  on profiles for select
  using (
    hospital_id in (
      select h.id from hospitals h
      join profiles p on p.id = auth.uid()
      where p.role = 'group_admin' and h.organisation_id = p.organisation_id
    )
  );

drop policy if exists "Country admin reads country profiles" on profiles;
create policy "Country admin reads country profiles"
  on profiles for select
  using (
    hospital_id in (
      select h.id from hospitals h
      join profiles p on p.id = auth.uid()
      where p.role = 'country_admin'
        and h.organisation_id = p.organisation_id
        and (h.country = p.managed_country or p.managed_country is null)
    )
  );

-- ── Departments: group/country admin can read in their scope ─
drop policy if exists "Group admin reads org departments" on departments;
create policy "Group admin reads org departments"
  on departments for select
  using (
    hospital_id in (
      select h.id from hospitals h
      join profiles p on p.id = auth.uid()
      where p.role = 'group_admin' and h.organisation_id = p.organisation_id
    )
  );

-- ── Add org-level stats view for dashboards ────────────────
create or replace view public.org_country_stats as
select
  o.id          as organisation_id,
  o.name        as organisation_name,
  h.country,
  count(distinct h.id)                                    as facilities,
  count(distinct case when p.role = 'nurse' then p.id end) as nurses,
  count(distinct case when p.role = 'assessor' then p.id end) as assessors,
  count(distinct case when p.role = 'educator' then p.id end) as educators
from organisations o
join hospitals h on h.organisation_id = o.id
left join profiles p on p.hospital_id = h.id
group by o.id, o.name, h.country;

-- ============================================================
-- End of migration 008
-- ============================================================
