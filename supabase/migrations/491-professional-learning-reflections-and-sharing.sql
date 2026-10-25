-- ====================================================================================================
-- MIGRATION 491: COMPETEN PROFESSIONAL STAGE 4 -- REFLECTIONS ON LEARNING, AND SHARING CHOSEN LEARNING
--
-- COMPETEN-PROFESSIONAL-LCPD-01, owner GO (Stage 4 Learning and CPD), LCPD-3, LCPD-4 and LCPD-6. Development
-- and staging authorised. Production needs a separate owner GO. Build record:
-- docs/evidence/COMPETEN-PROFESSIONAL-LCPD-01/491-build-record.md.
--
-- DEPENDS ON 470 (individual_professional_reflection), 373 and 393 (individual_professional_cpd and its
-- (id, user_id) key), 453 (individual_professional_share) and 462 (learning_record and its (id, user_id) key).
-- In production 470 is not applied yet: 491 goes after it. Independent of 490. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS.
--
--   individual_professional_learning_reflection
--     A private reflection (Stage 2, 470) about ONE thing that happened: a CPD entry of the person, or a Holdings
--     learning_record of theirs. Never both, never neither. It carries the learning impact the person reports:
--       completed    the learning was done
--       understood   the person understood it
--       applied      the person applied it in practice
--     Independently verified practice impact is NOT a value here and cannot be: nobody may self-report verification
--     (owner LCPD-3, item 4). The authoritative course record is never changed: this row points at it. One subject
--     per reflection. Own-row read. It goes with its reflection, its CPD entry or its learning record.
--
--   individual_professional_share_learning
--     The completed learning records a person chose to carry on ONE Professional Passport link (453). None by
--     default. Own-row read. It goes with its link or its learning record. Which records are eligible is
--     configuration (lcpd-config passportShareable), checked when a link is made and again when it is shown.
--     Private reflections and development plans have no path here.
--
-- No hospital, organisation or tenant column (owner ruling D1). No plpgsql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-LCPD-01/ROLLBACK-491.sql
-- VERIFY:             docs/evidence/COMPETEN-PROFESSIONAL-LCPD-01/VERIFY-491.sql
-- ====================================================================================================

create table if not exists individual_professional_learning_reflection (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  reflection_id uuid not null,
  cpd_id uuid,
  learning_record_id uuid,
  impact text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_professional_learning_reflection drop constraint if exists individual_professional_learning_reflection_subject;
alter table individual_professional_learning_reflection add constraint individual_professional_learning_reflection_subject
  check ((cpd_id is null) <> (learning_record_id is null));

alter table individual_professional_learning_reflection drop constraint if exists individual_professional_learning_reflection_impact;
alter table individual_professional_learning_reflection add constraint individual_professional_learning_reflection_impact
  check (impact in ('completed', 'understood', 'applied'));

alter table individual_professional_learning_reflection drop constraint if exists individual_professional_learning_reflection_reflection_fk;
alter table individual_professional_learning_reflection add constraint individual_professional_learning_reflection_reflection_fk
  foreign key (reflection_id, user_id) references individual_professional_reflection(id, user_id) on delete cascade;

alter table individual_professional_learning_reflection drop constraint if exists individual_professional_learning_reflection_cpd_fk;
alter table individual_professional_learning_reflection add constraint individual_professional_learning_reflection_cpd_fk
  foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id) on delete cascade;

alter table individual_professional_learning_reflection drop constraint if exists individual_professional_learning_reflection_record_fk;
alter table individual_professional_learning_reflection add constraint individual_professional_learning_reflection_record_fk
  foreign key (learning_record_id, user_id) references learning_record(id, user_id) on delete cascade;

create unique index if not exists ux_individual_professional_learning_reflection_one
  on individual_professional_learning_reflection(reflection_id);
create index if not exists idx_individual_professional_learning_reflection_user
  on individual_professional_learning_reflection(user_id, created_at desc);

alter table individual_professional_learning_reflection enable row level security;
drop policy if exists individual_professional_learning_reflection_read_own on individual_professional_learning_reflection;
create policy individual_professional_learning_reflection_read_own on individual_professional_learning_reflection
  for select using (auth.uid() = user_id);

comment on table individual_professional_learning_reflection is
  'COMPETEN-PROFESSIONAL-LCPD-01 LCPD-3. A private reflection (470) on one CPD entry or one learning_record, with the impact the person reports: completed, understood or applied. Never verified. Own-row read.';

create table if not exists individual_professional_share_learning (
  share_token_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  learning_record_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (share_token_id, learning_record_id)
);

alter table individual_professional_share_learning drop constraint if exists individual_professional_share_learning_share_fk;
alter table individual_professional_share_learning add constraint individual_professional_share_learning_share_fk
  foreign key (share_token_id, user_id) references individual_professional_share(share_token_id, user_id) on delete cascade;

alter table individual_professional_share_learning drop constraint if exists individual_professional_share_learning_record_fk;
alter table individual_professional_share_learning add constraint individual_professional_share_learning_record_fk
  foreign key (learning_record_id, user_id) references learning_record(id, user_id) on delete cascade;

create index if not exists idx_individual_professional_share_learning_user
  on individual_professional_share_learning(user_id);

alter table individual_professional_share_learning enable row level security;
drop policy if exists individual_professional_share_learning_read_own on individual_professional_share_learning;
create policy individual_professional_share_learning_read_own on individual_professional_share_learning
  for select using (auth.uid() = user_id);

comment on table individual_professional_share_learning is
  'COMPETEN-PROFESSIONAL-LCPD-01 LCPD-6. The completed learning records a person chose to carry on one Professional Passport link. None by default. Own-row read.';

notify pgrst, 'reload schema';
