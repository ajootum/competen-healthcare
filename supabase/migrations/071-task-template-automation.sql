-- 071: Task Centre — recurrence & event auto-firing (SSW-TSK-001). Adds the
-- watermark the automation engine needs: last_generated_at (so recurrence fires
-- once per interval and event triggers only pick up entities newer than the last
-- run), plus pews_threshold for the PEWS-high trigger. Idempotent.

alter table op_task_templates add column if not exists last_generated_at timestamptz;
alter table op_task_templates add column if not exists pews_threshold int not null default 5;
create index if not exists idx_op_task_templates_auto on op_task_templates(active, recurrence, trigger_event);
