-- 163: Message read receipts (UMW-TLS-004 "Read receipts").
--
-- THE GAP THIS CLOSES, which has now been flagged three times in this codebase:
--   * op_broadcasts already has op_broadcast_acks, so a broadcast knows who has read it.
--   * op_messages has NO read tracking at all. It is a CHANNEL store - hospital_id, channel, body,
--     author - with no recipient column and no read flag. Anything claiming a per-user unread count from
--     it was inventing one, which is why the global header's message badge was pointed at `notifications`
--     instead (PUI-002).
--
-- A channel store cannot carry read state on the message row itself: "read" is a fact about a (message,
-- person) PAIR, not about the message. So this is a join table, which is also what makes an honest unread
-- count possible: unread = messages in my channels with no read row for me.
--
-- Deliberately NOT added: a delivered/seen distinction, or typing indicators. Neither has a source of
-- truth here, and both would be theatre.
--
-- Plain idempotent statements only (no do-blocks). RLS = a user reads their OWN receipts; service-role writes.

create table if not exists op_message_reads (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references op_messages(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  read_at     timestamptz not null default now(),
  -- One receipt per person per message. Re-reading does not stack, and an upsert is the natural write.
  unique (message_id, user_id)
);

create index if not exists idx_op_message_reads_msg on op_message_reads(message_id);
create index if not exists idx_op_message_reads_user on op_message_reads(user_id, read_at desc);

alter table op_message_reads enable row level security;
drop policy if exists op_message_reads_own on op_message_reads;
create policy op_message_reads_own on op_message_reads for select to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
