-- ROLLBACK 650 (STAGING). Removes account classification and the default-view setting. Classification is an
-- administrative label that grants nothing, so removing it narrows and widens no access. The audit_log rows it
-- wrote stay as history. Production: not to be run without the owner. Fix forward instead.

drop trigger if exists trg_hq_account_classification_audit on hq_account_classification;
drop function if exists hq_account_classify(uuid, text, uuid[], text, text, text);
drop function if exists hq_users_default_view_set(uuid, text, text, text);
drop function if exists hq_account_classification_audit();
drop table if exists hq_account_classification;

alter table hq_config drop constraint if exists hq_config_users_default_view_check;
alter table hq_config drop column if exists users_default_view_updated_by;
alter table hq_config drop column if exists users_default_view_updated_at;
alter table hq_config drop column if exists users_default_view;

notify pgrst, 'reload schema';
