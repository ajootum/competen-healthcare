-- !! APPLY THIS FILE WHOLE (it contains a DO block).
-- ROLLBACK 490 (STAGING). Restores 373's CPD constraints and removes the history and the CPD setting.
-- CPD correction history and every person's chosen requirement are lost with it.
-- It REFUSES to run if any CPD entry already uses what only 490 allows (a new activity type, no hours, or
-- fractional credits), because restoring 373 would then reject existing rows: fix forward instead.
-- Production: not to be run without the owner. Fix forward instead.

do $$
begin
  if exists (select 1 from individual_professional_cpd
              where activity_type not in ('course', 'workshop', 'conference', 'self_study', 'simulation', 'osce', 'teaching', 'research', 'other')
                 or hours is null or (cpd_points is not null and cpd_points <> trunc(cpd_points))) then
    raise exception 'rollback 490 refused: CPD entries already use 490 shapes. Fix forward.';
  end if;
end
$$;

drop trigger if exists trg_individual_professional_cpd_keep_history on individual_professional_cpd;
drop trigger if exists trg_individual_professional_cpd_history_guard on individual_professional_cpd_history;
drop table if exists individual_professional_cpd_history;
drop function if exists public.individual_professional_cpd_keep_history();
drop function if exists public.individual_professional_cpd_history_guard();
drop table if exists individual_professional_cpd_setting;

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_hours_check;
alter table individual_professional_cpd alter column cpd_points type integer;
alter table individual_professional_cpd alter column hours set not null;
alter table individual_professional_cpd add constraint individual_professional_cpd_hours_check
  check (hours > 0 and hours <= 1000 and (cpd_points is null or cpd_points between 0 and 1000));

alter table individual_professional_cpd drop constraint if exists individual_professional_cpd_type_check;
alter table individual_professional_cpd add constraint individual_professional_cpd_type_check
  check (activity_type in ('course', 'workshop', 'conference', 'self_study', 'simulation', 'osce', 'teaching', 'research', 'other'));

notify pgrst, 'reload schema';
