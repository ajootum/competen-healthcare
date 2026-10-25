-- ====================================================================================================
-- MIGRATION 540: COMPETEN PASSPORT -- PURPOSE-SPECIFIC VIEWS, RECORD-LEVEL SELECTION AND ACCESS HISTORY
--
-- !! APPLY THIS FILE WHOLE. It contains plpgsql trigger functions. A runner that splits on semicolons
-- !! would cut a function body in half. Paste the entire file into the SQL editor and run it once.
--
-- COMPETEN-PROFESSIONAL-PASSPORT-01, Professional Stage 7 (Lifelong Competen Passport), P1 P4 P5. Owner GO
-- (development and staging authorised). Production only on separate owner GO.
-- Build record: docs/COMPETEN-PROFESSIONAL-PASSPORT-01-stage7.md.
--
-- DEPENDS ON 122 (passport_share_tokens), 373 (cpd, evidence), 393 (their (id, user_id) indexes, repeated
-- here), 375 (Scholar Passport item), 427 (Scholar Passport evaluation), 520 (the Scholar item index, repeated).
--
-- ----------------------------------------------------------------------------------------------------
-- NOT A NEW PASSPORT OR SHARING ENGINE. passport_share_tokens stays THE link and /verify stays THE page. The
-- per-link selections of 453 (profile), 491 (learning), 520 (competencies) and 530 (evaluations) are unchanged.
-- This file adds, around a link:
--
--   1. individual_passport_share_view: what one link is FOR (purpose, recipient label, the person's own summary)
--      and whether organisation-issued records travel with it. It is a DRAFT until activated: the link is minted
--      with consent false (which /verify already refuses), previewed by its owner, and only then activated. Once
--      active the view is fixed: nothing about it can be rewritten.
--   2. individual_passport_share_record: RECORD-LEVEL selection of the person's own records that have no per-link
--      table: a CPD entry, an evidence item or credential, a Scholar study item, a Scholar evaluation. Exactly one
--      per row, each by composite key so another person's record is unrepresentable. A record can be taken OFF a
--      live link but never added to one: a live link can narrow, never widen.
--   3. individual_passport_share_access: an append-only log of each opening of a link and what /verify answered
--      (shown, or refused as revoked, expired or draft). Nothing about the recipient is recorded.
--
-- Record-level selection is the ONLY way a link carries the person's own records: a link with no selection
-- carries none (coordinator ruling, 25 Oct: there is no legacy mode).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- RLS on, own-row SELECT only, no write policy. Append-only trails keep the cascade path (pg_trigger_depth() > 1).
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-PASSPORT-01/ROLLBACK-540.sql
-- ====================================================================================================


-- ---- 1. THE KEYS THE COMPOSITE REFERENCES NEED -----------------------------------------------------------
-- Each exists already where its migration is applied (393, 520), so those statements do nothing there.

create unique index if not exists ux_passport_share_tokens_id_nurse on passport_share_tokens(id, nurse_id);
create unique index if not exists ux_individual_professional_cpd_id_user on individual_professional_cpd(id, user_id);
create unique index if not exists ux_individual_professional_evidence_id_user on individual_professional_evidence(id, user_id);
create unique index if not exists ux_individual_scholar_passport_item_id_user on individual_scholar_passport_item(id, user_id);
create unique index if not exists ux_individual_scholar_passport_evaluation_id_user on individual_scholar_passport_evaluation(id, user_id);


-- ---- 2. WHAT A LINK IS FOR, AND ITS DRAFT STATE ----------------------------------------------------------

create table if not exists individual_passport_share_view (
  share_token_id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  purpose_code text,
  purpose_label text,
  recipient_label text,
  summary text,
  include_institution boolean not null default false,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_passport_share_view drop constraint if exists individual_passport_share_view_token_fk;
alter table individual_passport_share_view add constraint individual_passport_share_view_token_fk
  foreign key (share_token_id, user_id) references passport_share_tokens(id, nurse_id) on delete cascade;
create unique index if not exists ux_individual_passport_share_view_token_user
  on individual_passport_share_view(share_token_id, user_id);
create index if not exists idx_individual_passport_share_view_user
  on individual_passport_share_view(user_id, created_at desc);

alter table individual_passport_share_view drop constraint if exists individual_passport_share_view_shape;
alter table individual_passport_share_view add constraint individual_passport_share_view_shape check (
  (purpose_code is null or (purpose_code ~ '^[a-z0-9][a-z0-9-]{0,62}$' and purpose_label is not null))
  and char_length(coalesce(purpose_label, '')) <= 160
  and char_length(coalesce(recipient_label, '')) <= 160
  and char_length(coalesce(summary, '')) <= 2000
  and (activated_at is null or activated_at >= created_at)
);

alter table individual_passport_share_view enable row level security;
drop policy if exists individual_passport_share_view_read_own on individual_passport_share_view;
create policy individual_passport_share_view_read_own on individual_passport_share_view
  for select using (auth.uid() = user_id);

-- A draft may be edited and activated once. An active view is fixed. Delete only by cascade (the link going).
create or replace function public.individual_passport_share_view_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'individual_passport_share_view goes only with its link: revoke the link instead';
  end if;
  if old.activated_at is not null then
    raise exception 'individual_passport_share_view is active and fixed: create a new link to change it';
  end if;
  if new.share_token_id is distinct from old.share_token_id or new.user_id is distinct from old.user_id then
    raise exception 'individual_passport_share_view cannot move to another link';
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_passport_share_view_guard on individual_passport_share_view;
create trigger trg_individual_passport_share_view_guard
  before update or delete on individual_passport_share_view
  for each row execute function individual_passport_share_view_guard();

comment on table individual_passport_share_view is
  'COMPETEN-PROFESSIONAL-PASSPORT-01 P4. What one Passport link is for, chosen by the person: purpose, recipient label, their own summary, whether organisation-issued records travel. A draft until activated, then fixed.';


-- ---- 3. RECORD-LEVEL SELECTION ----------------------------------------------------------------------------

create table if not exists individual_passport_share_record (
  id uuid primary key default gen_random_uuid(),
  share_token_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  cpd_id uuid,
  evidence_id uuid,
  study_item_id uuid,
  scholar_evaluation_id uuid,
  created_at timestamptz not null default now()
);

alter table individual_passport_share_record drop constraint if exists individual_passport_share_record_view_fk;
alter table individual_passport_share_record add constraint individual_passport_share_record_view_fk
  foreign key (share_token_id, user_id) references individual_passport_share_view(share_token_id, user_id) on delete cascade;
alter table individual_passport_share_record drop constraint if exists individual_passport_share_record_cpd_fk;
alter table individual_passport_share_record add constraint individual_passport_share_record_cpd_fk
  foreign key (cpd_id, user_id) references individual_professional_cpd(id, user_id) on delete cascade;
alter table individual_passport_share_record drop constraint if exists individual_passport_share_record_evidence_fk;
alter table individual_passport_share_record add constraint individual_passport_share_record_evidence_fk
  foreign key (evidence_id, user_id) references individual_professional_evidence(id, user_id) on delete cascade;
alter table individual_passport_share_record drop constraint if exists individual_passport_share_record_study_fk;
alter table individual_passport_share_record add constraint individual_passport_share_record_study_fk
  foreign key (study_item_id, user_id) references individual_scholar_passport_item(id, user_id) on delete cascade;
alter table individual_passport_share_record drop constraint if exists individual_passport_share_record_evaluation_fk;
alter table individual_passport_share_record add constraint individual_passport_share_record_evaluation_fk
  foreign key (scholar_evaluation_id, user_id) references individual_scholar_passport_evaluation(id, user_id) on delete cascade;

alter table individual_passport_share_record drop constraint if exists individual_passport_share_record_shape;
alter table individual_passport_share_record add constraint individual_passport_share_record_shape check (
  ((cpd_id is not null)::int + (evidence_id is not null)::int + (study_item_id is not null)::int + (scholar_evaluation_id is not null)::int) = 1
);

-- One row per record per link. Nulls are distinct, so each index constrains only its own kind.
create unique index if not exists ux_individual_passport_share_record_cpd on individual_passport_share_record(share_token_id, cpd_id);
create unique index if not exists ux_individual_passport_share_record_evidence on individual_passport_share_record(share_token_id, evidence_id);
create unique index if not exists ux_individual_passport_share_record_study on individual_passport_share_record(share_token_id, study_item_id);
create unique index if not exists ux_individual_passport_share_record_evaluation on individual_passport_share_record(share_token_id, scholar_evaluation_id);
create index if not exists idx_individual_passport_share_record_user on individual_passport_share_record(user_id);

alter table individual_passport_share_record enable row level security;
drop policy if exists individual_passport_share_record_read_own on individual_passport_share_record;
create policy individual_passport_share_record_read_own on individual_passport_share_record
  for select using (auth.uid() = user_id);

-- A live link can narrow, never widen: records are added only while its view is a draft, and never rewritten.
create or replace function public.individual_passport_share_record_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'individual_passport_share_record is never rewritten: remove it and add another while the link is a draft';
  end if;
  if exists (select 1 from individual_passport_share_view v where v.share_token_id = new.share_token_id and v.activated_at is not null) then
    raise exception 'this link is active: a record can be taken off it, never added';
  end if;
  return new;
end
$$;

drop trigger if exists trg_individual_passport_share_record_guard on individual_passport_share_record;
create trigger trg_individual_passport_share_record_guard
  before insert or update on individual_passport_share_record
  for each row execute function individual_passport_share_record_guard();

comment on table individual_passport_share_record is
  'COMPETEN-PROFESSIONAL-PASSPORT-01 P4. One own record the person chose for one Passport link. The only way a link carries such a record. Added only while the link is a draft.';


-- ---- 4. ACCESS HISTORY: APPEND-ONLY, NOTHING ABOUT THE RECIPIENT -----------------------------------------

create table if not exists individual_passport_share_access (
  id uuid primary key default gen_random_uuid(),
  share_token_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  result text not null,
  viewed_at timestamptz not null default now()
);
alter table individual_passport_share_access drop constraint if exists individual_passport_share_access_token_fk;
alter table individual_passport_share_access add constraint individual_passport_share_access_token_fk
  foreign key (share_token_id, user_id) references passport_share_tokens(id, nurse_id) on delete cascade;
alter table individual_passport_share_access drop constraint if exists individual_passport_share_access_result;
alter table individual_passport_share_access add constraint individual_passport_share_access_result
  check (result in ('shown', 'refused_revoked', 'refused_expired', 'refused_draft'));
create index if not exists idx_individual_passport_share_access_token
  on individual_passport_share_access(share_token_id, viewed_at desc);

alter table individual_passport_share_access enable row level security;
drop policy if exists individual_passport_share_access_read_own on individual_passport_share_access;
create policy individual_passport_share_access_read_own on individual_passport_share_access
  for select using (auth.uid() = user_id);

create or replace function public.individual_passport_share_access_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'individual_passport_share_access is append-only';
end
$$;

drop trigger if exists trg_individual_passport_share_access_append_only on individual_passport_share_access;
create trigger trg_individual_passport_share_access_append_only
  before update or delete on individual_passport_share_access
  for each row execute function individual_passport_share_access_append_only();

comment on table individual_passport_share_access is
  'COMPETEN-PROFESSIONAL-PASSPORT-01 P4. When a link was opened and what /verify answered. Append-only. Nothing about the recipient is recorded.';


notify pgrst, 'reload schema';
