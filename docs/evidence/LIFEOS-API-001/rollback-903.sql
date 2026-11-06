-- ROLLBACK FOR MIGRATION 903. APPLY THIS FILE WHOLE. Removes the domains table. The wider lifeos_mutate stays, because it is
-- a superset of the one in 901 and it writes only to lifeos_ tables. Only for use with an owner GO.
begin;
drop table if exists lifeos_tenant_domain;
commit;
notify pgrst, 'reload schema';
