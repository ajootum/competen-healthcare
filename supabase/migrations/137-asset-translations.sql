-- 137: CAP-012 Translation & Localisation Engine — tracks translations of competency assets into
-- non-English locales (English is the source). A record ties an asset (type + soft id + label) to a
-- target locale with a translation status. Plain, idempotent statements only. RLS = authenticated read;
-- service-role writes.

create table if not exists cap_asset_translations (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  asset_type        text not null default 'competency'
                      check (asset_type in ('framework','competency','skill','blueprint','question_bank','osce','simulation','learning_resource','policy','guideline','other')),
  asset_id          uuid,
  asset_label       text not null,
  locale            text not null default 'fr'
                      check (locale in ('fr','es','ar','sw','pt','zh','hi','de','other')),
  status            text not null default 'not_started' check (status in ('not_started','in_progress','review','published')),
  translator_name   text,
  notes             text,
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_captr_hospital on cap_asset_translations(hospital_id);
create index if not exists idx_captr_locale on cap_asset_translations(locale);
create index if not exists idx_captr_status on cap_asset_translations(status);
alter table cap_asset_translations enable row level security;
drop policy if exists cap_asset_translations_read on cap_asset_translations;
create policy cap_asset_translations_read on cap_asset_translations for select to authenticated using (true);

notify pgrst, 'reload schema';
