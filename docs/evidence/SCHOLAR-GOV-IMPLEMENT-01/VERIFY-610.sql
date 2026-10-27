-- VERIFY-610: read-only. Every row must say true.
select 'bodies 5' as check, (select count(*) from hq_gov_body) = 5 as ok
union all select 'seats 22 (5 board, 6 committee, 7 product, 4 IT)', (select count(*) from hq_gov_seat) = 22
union all select 'board seats 5, none linked to a position', (select count(*) from hq_gov_seat where seat_kind = 'director' and authority_position_code is null) = 5
union all select 'nobody appointed', (select count(*) from hq_gov_seat_appointment) = 0
union all select 'no interest records', (select count(*) from hq_gov_interest_declaration) = 0
union all select 'delegations 4: 1 interim (Holdings), 3 pending, 0 approved',
  (select count(*) filter (where status = 'interim') = 1 and count(*) filter (where status = 'pending') = 3 and count(*) filter (where status = 'approved') = 0 from hq_gov_delegation)
union all select 'board not incorporated', (select constitution_status = 'pending_incorporation' from hq_gov_body where code = 'scholar_board')
union all select 'no governing document marked approved', (select count(*) from hq_gov_body where document_status = 'approved') = 0
union all select 'links 13 to existing capabilities', (select count(*) from hq_gov_link l join hq_capability c on c.code = l.capability_code) = 13
union all select 'AI escalation 5 ordered steps', (select count(distinct step) from hq_gov_link where kind = 'ai_escalation') = 5
union all select 'linked positions exist (CCR, QCM x2, IPA, Platform Director)', (select count(*) from hq_gov_seat where authority_position_code is not null) = 5
union all select 'no table has a capability column', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'hq\_gov\_%' and column_name like '%capabilit%' and table_name <> 'hq_gov_link')
union all select 'nothing recorded through the hq_gov functions yet', not exists (select 1 from audit_log where action like 'hq_gov_%');
