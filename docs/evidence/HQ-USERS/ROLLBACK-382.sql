-- ROLLBACK FOR MIGRATION 382 (chief_executive hq.platform.users.view). STAGING only.
delete from hq_position_capability
 where position_code = 'chief_executive'
   and capability_code = 'hq.platform.users.view';

notify pgrst, 'reload schema';
