-- ROLLBACK 466 (STAGING). Removes the CFCA publication guard and its predicate.
-- Publication of a shared CFCA framework then no longer checks clinical approval (the state before 466).
-- Production: not to be run without the owner. Fix forward instead.

drop trigger if exists trg_cfca_framework_publication_guard on frameworks;
drop function if exists public.cfca_framework_publication_guard();
drop function if exists public.competency_clinically_approved(uuid);

notify pgrst, 'reload schema';
