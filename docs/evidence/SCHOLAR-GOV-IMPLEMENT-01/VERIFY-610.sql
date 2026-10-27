-- VERIFY-610: read-only. Every row must say true.
select 'bodies 5: 4 on the three levels, Holdings Technology Services beside them with no level' as check,
  (select count(*) = 5 and count(*) filter (where level is null) = 1
     and bool_and((code = 'holdings_technology_services') = (level is null)) from hq_gov_body) as ok
union all select 'seats 21 (5 board, 6 committee, 7 product, 3 Holdings technology)', (select count(*) from hq_gov_seat) = 21
union all select 'the Liaison is the Product and Technology portfolio, no linked position',
  (select seat_kind = 'portfolio' and body_code = 'scholar_product_operations' and authority_position_code is null from hq_gov_seat where code = 'portfolio_product_technology')
union all select 'board seats 5, none linked to a position', (select count(*) from hq_gov_seat where seat_kind = 'director' and authority_position_code is null) = 5
union all select 'nobody appointed', (select count(*) from hq_gov_seat_appointment) = 0
union all select 'no interest records', (select count(*) from hq_gov_interest_declaration) = 0
union all select 'relationships 7: 1 interim (Holdings), 6 pending, 0 approved',
  (select count(*) filter (where status = 'interim') = 1 and count(*) filter (where status = 'pending') = 6 and count(*) filter (where status = 'approved') = 0 from hq_gov_delegation)
union all select 'Product Lead reports to the corporate authority, the Committee only oversees it',
  (select count(*) filter (where relation = 'corporate_reporting' and from_body_code = 'scholar_board') = 1
      and count(*) filter (where relation = 'corporate_reporting' and from_body_code = 'scholar_governance_committee') = 0
     from hq_gov_delegation where to_body_code = 'scholar_product_operations')
union all select 'board not incorporated', (select constitution_status = 'pending_incorporation' from hq_gov_body where code = 'scholar_board')
union all select 'no governing document marked approved', (select count(*) from hq_gov_body where document_status = 'approved') = 0
union all select 'links 20 (13 workflow and escalation, 7 joint clearance: 3 Scholar, 4 Holdings)',
  (select count(*) = 20 and count(*) filter (where clearance_domain = 'scholar') = 3 and count(*) filter (where clearance_domain = 'holdings') = 4 from hq_gov_link)
union all select 'every routed link names an existing capability', not exists (select 1 from hq_gov_link l where l.route is not null and not exists (select 1 from hq_capability c where c.code = l.capability_code))
union all select 'AI escalation 5 ordered steps', (select count(distinct step) from hq_gov_link where kind = 'ai_escalation') = 5
union all select 'linked positions exist (CCR, QCM x2, IPA, Platform Director)', (select count(*) from hq_gov_seat where authority_position_code is not null) = 5
union all select 'status register 5, nothing verified', (select count(*) = 5 and count(*) filter (where status = 'verified') = 0 from hq_gov_status_item)
union all select 'no body, seat or appointment table has a capability column', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('hq_gov_body', 'hq_gov_seat', 'hq_gov_seat_appointment', 'hq_gov_delegation', 'hq_gov_status_item') and column_name like '%capabilit%')
union all select 'nothing recorded through the hq_gov functions yet', not exists (select 1 from audit_log where action like 'hq_gov_%');
