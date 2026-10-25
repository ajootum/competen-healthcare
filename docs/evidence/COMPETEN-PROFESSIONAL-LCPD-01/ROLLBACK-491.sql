-- ROLLBACK 491 (STAGING). Removes reflections-on-learning links and the learning chosen for Passport links.
-- The reflections themselves (470), the CPD entries, the learning records and the share links stay: only the links go.
-- Production: not to be run without the owner. Fix forward instead.

drop table if exists individual_professional_share_learning;
drop table if exists individual_professional_learning_reflection;

notify pgrst, 'reload schema';
