-- VERIFY-995 (strict). Run on STAGING after 995. One block that ALWAYS raises, so the planted rows are never kept:
--   "VERIFY-995 PASS pass=N"  every check held (the runner reports it as a rolled-back error: nothing changed)
--   "VERIFY-995 FAIL ..."     the first check that did not hold
do $$
declare
  n int := 0;
  k int := 0;
  bad int;
  v_actor uuid;
  v_res uuid;
  v_ver uuid;
  v_exp uuid;
  ok boolean;
  good jsonb := '{"format":"short","stem":"What is the normal adult respiratory rate?","options":[],"answerKey":{"accepted":["12 to 20"]},"marking":"deterministic","rationale":"Adults breathe 12 to 20 times a minute at rest."}';
  v_full jsonb := '{"programme_code":"nursing-ug-diploma","programme_label":"Nursing (Uganda), diploma","qualification_level":"pre_registration_diploma","qualification_label":"Pre-registration nursing, diploma","difficulty":"intermediate","references":[{"id":"RM-10","supports":"x"}],"source_verification":{"status":"not_verified"},"competency_mapping":{"status":"draft","framework_version":"1.0.0"},"calculation":{"value":66,"unit":"mmHg"},"misconception_tags":["unit-omitted"],"topic":"Cardiovascular assessment","question_type":"calculation","pilot_batch":"SQIE-PILOT-2026-11-v1"}';
begin
  -- objects
  if to_regproc('public.ckri_question_meta_ok') is null then raise exception 'VERIFY-995 FAIL function missing'; end if; n := n + 1;
  if not exists (select 1 from pg_trigger where tgname = 'ckri_knowledge_version_meta_guard' and tgrelid = 'ckri_knowledge_version'::regclass and tgenabled <> 'D') then
    raise exception 'VERIFY-995 FAIL trigger missing or disabled'; end if; n := n + 1;

  -- every revision question already stored satisfies it (the pilot drafts included)
  select count(*) into bad from ckri_knowledge_version v join ckri_knowledge_resource r on r.id = v.resource_id
   where r.kind = 'revision_question' and not ckri_question_meta_ok(v.content);
  if bad <> 0 then raise exception 'VERIFY-995 FAIL % stored revision question(s) fail the shape', bad; end if; n := n + 1;

  -- the shape (accepted)
  if not ckri_question_meta_ok(good) then raise exception 'VERIFY-995 FAIL plain content refused'; end if; n := n + 1;
  if not ckri_question_meta_ok(good || v_full) then raise exception 'VERIFY-995 FAIL full metadata refused'; end if; n := n + 1;
  if not ckri_question_meta_ok(good || '{"difficulty":"advanced"}') then raise exception 'VERIFY-995 FAIL difficulty only refused'; end if; n := n + 1;
  -- the shape (refused)
  foreach ok in array array[
    ckri_question_meta_ok(good || '{"programme_code":"Not A Code"}'),
    ckri_question_meta_ok(good || '{"programme_code":5}'),
    ckri_question_meta_ok(good || '{"programme_label":""}'),
    ckri_question_meta_ok(good || '{"qualification_level":"Pre Reg"}'),
    ckri_question_meta_ok(good || '{"difficulty":"hard"}'),
    ckri_question_meta_ok(good || '{"difficulty":2}'),
    ckri_question_meta_ok(good || '{"references":"RM-10"}'),
    ckri_question_meta_ok(good || '{"references":["RM-10"]}'),
    ckri_question_meta_ok(good || '{"source_verification":"not verified"}'),
    ckri_question_meta_ok(good || '{"competency_mapping":["draft"]}'),
    ckri_question_meta_ok(good || '{"calculation":66}'),
    ckri_question_meta_ok(good || '{"misconception_tags":[1]}'),
    ckri_question_meta_ok(good || '{"misconception_tags":[""]}'),
    ckri_question_meta_ok(good || '{"question_type":"Calc!"}'),
    ckri_question_meta_ok(good || '{"topic":""}')
  ] loop
    k := k + 1;
    if ok then raise exception 'VERIFY-995 FAIL bad shape % of the refusal list was accepted', k; end if; n := n + 1;
  end loop;

  -- planted: the trigger refuses a bad shape on a revision question, and only there. The 442 authority guards (resource
  -- and version) are disabled INSIDE this transaction only, so no appointment is needed. The 995 trigger stays enabled.
  alter table ckri_knowledge_resource disable trigger ckri_knowledge_resource_guard;
  alter table ckri_knowledge_version disable trigger ckri_knowledge_version_guard;
  select id into v_actor from profiles order by created_at limit 1;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-995-q', 'revision_question', 'VERIFY 995 question', v_actor) returning id into v_res;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by)
    values (v_res, 1, good || v_full, 'educator', array[v_actor]) returning id into v_ver;
  n := n + 1;
  begin
    update ckri_knowledge_version set content = good || '{"difficulty":"very hard"}' where id = v_ver;
    raise exception 'VERIFY-995 FAIL bad shape stored by update';
  exception when others then
    if sqlerrm like 'VERIFY-995 FAIL%' then raise; end if;
    if sqlerrm not like '%not in the shape the library keeps%' then raise exception 'VERIFY-995 FAIL wrong refusal on update: %', sqlerrm; end if;
  end; n := n + 1;
  begin
    insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by)
      values (v_res, 2, good || '{"references":"none"}', 'educator', array[v_actor]);
    raise exception 'VERIFY-995 FAIL bad shape stored by insert';
  exception when others then
    if sqlerrm like 'VERIFY-995 FAIL%' then raise; end if;
    if sqlerrm not like '%not in the shape the library keeps%' then raise exception 'VERIFY-995 FAIL wrong refusal on insert: %', sqlerrm; end if;
  end; n := n + 1;
  update ckri_knowledge_version set content = good where id = v_ver; n := n + 1;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-995-e', 'explanation', 'VERIFY 995 explanation', v_actor) returning id into v_exp;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by)
    values (v_exp, 1, '{"body":"An explanation long enough to be stored here.","difficulty":"not checked for other kinds"}', 'educator', array[v_actor]);
  n := n + 1;

  raise exception 'VERIFY-995 PASS pass=%', n;
end $$;
