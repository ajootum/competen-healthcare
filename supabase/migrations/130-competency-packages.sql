-- 130: CST-109 Competency Package Manager — bundle competency assets into reusable, deployable packages.
-- A package is a named, versioned, governed bundle (competencies / frameworks / assessments / CPUs /
-- learning pathways / checklists / skills). Items reference their source by (item_type, item_id) with a
-- denormalised label (no FK because the referenced table varies by type). Plain, idempotent statements
-- only (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists competency_packages (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  description       text,
  package_type      text not null default 'specialty'
                      check (package_type in ('specialty','orientation','mandatory','role','leadership','accreditation','simulation','assessment','learning','deployment')),
  version           text not null default '1.0.0',
  status            text not null default 'draft' check (status in ('draft','published','archived')),
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_comppkg_hospital on competency_packages(hospital_id);
create index if not exists idx_comppkg_status on competency_packages(status);
alter table competency_packages enable row level security;
drop policy if exists competency_packages_read on competency_packages;
create policy competency_packages_read on competency_packages for select to authenticated using (true);

create table if not exists competency_package_items (
  id                uuid primary key default gen_random_uuid(),
  package_id        uuid not null references competency_packages(id) on delete cascade,
  item_type         text not null default 'competency'
                      check (item_type in ('competency','framework','assessment','cpu','learning_pathway','checklist','skill')),
  item_id           uuid,
  item_label        text,
  is_required       boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists idx_comppkgitem_pkg on competency_package_items(package_id);
alter table competency_package_items enable row level security;
drop policy if exists competency_package_items_read on competency_package_items;
create policy competency_package_items_read on competency_package_items for select to authenticated using (true);

notify pgrst, 'reload schema';
