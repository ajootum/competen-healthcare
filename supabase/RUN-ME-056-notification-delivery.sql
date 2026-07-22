-- ═══════════════════════════════════════════════════════════════════════════
-- 056 — Multi-channel notification delivery tracking (PFS-000 §12 / POS-001H)
-- The in-app notifications table stays the message store; this adds a delivery
-- log so every channel attempt (in-app, email, sms, webhook, …) is tracked with
-- a status. In-app and provider-backed channels record 'sent'/'failed';
-- channels with no provider configured record an honest 'skipped'.
-- RLS-locked (service-role only). Fail-soft: no table → tracking is skipped,
-- in-app notifications still deliver. Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists notif_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid references notifications(id) on delete set null,  -- the in-app row, when applicable
  user_id         uuid references profiles(id) on delete set null,
  channel         text not null check (channel in ('in_app','email','sms','webhook','teams','slack')),
  address         text,                            -- email / phone / endpoint the attempt targeted
  status          text not null default 'queued'
                    check (status in ('sent','queued','failed','skipped')),
  provider        text,                            -- resend | twilio | webhook | internal | null
  error           text,                            -- reason on failed/skipped
  created_at      timestamptz not null default now()
);
create index if not exists idx_notif_deliveries_created on notif_deliveries(created_at desc);
create index if not exists idx_notif_deliveries_channel on notif_deliveries(channel, status);

-- Lock to the service role (no policies = service-role only).
do $$
begin
  execute 'alter table public.notif_deliveries enable row level security';
end $$;
