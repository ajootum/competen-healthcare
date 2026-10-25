-- ROLLBACK 464 (STAGING ONLY). Removes the four Learning capabilities, the four Learning positions and their eight
-- grants. It refuses once anybody is appointed to one of the four positions, because an appointment is a record.
do $$
begin
  if exists (select 1 from ogs_office_appointments where role in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer')) then
    raise exception 'ROLLBACK-464 refused: somebody is appointed to a Learning position';
  end if;
end $$;

delete from hq_position_capability where position_code in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer');
delete from hq_position_capability where capability_code in ('hq.learning.course.author', 'hq.learning.course.publish', 'hq.learning.price.approve', 'hq.learning.certificate.issue');
delete from hq_position where code in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer');
delete from hq_capability where code in ('hq.learning.course.author', 'hq.learning.course.publish', 'hq.learning.price.approve', 'hq.learning.certificate.issue');

notify pgrst, 'reload schema';
