-- 150: CGR-027 — Competency learning linkage (the closed learning loop).
-- The platform can already see learning SIGNALS (op_incidents, audits, indicators) and competency CHANGES
-- (change_requests, framework versions) — but nothing records that a given signal CAUSED a given change.
-- COMP-028 flags this as its next-phase gap and CGR-027 states it on-page: without it, the learning loop is
-- only correlated, never provably closed. This table is that missing edge.
--
-- It records: SIGNAL (what we learned from) → TARGET (what changed as a result) → the transformation type,
-- rationale and governance status, plus the timing that makes "time from event to improvement" a REAL causal
-- measure (signal_date → implemented_at) rather than an inferred one.
--
-- Governance: a link is a governance assertion, so it carries a mandatory rationale and moves through
-- proposed → confirmed → implemented (or rejected) under human review. AI may propose; only people confirm.
-- Plain, idempotent statements only (no do-blocks). RLS = authenticated read; service-role writes.

create table if not exists competency_learning_links (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,

  -- ── SOURCE: the learning signal ──
  source_type       text not null default 'incident'
                      check (source_type in ('incident','audit_finding','quality_indicator','assessment_trend',
                                             'external_guideline','regulatory_change','feedback','other')),
  source_id         uuid,                    -- e.g. op_incidents.id; null for external/unstructured signals
  source_ref        text,                    -- human-readable reference (title, finding no., guideline name)
  signal_date       date,                    -- when the signal occurred — the clock starts here

  -- ── TARGET: what changed as a result ──
  target_type       text not null default 'competency'
                      check (target_type in ('competency','framework','change_request','assessment',
                                             'learning_path','policy','none')),
  target_id         uuid,                    -- framework_competencies.id / change_requests.id / …
  target_name       text,

  -- ── The transformation ──
  link_type         text not null default 'triggered_review'
                      check (link_type in ('triggered_review','caused_change','informed_evidence','no_action_required')),
  rationale         text not null,           -- mandatory: why this signal maps to this change
  status            text not null default 'proposed'
                      check (status in ('proposed','confirmed','implemented','rejected')),
  proposed_by_ai    boolean not null default false,

  -- ── Governance + loop timing ──
  confirmed_by      uuid references profiles(id) on delete set null,
  confirmed_by_name text,
  confirmed_at      timestamptz,
  implemented_at    timestamptz,             -- loop closed — signal_date → here = real time-to-improvement
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_cll_source   on competency_learning_links(source_type, source_id);
create index if not exists idx_cll_target   on competency_learning_links(target_type, target_id);
create index if not exists idx_cll_status   on competency_learning_links(status, created_at desc);
create index if not exists idx_cll_hospital on competency_learning_links(hospital_id, created_at desc);

-- One link per (signal → target) pair when both are structured records; re-proposing updates, not duplicates.
create unique index if not exists uq_cll_edge
  on competency_learning_links(source_type, source_id, target_type, target_id)
  where source_id is not null and target_id is not null;

alter table competency_learning_links enable row level security;
drop policy if exists competency_learning_links_read on competency_learning_links;
create policy competency_learning_links_read on competency_learning_links for select to authenticated using (true);

notify pgrst, 'reload schema';
