-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It recreates a plpgsql function between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 463 (STAGING ONLY). Returns individual_checkout to exactly what 399 left (its NOT NULLs and its period
-- CHECK), removes the course price, the course entitlement ledger and its view, and restores the 462 activity guard.
-- It refuses once a course checkout, a course entitlement or a price exists, because those are records.
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'individual_checkout' and column_name = 'item_kind') then
    if exists (select 1 from individual_checkout where item_kind <> 'experience') then raise exception 'ROLLBACK-463 refused: course checkouts exist'; end if;
  end if;
  if exists (select 1 from information_schema.tables where table_name = 'individual_course_entitlement') then
    if exists (select 1 from individual_course_entitlement) then raise exception 'ROLLBACK-463 refused: course entitlements exist'; end if;
  end if;
  if exists (select 1 from information_schema.tables where table_name = 'learning_offering_price') then
    if exists (select 1 from learning_offering_price) then raise exception 'ROLLBACK-463 refused: prices exist'; end if;
  end if;
end $$;

drop trigger if exists learning_record_entitlement_guard on learning_record;
drop function if exists public.learning_record_entitlement_guard();
alter table learning_record drop constraint if exists learning_record_entitlement_fk;

create or replace function public.learning_record_activity_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_delivery text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_record_activity: progress is part of the record';
  end if;
  select status, delivery into v_status, v_delivery from learning_record where id = new.record_id;
  if v_delivery is distinct from 'hosted' then raise exception 'learning_record_activity: progress is recorded for hosted learning only'; end if;
  if v_status not in ('enrolled', 'in_progress') then raise exception 'learning_record_activity: the record is % and takes no more progress', v_status; end if;
  if tg_op = 'UPDATE' and (new.record_id is distinct from old.record_id or new.user_id is distinct from old.user_id
     or new.activity_key is distinct from old.activity_key or new.kind is distinct from old.kind) then
    raise exception 'learning_record_activity: an activity cannot be moved';
  end if;
  return new;
end;
$$;

drop view if exists individual_live_course_entitlement;
drop table if exists individual_course_entitlement;
drop function if exists public.individual_course_entitlement_guard();

drop trigger if exists individual_checkout_course_guard on individual_checkout;
drop function if exists public.individual_checkout_course_guard();
alter table individual_checkout drop constraint if exists individual_checkout_subject_check;
alter table individual_checkout drop constraint if exists individual_checkout_interval_days_check;
alter table individual_checkout drop column if exists operating_entity;
alter table individual_checkout drop column if exists terms_version;
alter table individual_checkout drop column if exists offering_price_id;
alter table individual_checkout drop column if exists offering_id;
alter table individual_checkout drop column if exists item_kind;
alter table individual_checkout alter column plan_code set not null;
alter table individual_checkout alter column experience_code set not null;
alter table individual_checkout alter column interval_days set not null;
alter table individual_checkout add constraint individual_checkout_interval_days_check check (interval_days between 1 and 366);

drop function if exists public.learning_offering_price_retire(uuid);
drop function if exists public.learning_offering_price_decide(uuid, uuid, boolean, text);
drop table if exists learning_offering_price;
drop function if exists public.learning_offering_price_guard();

notify pgrst, 'reload schema';
