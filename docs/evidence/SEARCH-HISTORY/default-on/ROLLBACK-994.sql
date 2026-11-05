-- ROLLBACK-994: return individual_scholar_consent to its state before 994.
-- APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses once a notified or never-granted row exists: those are learners' records, and removing them is an owner decision made by hand.
do $$
begin
  if exists (select 1 from individual_scholar_consent where status = 'notified' or granted_at is null) then
    raise exception 'ROLLBACK-994 refused: notified or never-granted rows exist';
  end if;
end $$;

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_grant_meaning;

alter table individual_scholar_consent alter column granted_at set not null;

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_status_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_status_check
  check (status in ('granted', 'revoked'));

comment on column individual_scholar_consent.status is null;

notify pgrst, 'reload schema';
