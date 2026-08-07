-- ============================================================
-- MIGRATION 256: PRACTICE GUIDANCE (CPR-KS-001 Engine 4, Phase 1)
--
-- Guidelines, policies, protocols, SOPs, work instructions and standards, for a practice_workspace.
-- NOT a note template (a template is applied to a patient. This is the finished document), NOT a
-- library document (that is uploaded bytes), NOT a clinical document (that belongs to a patient).
-- Approval routes through the existing practice_approval_request with subject_kind 'other'.
-- ============================================================

create table if not exists practice_guidance_document (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- The practice's own reference, e.g. SOP-014. Not a uuid: it is what people say out loud and
  -- write on a noticeboard, and the partial unique index below is about this and not about the id.
  code text not null check (char_length(code) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 600),

  -- WARNING: THE EIGHT TYPES OF CPR-KS-001 ENGINE 4, AS A CHECK. This is the line section 8 of the survey
  -- drew: a studio offering a ninth type produces rows the DATABASE rejects, and no front-end work
  -- fixes it. A ninth type is a migration BEFORE the UI offers it, never after.
  doc_type text not null check (doc_type in (
    'guideline', 'policy', 'protocol', 'sop', 'work_instruction',
    'clinical_standard', 'practice_standard', 'service_manual')),

  specialty text,
  -- Section 8 wants search by tag. Capped, because a hundred tags is a document nobody filed.
  tags text[] not null default '{}'
    check (array_length(tags, 1) is null or array_length(tags, 1) <= 12),

  -- ACCOUNTABILITY, NOT PERMISSION. Naming an owner does not restrict who may edit, and the screen
  -- says so -- an owner column that looked like an access rule and was not would be worse than none.
  owner_id uuid,

  -- CPR-KS-001 section 3's five. `in_review` and not `review`, because `review_on` on this same row
  -- means something entirely different and a status that reads as a date is a bug waiting.
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  version integer not null default 1 check (version >= 1),

  -- EVERY VERSION IS A ROW, linked backwards. practice_pathway_template's supersedes_template_id,
  -- for its reason: an earlier version you can OPEN beats a snapshot you have to reconstruct, and
  -- "every figure is the length of a list you can open" applies to version history too.
  supersedes_id uuid references practice_guidance_document(id) on delete set null,

  -- THE APPROVAL, IN THE EXISTING GENERIC ENGINE. subject_kind 'other' already exists, so this
  -- reference is the whole of the approval integration.
  --
  -- WARNING: NO `on delete` CLAUSE, AND THAT IS THE CONSIDERED CHOICE OF THREE. Deleting the approval out
  -- from under a published document would leave it in force with nothing behind it, so the deletion
  -- must be refused -- but `on delete restrict` checks IMMEDIATELY, and both tables cascade from
  -- practice_workspace, so dropping a workspace could abort depending on which cascade Postgres ran
  -- first. `on delete set null` is worse: it is an UPDATE, so it would trip practice_guidance_in_force
  -- on any published row. The DEFAULT (`no action`) is checked at END OF STATEMENT, which refuses a
  -- lone deletion exactly as intended and lets a workspace cascade that removes both rows succeed.
  approval_request_id uuid references practice_approval_request(id),

  -- A DATE, NOT A TIMESTAMP. "In force from 1 January" is a day, and rendering a timezone-shifted
  -- instant for it is how a document appears to start the evening before.
  effective_from date,
  review_on date,

  published_at timestamptz,
  published_by uuid,
  archived_at timestamptz,
  archived_reason text,

  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,

  -- WARNING: PUBLISHED MEANS IN FORCE, AND IN FORCE NEEDS BOTH FACTS. A document nobody approved, or one
  -- with no date it starts, is not something a ward can follow. THE ENGINE DOES NOT REPEAT THIS --
  -- it reports the gap so somebody sees it before trying, and when they try anyway the database
  -- refuses. The constraint is named in the refusal.
  -- WARNING: WHAT IT CANNOT SEE: whether that approval was actually DECIDED. A PENDING request satisfies
  -- this constraint. `APPROVAL_DECIDED` in knowledge-constants.ts is the engine's, and the split of
  -- authority is written down so nobody later assumes the database covered both.
  constraint practice_guidance_in_force
    check (status <> 'published'
           or (effective_from is not null and approval_request_id is not null)),

  -- A review date on or before the day it starts is a document born overdue.
  constraint practice_guidance_review_after_effect
    check (review_on is null or effective_from is null or review_on > effective_from),

  -- WITHDRAWING GUIDANCE WITHOUT SAYING WHY leaves the next person unable to tell "superseded" from
  -- "found to be wrong", which is the only thing they need to know. Same rule as a rejected
  -- approval requiring words.
  constraint practice_guidance_archived_reason
    check (status <> 'archived' or archived_reason is not null),

  constraint practice_guidance_not_self_superseding
    check (supersedes_id is null or supersedes_id <> id)
);

