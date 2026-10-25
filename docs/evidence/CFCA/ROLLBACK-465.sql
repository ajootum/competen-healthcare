-- ROLLBACK 465 (STAGING). Removes the CFCA competency-author capability and the curator position.
-- An appointment to competency_author stops granting anything once the position and its grants are gone.
-- Content a curator wrote stays: it is ordinary framework content, and its authorship stays in audit_log.
-- Production: not to be run without the owner. Fix forward instead.

delete from hq_position_capability where position_code = 'competency_author';
delete from hq_position_capability where capability_code = 'hq.quality.competency.author';
delete from hq_position where code = 'competency_author';
delete from hq_capability where code = 'hq.quality.competency.author';

notify pgrst, 'reload schema';
