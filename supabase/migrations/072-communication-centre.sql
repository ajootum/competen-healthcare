-- 072: Communication Centre (SSW-COM-001) — operational messaging & broadcasts.
-- op_messages is context-aware team/patient/task messaging; op_broadcasts are
-- ward/hospital announcements with priority, audience, expiry and emergency mode;
-- op_broadcast_acks tracks acknowledgement per recipient (the spec's ack tracking
-- + audit requirement). Escalation, handover and alert communication reuse the
-- existing op_escalations / op_handovers / op_safety_alerts / notifications tables.
-- Idempotent; RLS service-role only (writes via audited APIs).

create table if not exists op_messages (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  shift_id uuid references op_shifts(id) on delete set null,
  channel text not null default 'General',                -- conversation name (e.g. "Ward 3 Team")
  context_type text not null default 'team'
    check (context_type in ('team','patient','task','direct','general')),
  patient_id uuid references op_patients(id) on delete set null,
  body text not null,
  author_id uuid references profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_op_messages_channel on op_messages(hospital_id, channel, created_at desc);

create table if not exists op_broadcasts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references hospitals(id) on delete cascade,
  shift_id uuid references op_shifts(id) on delete set null,
  title text not null,
  body text,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  audience text not null default 'All Staff',
  target_count int not null default 0,                    -- intended recipients (for ack-rate)
  emergency boolean not null default false,
  expires_at timestamptz,
  author_id uuid references profiles(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_op_broadcasts_hospital on op_broadcasts(hospital_id, created_at desc);

create table if not exists op_broadcast_acks (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references op_broadcasts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  user_name text,
  acked_at timestamptz not null default now(),
  unique (broadcast_id, user_id)
);
create index if not exists idx_op_broadcast_acks_broadcast on op_broadcast_acks(broadcast_id);

alter table op_messages enable row level security;
alter table op_broadcasts enable row level security;
alter table op_broadcast_acks enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin
-- client behind audited, role-gated API routes.
