-- ROLLBACK 410 (STAGING ONLY). Removes the AI usage ledger, allowance accounts, rate tables, their guards and
-- accounting functions, and the hq.platform.ai.manage capability with its grant. Usage records made on staging
-- are lost. Run it whole.
drop function if exists public.ai_release_stale(int);
drop function if exists public.ai_release(text, text);
drop function if exists public.ai_settle(text, text, int, int, numeric, text);
drop function if exists public.ai_reserve(text, uuid, text, text, text, text, int, int, text, int, numeric, int);
drop table if exists ai_usage_ledger;
drop table if exists ai_allowance_account;
drop function if exists public.ai_price_at(text, text, timestamptz);
drop table if exists ai_price;
drop table if exists ai_fx_rate;
drop table if exists ai_cau_rate;
drop function if exists public.ai_usage_ledger_guard();
drop function if exists public.ai_allowance_account_guard();
drop function if exists public.ai_rate_history_guard();
delete from hq_position_capability where capability_code = 'hq.platform.ai.manage';
delete from hq_capability where code = 'hq.platform.ai.manage';
notify pgrst, 'reload schema';
