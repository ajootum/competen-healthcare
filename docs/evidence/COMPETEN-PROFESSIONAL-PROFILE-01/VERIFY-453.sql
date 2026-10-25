-- VERIFY 453 (read-only). COMPETEN-PROFESSIONAL-PROFILE-01 part B, selective sharing. Every query only reads.

-- 1. the overview flag, off by default (expect 1 row: boolean, NO, false)
select data_type, is_nullable, column_default from information_schema.columns
 where table_name = 'individual_professional_share' and column_name = 'profile_overview';

-- 2. existing links share no overview (expect 0)
select count(*) as links_sharing_overview from individual_professional_share where profile_overview;

-- 3. the item table: RLS on, one SELECT policy (expect true, 1, 1), and both composite keys (expect 2 rows)
select c.relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c where c.relname = 'individual_professional_share_item' and c.relkind = 'r';
select conname from pg_constraint where conname in ('individual_professional_share_item_share_fk', 'individual_professional_share_item_item_fk') order by 1;

-- 4. no rows yet (expect 0)
select count(*) as rows from individual_professional_share_item;
