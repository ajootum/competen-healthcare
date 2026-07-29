-- 123: COMP-024 Competency Mobility & Recognition — the equivalency mapping primitive. A recognising org maps
-- an incoming (source) competency to a local (target) requirement with a recognition type, so a professional's
-- competencies can be recognised on mobility (cross-org / cross-system / return-to-practice). Plain, idempotent
-- statements only (no do-blocks). RLS = authenticated read; service-role (admin API) writes.

create table if not exists competency_equivalencies (
  id                   uuid primary key default gen_random_uuid(),
  hospital_id          uuid references hospitals(id) on delete cascade,     -- the recognising org (null = enterprise-wide rule)
  source_competency_id uuid references framework_competencies(id) on delete set null,  -- incoming competency (when internal)
  source_label         text,                                                -- free-text source name (external / cross-border)
  target_competency_id uuid references framework_competencies(id) on delete set null,  -- local requirement it maps to
  equivalence_type     text not null default 'equivalent',                  -- exact|equivalent|conditional|bridging|denied
  bridging_note        text,                                                -- what's required to bridge (conditional/bridging)
  rationale            text,
  created_by           uuid references profiles(id) on delete set null,
  created_by_name      text,
  created_at           timestamptz default now()
);
create index if not exists idx_comp_equiv_hospital on competency_equivalencies(hospital_id);
create index if not exists idx_comp_equiv_target on competency_equivalencies(target_competency_id);
create index if not exists idx_comp_equiv_source on competency_equivalencies(source_competency_id);
alter table competency_equivalencies enable row level security;
drop policy if exists comp_equiv_read on competency_equivalencies;
create policy comp_equiv_read on competency_equivalencies for select to authenticated using (true);
