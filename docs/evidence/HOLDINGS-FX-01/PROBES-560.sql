-- PROBES 560 (staging only). Every write happens inside one DO block whose last statement raises, so the
-- whole block is rolled back. Each probe raises NOTICE PASS or FAIL. Expect 8 PASS, then the final
-- 'probes complete, rolled back' error, which is the rollback.
do $$
declare v_id uuid;
begin
  insert into holdings_fx_event (occurred_at, kind, to_currency, to_amount_minor, source_ref, recorded_by)
    values (now(), 'opening_balance', 'USD', 50000, 'PROBE-OPEN', gen_random_uuid()) returning id into v_id;
  raise notice 'PASS P1 opening balance accepted';

  begin
    insert into holdings_fx_event (occurred_at, kind, from_currency, from_amount_minor, to_currency, to_amount_minor, source_ref, recorded_by)
      values (now(), 'conversion', 'UGX', 3700000, 'USD', 100000, 'PROBE-CONV', gen_random_uuid());
    raise notice 'PASS P2 conversion accepted';
  exception when others then raise notice 'FAIL P2 conversion refused: %', sqlerrm; end;

  begin
    insert into holdings_fx_event (occurred_at, kind, from_currency, from_amount_minor, source_ref, recorded_by)
      values (now(), 'provider_payment', 'USD', 1000, 'PROBE-PAY', gen_random_uuid());
    raise notice 'FAIL P3 provider payment without counterparty accepted';
  exception when check_violation then raise notice 'PASS P3 provider payment needs a counterparty'; end;

  begin
    insert into holdings_fx_event (occurred_at, kind, from_currency, from_amount_minor, to_currency, to_amount_minor, source_ref, recorded_by)
      values (now(), 'conversion', 'USD', 100, 'USD', 100, 'PROBE-SAME', gen_random_uuid());
    raise notice 'FAIL P4 same-currency conversion accepted';
  exception when check_violation then raise notice 'PASS P4 same-currency conversion refused'; end;

  begin
    update holdings_fx_event set note = 'x' where id = v_id;
    raise notice 'FAIL P5 update accepted';
  exception when others then raise notice 'PASS P5 update refused'; end;

  begin
    delete from holdings_fx_event where id = v_id;
    raise notice 'FAIL P6 delete accepted';
  exception when others then raise notice 'PASS P6 delete refused'; end;

  insert into holdings_fx_event (occurred_at, kind, voids_id, source_ref, recorded_by)
    values (now(), 'void', v_id, 'PROBE-VOID', gen_random_uuid());
  begin
    insert into holdings_fx_event (occurred_at, kind, voids_id, source_ref, recorded_by)
      values (now(), 'void', v_id, 'PROBE-VOID2', gen_random_uuid());
    raise notice 'FAIL P7 second void accepted';
  exception when unique_violation then raise notice 'PASS P7 one void per entry'; end;

  begin
    insert into holdings_fx_event (occurred_at, kind, to_currency, to_amount_minor, source_ref, recorded_by)
      values (now(), 'opening_balance', 'usd', 1, 'PROBE-LOWER', gen_random_uuid());
    raise notice 'FAIL P8 lower-case currency accepted';
  exception when check_violation then raise notice 'PASS P8 currency must be an ISO code'; end;

  raise exception 'probes complete, rolled back';
end
$$;
