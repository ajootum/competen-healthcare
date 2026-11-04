-- VERIFY-995 (strict). Run on STAGING after 995. One block that ALWAYS raises, so the planted rows are never kept:
--   "VERIFY-995 PASS pass=N"  every check held (the runner reports it as a rolled-back error: nothing changed)
--   "VERIFY-995 FAIL ..."     the first check that did not hold
do $$
declare
  n int := 0;
  v_actor uuid;
  v_res uuid;
  v_ver uuid;
  v_exp uuid;
  ok boolean;
  good jsonb := '{"format":"short","stem":"What is the normal adult respiratory rate?","options":[],"answerKey":{"accepted":["12 to 20"]},"marking":"deterministic","rationale":"Adults breathe 12 to 20 times a minute at rest."}';
begin
  -- objects
  if to_regproc('public.ckri_question_meta_ok') is null then raise exception 'VERIFY-995 FAIL function missing'; end if; n := n + 1;
  if not exists (select 1 from pg_trigger where tgname = 'ckri_knowledge_version_meta_guard' and tgrelid = 'ckri_knowledge_version'::regclass and tgenabled <> 'D') then
    raise exception 'VERIFY-995 FAIL trigger missing or disabled'; end if; n := n + 1;

  -- the shape (accepted)
  if not ckri_question_meta_ok(good) then raise exception 'VERIFY-995 FAIL no meta refused'; end if; n := n + 1;
  if not ckri_question_meta_ok(good || '{"meta":{}}') then raise exception 'VERIFY-995 FAIL empty meta refused'; end if; n := n + 1;
  if not ckri_question_meta_ok(good || '{"meta":{"programmes":["bsc-nursing","diploma-nursing"],"level":"degree","difficulty":3}}') then raise exception 'VERIFY-995 FAIL full meta refused'; end if; n := n + 1;
  if not ckri_question_meta_ok(good || '{"meta":{"level":"postgraduate"}}') then raise exception 'VERIFY-995 FAIL level only refused'; end if; n := n + 1;
  -- the shape (refused)
  foreach ok in array array[
    ckri_question_meta_ok(good || '{"meta":"degree"}'),
    ckri_question_meta_ok(good || '{"meta":{"other":1}}'),
    ckri_question_meta_ok(good || '{"meta":{"programmes":[]}}'),
    ckri_question_meta_ok(good || '{"meta":{"programmes":["Not A Code"]}}'),
    ckri_question_meta_ok(good || '{"meta":{"programmes":[1]}}'),
    ckri_question_meta_ok(good || '{"meta":{"programmes":["a1","a2","a3","a4","a5","a6","a7","a8","a9","b1","b2"]}}'),
    ckri_question_meta_ok(good || '{"meta":{"level":"phd"}}'),
    ckri_question_meta_ok(good || '{"meta":{"difficulty":4}}'),
    ckri_question_meta_ok(good || '{"meta":{"difficulty":"2"}}'),
    ckri_question_meta_ok(good || '{"meta":{"difficulty":2.5}}')
  ] loop
    if ok then raise exception 'VERIFY-995 FAIL a bad meta was accepted (check % of the refusal list)', n - 5; end if; n := n + 1;
  end loop;

  -- planted: the trigger refuses a bad meta on a revision question, and only there. The 442 authority guards (resource
  -- and version) are disabled INSIDE this transaction only, so no appointment is needed. The 995 trigger stays enabled.
  alter table ckri_knowledge_resource disable trigger ckri_knowledge_resource_guard;
  alter table ckri_knowledge_version disable trigger ckri_knowledge_version_guard;
  select id into v_actor from profiles order by created_at limit 1;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-995-q', 'revision_question', 'VERIFY 995 question', v_actor) returning id into v_res;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by)
    values (v_res, 1, good || '{"meta":{"programmes":["bsc-nursing"],"level":"degree","difficulty":2}}', 'educator', array[v_actor]) returning id into v_ver;
  n := n + 1;
  begin
    update ckri_knowledge_version set content = good || '{"meta":{"difficulty":9}}' where id = v_ver;
    raise exception 'VERIFY-995 FAIL bad meta stored by update';
  exception when others then
    if sqlerrm like 'VERIFY-995 FAIL%' then raise; end if;
    if sqlerrm not like '%programme, level and difficulty%' then raise exception 'VERIFY-995 FAIL wrong refusal on update: %', sqlerrm; end if;
  end; n := n + 1;
  begin
    insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by)
      values (v_res, 2, good || '{"meta":{"level":"phd"}}', 'educator', array[v_actor]);
    raise exception 'VERIFY-995 FAIL bad meta stored by insert';
  exception when others then
    if sqlerrm like 'VERIFY-995 FAIL%' then raise; end if;
    if sqlerrm not like '%programme, level and difficulty%' then raise exception 'VERIFY-995 FAIL wrong refusal on insert: %', sqlerrm; end if;
  end; n := n + 1;
  update ckri_knowledge_version set content = good where id = v_ver; n := n + 1;
  insert into ckri_knowledge_resource (code, kind, title, created_by) values ('verify-995-e', 'explanation', 'VERIFY 995 explanation', v_actor) returning id into v_exp;
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, authored_by)
    values (v_exp, 1, '{"body":"An explanation long enough to be stored here.","meta":"not checked for other kinds"}', 'educator', array[v_actor]);
  n := n + 1;

  raise exception 'VERIFY-995 PASS pass=%', n;
end $$;
