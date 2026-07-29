-- 122: COMP-023 Passport Verification & Sharing — consented, time-limited passport share links.
-- A professional mints an unguessable token that lets an external party VERIFY a consented subset of their
-- competency passport at a public /verify/<token> page, until it expires or is revoked. Plain, idempotent
-- statements only (no do-blocks). RLS = owner-read (defense in depth); the public verify page + the owner's
-- manage page both read via the service-role client (code-scoped). Writes go through service-role API routes.

create table if not exists passport_share_tokens (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  nurse_id    uuid not null references profiles(id) on delete cascade,
  hospital_id uuid references hospitals(id) on delete set null,
  scope       text not null default 'summary',   -- summary (counts only) | full (names + credentials)
  label       text,
  expires_at  timestamptz,
  consent     boolean not null default true,
  revoked     boolean not null default false,
  view_count  int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_pst_nurse on passport_share_tokens(nurse_id);
create index if not exists idx_pst_token on passport_share_tokens(token);
alter table passport_share_tokens enable row level security;
drop policy if exists pst_owner_read on passport_share_tokens;
create policy pst_owner_read on passport_share_tokens for select to authenticated using (nurse_id = auth.uid());
