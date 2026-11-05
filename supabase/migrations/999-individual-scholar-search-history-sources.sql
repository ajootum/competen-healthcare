-- 999: SCHOLAR-ASK-SOURCES-01, owner GO 5 Nov 2026 (requirement 11).
--
-- Where Search History is on, an Ask question is kept with the source categories the learner chose for it.
-- Categories only, never what was found. The column is nullable, so every existing row is untouched and means
-- nothing was recorded. No backfill: earlier questions did not record it.
--
-- Depends on 992. Before this is applied the app keeps the question without its sources and shows none.
-- No RLS, grant or trigger change. The table keeps its 992 posture. Removing an entry or clearing removes this with it.
-- Rollback: alter table individual_scholar_search_history drop column if exists sources

alter table public.individual_scholar_search_history add column if not exists sources text[];

alter table public.individual_scholar_search_history drop constraint if exists individual_scholar_search_history_sources_known;
alter table public.individual_scholar_search_history add constraint individual_scholar_search_history_sources_known
  check (sources is null or sources <@ array['materials', 'saved', 'library', 'research', 'web']::text[]);

comment on column public.individual_scholar_search_history.sources is
  'SCHOLAR-ASK-SOURCES-01: the source categories the learner chose for this Ask question. Null where none was recorded.';

notify pgrst, 'reload schema';
