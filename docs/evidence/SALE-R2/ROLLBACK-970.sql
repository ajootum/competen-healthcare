-- ROLLBACK-970 (SALE-2026-11 R2, SALE-10): remove the transfer-check record.
-- Dropping the table removes the learners' transfer records (which sessions were transfer checks) and its policy with it.
-- Their answers stay as ordinary attempts in their revision sessions, and the learning state then counts them as ordinary
-- practice. The app fails closed without the table (no transfer check offered). Run only on an owner decision.
drop table if exists individual_scholar_transfer_check;
notify pgrst, 'reload schema';
