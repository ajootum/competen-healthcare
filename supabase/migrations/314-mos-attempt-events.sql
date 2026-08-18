-- CPR-CORE-MOS-001 phase 3 - the three attempt events missing from the s6 minimum catalogue.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- s6 lists a minimum event catalogue and its naming is not uniform, because the domains were written
-- from what happens rather than from a grammar. Some entries name an ACT: practice.encounter.started,
-- practice.booking.started. Others name a RESULT: practice.followup.created, practice.document.issued,
-- practice.invoice.generated.
--
-- That difference decides whether a journey can have a denominator. An act-named event carries all three
-- outcomes on one name - started, success, failure - and Start Encounter is instrumented that way. A
-- result-named event cannot: "practice.followup.created with outcome started" says a thing was created
-- and has not happened yet, which is a sentence no reader should have to reconcile.
--
-- So the three journeys whose only catalogued names are results get an explicit attempt event. Without
-- one they can record what succeeded and never how often it was tried, which is exactly the missing
-- denominator this whole substrate exists to supply.
--
-- NOTE  AND THIS IS THE CATALOGUE-AS-FOREIGN-KEY DESIGN WORKING AS INTENDED, not fighting it. A free-text
-- event_name would have let a route emit "practice.followup.attempted" today with nobody noticing it was
-- uncatalogued, and a typo in it would have become a permanent second series. Adding an event is meant to
-- be a deliberate act. This is one.

insert into mos_event_name (name, domain, journey_key, description) values
  ('practice.followup.attempted',       'follow_up',  'create_follow_up', 'Creating a follow-up was attempted'),
  ('practice.document.issue_attempted', 'documents',  'issue_document',   'Issuing a document was attempted'),
  ('practice.invoice.generate_attempted', 'commercial', 'generate_invoice', 'Generating an invoice was attempted')
on conflict (name) do update
  set domain = excluded.domain, journey_key = excluded.journey_key, description = excluded.description;

notify pgrst, 'reload schema';
