-- ============================================================
-- MIGRATION 023: SCOPED AUTHORITY (User Account Architecture spec)
--  1) assessor_authorizations (§17) — an Assessor role grants no universal
--     authority: who may ASSESS which CPU, at which independence level,
--     with validity dates. cpu_id null = all CPUs; hospital_id null = all.
--  2) content_responsibilities (§15) — accountable ownership of content
--     objects (every published CPU should have an identifiable owner).
-- Separation of duties (§27) is enforced in the review API.
-- Additive & idempotent.
-- ============================================================

create table if not exists assessor_authorizations (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles(id) on delete cascade,
  hospital_id          uuid references hospitals(id) on delete cascade,
  cpu_id               uuid references clinical_practice_units(id) on delete cascade,
  independence         text not null default 'independent'
                         check (independence in ('independent','supervised','countersigned')),
  status               text not null default 'active'
                         check (status in ('active','suspended','expired','revoked')),
  valid_from           date not null default current_date,
  valid_until          date,
  restrictions         text,
  authorized_by        uuid references profiles(id),
  authorized_by_name   text,
  created_at           timestamptz default now()
);
create index if not exists idx_assessor_auth_user on assessor_authorizations(user_id, status);

create table if not exists content_responsibilities (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  content_type        text not null
                        check (content_type in ('framework','cpu','competency','question_bank','quality_object','policy')),
  content_id          uuid not null,
  content_name        text,
  responsibility_type text not null
                        check (responsibility_type in ('product_owner','primary_author','contributing_author',
                                                       'clinical_reviewer','evidence_owner','assessment_owner',
                                                       'governance_approver','publisher')),
  status              text not null default 'active' check (status in ('active','ended')),
  start_date          date not null default current_date,
  end_date            date,
  review_due          date,
  assigned_by         uuid references profiles(id),
  created_at          timestamptz default now(),
  unique (user_id, content_type, content_id, responsibility_type)
);
create index if not exists idx_content_resp_object on content_responsibilities(content_type, content_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table assessor_authorizations  enable row level security;
alter table content_responsibilities enable row level security;

do $$ declare t text; begin
  foreach t in array array['assessor_authorizations','content_responsibilities'] loop
    begin
      execute format('create policy "Authenticated read" on %I for select using (auth.uid() is not null)', t);
    exception when duplicate_object then null; end;
    begin
      execute format('create policy "Admins write" on %I for all using (exists (
        select 1 from profiles p where p.id = auth.uid()
        and p.role in (''super_admin'',''hospital_admin'')))', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

notify pgrst, 'reload schema';
