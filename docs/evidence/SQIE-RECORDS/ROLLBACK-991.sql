-- ROLLBACK-991: restore the 990 provenance CHECK (four keys per element) (SQIE-CLOSE-2026-11 WS-D).
-- APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses while any snapshot element carries a 991 key (mapping_status or objective): the restored 990 rule would refuse those
-- rows, and a snapshot is immutable. Removing them is an owner decision made by hand, never here.
do $$
begin
  if exists (select 1 from individual_scholar_attempt_snapshot where competency_provenance is not null
              and jsonb_path_exists(competency_provenance, '$[*] ? (exists(@.mapping_status) || exists(@.objective))')) then
    raise exception 'ROLLBACK-991 refused: snapshots carry mapping_status or objective';
  end if;
end $$;
alter table individual_scholar_attempt_snapshot drop constraint if exists individual_scholar_attempt_snapshot_provenance_check;
alter table individual_scholar_attempt_snapshot add constraint individual_scholar_attempt_snapshot_provenance_check
  check (competency_provenance is null
      or (jsonb_typeof(competency_provenance) = 'array'
      and octet_length(competency_provenance::text) <= 4096
      and jsonb_array_length(competency_provenance) = cardinality(competency_ids)
      and jsonb_path_query_array(competency_provenance, '$[*].id') = array_to_json(competency_ids)::jsonb
      and jsonb_array_length(competency_provenance) = jsonb_array_length(jsonb_path_query_array(competency_provenance,
            '$[*] ? (@.type() == "object"
                     && !exists(@.keyvalue() ? (!(@.key == "id" || @.key == "content_hash" || @.key == "framework_id" || @.key == "framework_version")))
                     && @.id like_regex "^[0-9a-f-]{36}$"
                     && (@.content_hash == null || @.content_hash like_regex "^[0-9a-f]{32}$")
                     && (@.framework_id == null || @.framework_id like_regex "^[0-9a-f-]{36}$")
                     && (@.framework_version == null || @.framework_version like_regex "^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$"))'))));

notify pgrst, 'reload schema';
