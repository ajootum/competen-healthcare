-- VERIFY 580 part B as a self-rolling-back probe (coordinator). Expect PASS, then the final rollback error.
do $$
begin
  begin
    insert into hq_position_capability (position_code, capability_code, source)
      values ('competency_author', 'hq.quality.competency.publish', 'position_default');
    raise notice 'FAIL B: granting publish to competency_author was accepted';
  exception when others then
    if sqlerrm ilike '%competency author cannot publish competency frameworks%' then raise notice 'PASS B: refused: %', sqlerrm;
    else raise notice 'FAIL B: refused for another reason: %', sqlerrm; end if;
  end;
  raise exception 'probe complete, rolled back';
end
$$;
