-- PROD-COUNTS-992: READ ONLY, counts only, no learner content. For the OWNER to run in the production SQL editor, before and after
-- the acceptance checks in OWNER-PROD-ACCEPTANCE.md. Agents never run this. Check the email column shows the two pilot learners.
select p.email,
       (select count(*) from individual_scholar_artefact x where x.user_id = p.id) as artefacts,
       (select count(*) from individual_scholar_learning_session x where x.user_id = p.id) as sessions,
       (select count(*) from individual_scholar_learning_event x where x.user_id = p.id) as events,
       (select count(*) from individual_scholar_attempt x where x.user_id = p.id) as attempts,
       (select count(*) from individual_scholar_material x where x.user_id = p.id) as materials,
       (select count(*) from individual_scholar_card x where x.user_id = p.id) as cards,
       (select count(*) from individual_scholar_note x where x.user_id = p.id) as notes,
       (select count(*) from individual_scholar_search_history x where x.user_id = p.id and x.origin = 'captured') as history_captured,
       (select count(*) from individual_scholar_search_history x where x.user_id = p.id and x.origin = 'recovered') as history_marks,
       (select count(*) from plat_ai_requests x where x.actor_id = p.id) + (select count(*) from ai_usage_ledger x where x.user_id = p.id) as ai_rows
  from profiles p
 where p.email ilike 'competenelisha%' or p.email ilike 'apollonatooli%'
 order by p.email;
