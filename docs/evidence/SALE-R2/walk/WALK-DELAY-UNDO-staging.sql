-- SALE-R2 staging walk: undo the simulated delay exactly (STAGING ONLY). The fixture had no answers on 27 Oct before the walk (its first
-- answer is 1 Nov), so every 27 Oct answer on the critical-care notes is one the delay moved: eight days forward again.
update individual_scholar_attempt a set answered_at = a.answered_at + interval '8 days'
  from individual_scholar_question q
 where q.id = a.question_id
   and a.user_id = (select user_id from individual_scholar_attempt where id = '36a3468f-a192-4fba-bd9f-5e1ceb6ce473')
   and q.material_id = '5327bda5-add2-4dfd-86c3-b9bec6eca907'
   and a.answered_at >= '2026-10-27T00:00:00Z' and a.answered_at < '2026-10-28T00:00:00Z';