-- WARNING: THE RULE THAT DOES THE MOST WORK, AND IT IS PARTIAL ON PURPOSE. A practice may hold ten drafts
-- of SOP-014 and exactly ONE published one. Two documents in force under one reference is how a
-- ward follows the wrong one, and no amount of engine care prevents it if the database allows it.
-- Publishing a new version therefore requires withdrawing the old one, in that order.
create unique index if not exists ux_practice_guidance_published_code
  on practice_guidance_document(workspace_id, lower(code)) where status = 'published';

create index if not exists idx_practice_guidance_library
  on practice_guidance_document(workspace_id, status, doc_type);
create index if not exists idx_practice_guidance_review_due
  on practice_guidance_document(workspace_id, review_on) where status = 'published';
create index if not exists idx_practice_guidance_supersedes
  on practice_guidance_document(supersedes_id) where supersedes_id is not null;

-- ---- The eight authored sections ----------------------------------------------------------------
--
-- CPR-KS-001 Engine 4 names TEN template sections. Eight are rows here. The last two -- Review and
-- Approval -- are RENDERED FROM THE RECORD and are deliberately not writable: this product already
-- holds both facts in columns and in practice_approval_request, and a typed "Approved by Dr X on 3
-- March" on a document whose approval record says PENDING is a lie printed on clinical guidance
-- that nothing would ever catch, because nothing would be comparing them.

create table if not exists practice_guidance_section (
  id uuid primary key default gen_random_uuid(),

  -- WARNING: DENORMALISED FROM THE PARENT ON PURPOSE, and this is not laziness. It lets every write scope
  -- itself IN THE UPDATE STATEMENT rather than after a prior read -- a bulk write verified by an
  -- earlier read is one that writes whatever it was passed if the read and the write disagree.
  -- It is written from the parent on insert and never afterwards. Nothing updates it.
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  guidance_id uuid not null references practice_guidance_document(id) on delete cascade,

  -- The eight, as a CHECK. A ninth section is a migration, for the same reason a ninth type is.
  section_key text not null check (section_key in (
    'purpose', 'scope', 'definitions', 'responsibilities',
    'procedure', 'documentation', 'escalation', 'references')),
  heading text not null check (char_length(heading) between 1 and 160),

  -- A document, not a corpus. 20k characters is roughly four printed pages per section.
  body text not null default '' check (char_length(body) <= 20000),
  position integer not null check (position between 1 and 8),

  -- WARNING: CARRIED ON THE ROW, not looked up from the catalogue at read time. A document records what was
  -- required WHEN IT WAS WRITTEN, so tightening the catalogue next year cannot retrospectively
  -- invalidate something already published. Enforced at publish by the ENGINE, because "these eight
  -- sibling rows are non-empty" is not a fact a CHECK constraint can see.
  required boolean not null default false
);

-- One section per key, and one section per slot. The second is not redundant: without it two
-- sections can both claim position 3 and the document's order becomes whatever the planner returns.
create unique index if not exists ux_practice_guidance_section_key
  on practice_guidance_section(guidance_id, section_key);
create unique index if not exists ux_practice_guidance_section_position
  on practice_guidance_section(guidance_id, position);

-- ---- Capabilities ------------------------------------------------------------------------------
--
-- NONE MINTED. Reading takes document.view and managing takes template.manage -- migration 210's
-- exact split for the document library, on its own reasoning that "the same people who write the
-- note templates keep the protocols". 47 codes were live when this was written and six invented
-- ones have shipped in this product. An invented code 403s for everybody and errors nowhere.

-- ---- RLS: deny-by-default ----------------------------------------------------------------------
alter table practice_guidance_document enable row level security;
alter table practice_guidance_section enable row level security;

notify pgrst, 'reload schema';

