-- MIGRATION 420: AI FAIR USE -- ALLOWANCE BALANCES AT THE LEDGER'S SCALE
--
-- COMPETEN-AI-FAIR-USE-01 and IND-007 D4, fix-forward on 410 (frozen). Coordinator range 419-424. Depends on 410.
--
-- APPLY ON STAGING FIRST. WIDENING ONLY. Six balance columns of ai_allowance_account go from numeric(14, 4) to
-- numeric(16, 6): the same ten integer digits, two more decimal places. Every stored value is kept exactly.
-- Re-running it is a no-op. OPS-001 s8: proposed Low (a widening type change, no function changed), with a
-- rollback rehearsal.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It makes an account hold exactly what the ledger reserved: the ledger's amounts (max_cau, settled_cau) are
-- numeric(14, 6), and the account's balances were numeric(14, 4), so a hold of 85.215438 was booked on the account
-- as 85.2154 and its release subtracted 85.215438 -- the account drifted from its ledger by up to 0.00005 CAU per
-- request (clamped at zero, never an overspend, but bookkeeping that does not reconcile).
--
-- Found by ai-fair-use-acceptance-harness X1 and X2 on staging, 24 October 2026, once the official UGX reference
-- rate (4,303.81) replaced a placeholder that happened to produce exact four-place amounts.
--
-- No function changes: ai_reserve, ai_settle and ai_release already write six-place amounts. The account guard
-- does not fire on a column type change.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-FAIR-USE/ROLLBACK-420.sql narrows the columns back, and refuses if any value
-- would be rounded.
-- ====================================================================================================

alter table ai_allowance_account alter column included_cau type numeric(16, 6);
alter table ai_allowance_account alter column reserve_cau type numeric(16, 6);
alter table ai_allowance_account alter column used_cau type numeric(16, 6);
alter table ai_allowance_account alter column reserved_cau type numeric(16, 6);
alter table ai_allowance_account alter column reserve_used_cau type numeric(16, 6);
alter table ai_allowance_account alter column reserve_reserved_cau type numeric(16, 6);

-- Verification: the six columns at numeric(16, 6).
select column_name, numeric_precision, numeric_scale from information_schema.columns
 where table_schema = 'public' and table_name = 'ai_allowance_account' and column_name like '%cau' order by 1;

notify pgrst, 'reload schema';
