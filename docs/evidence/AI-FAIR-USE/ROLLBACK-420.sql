-- ====================================================================================================
-- APPLY THIS FILE WHOLE.
-- ====================================================================================================
-- ROLLBACK 420 (STAGING ONLY). Narrows the six allowance balances back to numeric(14, 4). It refuses if any stored
-- value has digits beyond four places, because narrowing would round a recorded balance.
do $$
begin
  if exists (select 1 from ai_allowance_account
              where included_cau <> round(included_cau, 4) or reserve_cau <> round(reserve_cau, 4) or used_cau <> round(used_cau, 4)
                 or reserved_cau <> round(reserved_cau, 4) or reserve_used_cau <> round(reserve_used_cau, 4) or reserve_reserved_cau <> round(reserve_reserved_cau, 4)) then
    raise exception 'ROLLBACK-420 refused: balances already use six places and would be rounded';
  end if;
end $$;

alter table ai_allowance_account alter column included_cau type numeric(14, 4);
alter table ai_allowance_account alter column reserve_cau type numeric(14, 4);
alter table ai_allowance_account alter column used_cau type numeric(14, 4);
alter table ai_allowance_account alter column reserved_cau type numeric(14, 4);
alter table ai_allowance_account alter column reserve_used_cau type numeric(14, 4);
alter table ai_allowance_account alter column reserve_reserved_cau type numeric(14, 4);

notify pgrst, 'reload schema';
