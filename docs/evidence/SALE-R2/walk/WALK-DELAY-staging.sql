-- SALE-R2 staging walk: the SIMULATED DELAY (STAGING ONLY, fixture learner only). Moves every answer the fixture made on the critical-care
-- notes on 4 Nov 2026 (other sessions walk the same fixture, so the set is taken at run time, not a fixed list) eight days back, into
-- 27 Oct, a day on which the fixture has no answers at all (its first answer is 1 Nov). WALK-DELAY-UNDO-staging.sql moves exactly the
-- 27 Oct answers on that material eight days forward again. Nothing else is changed.
update individual_scholar_attempt a set answered_at = a.answered_at - interval '8 days'
  from individual_scholar_question q
 where q.id = a.question_id
   and a.user_id = (select user_id from individual_scholar_attempt where id = '36a3468f-a192-4fba-bd9f-5e1ceb6ce473')
   and q.material_id = '5327bda5-add2-4dfd-86c3-b9bec6eca907'
   and a.answered_at >= '2026-11-04T00:00:00Z' and a.answered_at < '2026-11-05T00:00:00Z';
