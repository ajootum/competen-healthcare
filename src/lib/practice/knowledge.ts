import { audit } from "@/lib/practice/audit";
import { requestApproval } from "@/lib/practice/delegation";
import type { EngineResult } from "@/lib/practice/encounters";
import {
  GUIDANCE_SECTIONS_AUTHORED, GUIDANCE_SECTIONS_DERIVED, GUIDANCE_SECTION_KEYS,
  GUIDANCE_TYPE_CODES, GUIDANCE_STATE_CODES, GUIDANCE_CHECKS, GUIDANCE_CONSTRAINTS,
  GUIDANCE_STATES_EDITABLE, GUIDANCE_FACETS, guidanceCanMove, guidanceMovesFrom,
  guidanceState, guidanceTypeLabel, GUIDANCE_NOT_MONITORED, GUIDANCE_MODULE_NAME,
} from "@/lib/practice/knowledge-constants";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-KS-001 PHASE 1 -- PRACTICE GUIDANCE. The engine.
//
// Guidelines, policies, protocols, SOPs, work instructions and standards: written once, approved by a
// colleague, published with a date, reviewed, superseded. CPR-KS-001's Engine 4, plus enough of its
// section 8 Asset Library to find what you wrote.
//
// The user-facing name is PRACTICE GUIDANCE and not "Knowledge Studio" -- see knowledge-constants.ts for
// the name collision and, more importantly, for why a tool that stores standing clinical instructions
// must not be named as though it acts on them.
//
// ⚠ NOTHING HERE EVALUATES A GUIDANCE DOCUMENT. Not one line of this file reads a threshold, watches a
// timing, or raises anything. GUIDANCE_NOT_MONITORED is on every document and on the paper.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE STORE THIS NEEDS, AND WHY NOTHING EXISTING CARRIES IT
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// Four existing tables were examined before proposing one. Each is written out because "we checked" is
// not a finding and five surveys this week found the answer was already in the schema.
//
//   practice_note_template (+ _section, migrations 195/204) -- THE CLOSEST, AND IT IS THE WRONG OBJECT.
//     Three independent refusals, any one of which is fatal:
//       (a) `kind` is a CHECK over seven values -- encounter_note, referral_letter, sick_note,
//           consultation_summary, procedure_note, discharge_summary, general. None of the eight
//           guidance types is among them, so writing a guideline needs a migration to that constraint
//           ANYWAY. There is no version of this where an existing table is used unchanged.
//       (b) `status` is a CHECK over draft/published/retired -- three states. CPR-KS-001 section 3 asks
//           for five, and the two missing ones (`in_review`, `approved`) are the entire point of the
//           phase: the product promise in miniature is a practitioner writing a protocol and a
//           COLLEAGUE APPROVING IT. Another migration to another CHECK.
//       (c) ⚠ AND THE ONE THAT SETTLES IT: A TEMPLATE IS NOT A DOCUMENT. practice_note_template exists
//           to be APPLIED -- generateFromTemplate() merges it against a patient and an encounter to
//           produce a practice_clinical_document. Every one of its rows appears in the "apply a
//           template" picker inside a consultation. A guideline is not applied to a patient; it is the
//           finished thing, and the practice's infection-control policy appearing in the pick-list
//           beside "Referral letter" during a consultation is a defect, not a feature. Two objects
//           with different lifecycles sharing a table is how `kind` ends up meaning two things.
//     The SECTION model is genuinely the right shape and is copied rather than shared -- heading,
//     prompt-beside-the-box, body, position, required. Migration 195's own reasoning about prompt text
//     never reaching the record is carried over verbatim in intent.
//
//   practice_library_document (+ practice_folder, migration 210) -- IT IS A FILE, NOT A DOCUMENT.
//     `storage_path`, `file_name`, `mime_type` and `byte_size integer not null check (byte_size > 0)`
//     are all NOT NULL. Authored guidance has no uploaded bytes, so every row would need an invented
//     path, an invented MIME type and a fake positive byte count -- the row could not be inserted
//     honestly. It also has no status, no version, no sections, no effective date and no approval link.
//     ⚠ It remains exactly right for what CPR-KS-001's Visual Designer was refused in favour of: a
//     poster made in Canva and uploaded. That is its job and this does not take it.
//
//   practice_approval_request (migration 208) -- FITS, AND IS USED UNCHANGED. `subject_kind` already
//     admits 'other', so the approval side of this phase needs NO MIGRATION AT ALL. It holds the
//     requester, the assignee, the decision, the decider, the timestamp and the note, and delegation.ts
//     already refuses anybody approving their own work. What it does not hold is the DOCUMENT -- it
//     carries a `subject_id` and a 300-character summary, and a guideline is not a summary.
//
//   practice_clinical_document (migration 195) -- PATIENT-SCOPED, and `doc_type` is another fixed CHECK.
//     A guideline belongs to no patient; giving it one to reuse the table would put a policy in
//     somebody's record.
//
//   policies (migration 007) and knowledge_objects (migration 025) -- ⚠ THE HONEST ONE. Both are real
//     versioned prose stores with working editors, and BOTH ARE UNREACHABLE. They are keyed on
//     hospital_id / framework_id, every surface redirects a non-super-admin, and practice_workspace
//     shares no table with that estate. Reuse means re-tenanting the competency estate -- a large
//     migration with real RLS risk across tables this phase does not touch. This build a third prose
//     store for the practice tenancy KNOWINGLY, which is a decision and not an oversight.
//
// ---- THE DDL --------------------------------------------------------------------------------------
//
// Two tables, one store. Plain idempotent statements, ASCII only, no do-blocks and no plpgsql, because
// the migration runner splits on semicolons.
//
// ⚠ NEVER .upsert() ONTO EITHER OF THESE. Both carry PARTIAL unique indexes, and an upsert whose
// conflict target does not match a real total unique index fails silently rather than loudly -- the
// trap that has already produced two silent write failures in this product. Every write below is an
// explicit insert or update, and no error from one is discarded.
//
//   -- ============================================================
//   -- MIGRATION 256: PRACTICE GUIDANCE (CPR-KS-001 Engine 4, Phase 1)
//   --
//   -- Guidelines, policies, protocols, SOPs, work instructions and standards, for a practice_workspace.
//   -- NOT a note template (a template is applied to a patient; this is the finished document), NOT a
//   -- library document (that is uploaded bytes), NOT a clinical document (that belongs to a patient).
//   -- Approval routes through the existing practice_approval_request with subject_kind 'other'.
//   -- ============================================================
//
//   create table if not exists practice_guidance_document (
//     id uuid primary key default gen_random_uuid(),
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//
//     -- The practice's own reference, e.g. SOP-014. Not a uuid: it is what people say out loud and
//     -- write on a noticeboard, and the partial unique index below is about this and not about the id.
//     code text not null check (char_length(code) between 1 and 40),
//     title text not null check (char_length(title) between 1 and 200),
//     summary text check (summary is null or char_length(summary) <= 600),
//
//     -- ⚠ THE EIGHT TYPES OF CPR-KS-001 ENGINE 4, AS A CHECK. This is the line section 8 of the survey
//     -- drew: a studio offering a ninth type produces rows the DATABASE rejects, and no front-end work
//     -- fixes it. A ninth type is a migration BEFORE the UI offers it, never after.
//     doc_type text not null check (doc_type in (
//       'guideline', 'policy', 'protocol', 'sop', 'work_instruction',
//       'clinical_standard', 'practice_standard', 'service_manual')),
//
//     specialty text,
//     -- Section 8 wants search by tag. Capped, because a hundred tags is a document nobody filed.
//     tags text[] not null default '{}'
//       check (array_length(tags, 1) is null or array_length(tags, 1) <= 12),
//
//     -- ACCOUNTABILITY, NOT PERMISSION. Naming an owner does not restrict who may edit, and the screen
//     -- says so -- an owner column that looked like an access rule and was not would be worse than none.
//     owner_id uuid,
//
//     -- CPR-KS-001 section 3's five. `in_review` and not `review`, because `review_on` on this same row
//     -- means something entirely different and a status that reads as a date is a bug waiting.
//     status text not null default 'draft'
//       check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
//     version integer not null default 1 check (version >= 1),
//
//     -- EVERY VERSION IS A ROW, linked backwards. practice_pathway_template's supersedes_template_id,
//     -- for its reason: an earlier version you can OPEN beats a snapshot you have to reconstruct, and
//     -- "every figure is the length of a list you can open" applies to version history too.
//     supersedes_id uuid references practice_guidance_document(id) on delete set null,
//
//     -- THE APPROVAL, IN THE EXISTING GENERIC ENGINE. subject_kind 'other' already exists, so this
//     -- reference is the whole of the approval integration.
//     --
//     -- ⚠ NO `on delete` CLAUSE, AND THAT IS THE CONSIDERED CHOICE OF THREE. Deleting the approval out
//     -- from under a published document would leave it in force with nothing behind it, so the deletion
//     -- must be refused -- but `on delete restrict` checks IMMEDIATELY, and both tables cascade from
//     -- practice_workspace, so dropping a workspace could abort depending on which cascade Postgres ran
//     -- first. `on delete set null` is worse: it is an UPDATE, so it would trip practice_guidance_in_force
//     -- on any published row. The DEFAULT (`no action`) is checked at END OF STATEMENT, which refuses a
//     -- lone deletion exactly as intended and lets a workspace cascade that removes both rows succeed.
//     approval_request_id uuid references practice_approval_request(id),
//
//     -- A DATE, NOT A TIMESTAMP. "In force from 1 January" is a day, and rendering a timezone-shifted
//     -- instant for it is how a document appears to start the evening before.
//     effective_from date,
//     review_on date,
//
//     published_at timestamptz,
//     published_by uuid,
//     archived_at timestamptz,
//     archived_reason text,
//
//     created_at timestamptz not null default now(),
//     created_by uuid,
//     updated_at timestamptz not null default now(),
//     updated_by uuid,
//
//     -- ⚠ PUBLISHED MEANS IN FORCE, AND IN FORCE NEEDS BOTH FACTS. A document nobody approved, or one
//     -- with no date it starts, is not something a ward can follow. THE ENGINE DOES NOT REPEAT THIS --
//     -- it reports the gap so somebody sees it before trying, and when they try anyway the database
//     -- refuses. The constraint is named in the refusal.
//     -- ⚠ WHAT IT CANNOT SEE: whether that approval was actually DECIDED. A PENDING request satisfies
//     -- this constraint. `APPROVAL_DECIDED` in knowledge-constants.ts is the engine's, and the split of
//     -- authority is written down so nobody later assumes the database covered both.
//     constraint practice_guidance_in_force
//       check (status <> 'published'
//              or (effective_from is not null and approval_request_id is not null)),
//
//     -- A review date on or before the day it starts is a document born overdue.
//     constraint practice_guidance_review_after_effect
//       check (review_on is null or effective_from is null or review_on > effective_from),
//
//     -- WITHDRAWING GUIDANCE WITHOUT SAYING WHY leaves the next person unable to tell "superseded" from
//     -- "found to be wrong", which is the only thing they need to know. Same rule as a rejected
//     -- approval requiring words.
//     -- ⚠ AS AMENDED BY MIGRATION 257. This shipped as `archived_reason is not null`, which accepted
//     -- "" and "   " because a blank string is not null -- the constraint refused a MISSING reason and
//     -- not an EMPTY one, which is not what its comment claimed. The btrim half is the correction.
//     constraint practice_guidance_archived_reason
//       check (status <> 'archived' or (archived_reason is not null and btrim(archived_reason) <> '')),
//
//     constraint practice_guidance_not_self_superseding
//       check (supersedes_id is null or supersedes_id <> id)
//   );
//
//   -- ⚠ THE RULE THAT DOES THE MOST WORK, AND IT IS PARTIAL ON PURPOSE. A practice may hold ten drafts
//   -- of SOP-014 and exactly ONE published one. Two documents in force under one reference is how a
//   -- ward follows the wrong one, and no amount of engine care prevents it if the database allows it.
//   -- Publishing a new version therefore requires withdrawing the old one, in that order.
//   create unique index if not exists ux_practice_guidance_published_code
//     on practice_guidance_document(workspace_id, lower(code)) where status = 'published';
//
//   create index if not exists idx_practice_guidance_library
//     on practice_guidance_document(workspace_id, status, doc_type);
//   create index if not exists idx_practice_guidance_review_due
//     on practice_guidance_document(workspace_id, review_on) where status = 'published';
//   create index if not exists idx_practice_guidance_supersedes
//     on practice_guidance_document(supersedes_id) where supersedes_id is not null;
//
//   -- ---- The eight authored sections ----------------------------------------------------------------
//   --
//   -- CPR-KS-001 Engine 4 names TEN template sections. Eight are rows here. The last two -- Review and
//   -- Approval -- are RENDERED FROM THE RECORD and are deliberately not writable: this product already
//   -- holds both facts in columns and in practice_approval_request, and a typed "Approved by Dr X on 3
//   -- March" on a document whose approval record says PENDING is a lie printed on clinical guidance
//   -- that nothing would ever catch, because nothing would be comparing them.
//
//   create table if not exists practice_guidance_section (
//     id uuid primary key default gen_random_uuid(),
//
//     -- ⚠ DENORMALISED FROM THE PARENT ON PURPOSE, and this is not laziness. It lets every write scope
//     -- itself IN THE UPDATE STATEMENT rather than after a prior read -- a bulk write verified by an
//     -- earlier read is one that writes whatever it was passed if the read and the write disagree.
//     -- It is written from the parent on insert and never afterwards; nothing updates it.
//     workspace_id uuid not null references practice_workspace(id) on delete cascade,
//     guidance_id uuid not null references practice_guidance_document(id) on delete cascade,
//
//     -- The eight, as a CHECK. A ninth section is a migration, for the same reason a ninth type is.
//     section_key text not null check (section_key in (
//       'purpose', 'scope', 'definitions', 'responsibilities',
//       'procedure', 'documentation', 'escalation', 'references')),
//     heading text not null check (char_length(heading) between 1 and 160),
//
//     -- A document, not a corpus. 20k characters is roughly four printed pages per section.
//     body text not null default '' check (char_length(body) <= 20000),
//     position integer not null check (position between 1 and 8),
//
//     -- ⚠ CARRIED ON THE ROW, not looked up from the catalogue at read time. A document records what was
//     -- required WHEN IT WAS WRITTEN, so tightening the catalogue next year cannot retrospectively
//     -- invalidate something already published. Enforced at publish by the ENGINE, because "these eight
//     -- sibling rows are non-empty" is not a fact a CHECK constraint can see.
//     required boolean not null default false
//   );
//
//   -- One section per key, and one section per slot. The second is not redundant: without it two
//   -- sections can both claim position 3 and the document's order becomes whatever the planner returns.
//   create unique index if not exists ux_practice_guidance_section_key
//     on practice_guidance_section(guidance_id, section_key);
//   create unique index if not exists ux_practice_guidance_section_position
//     on practice_guidance_section(guidance_id, position);
//
//   -- ---- Capabilities ------------------------------------------------------------------------------
//   --
//   -- NONE MINTED. Reading takes document.view and managing takes template.manage -- migration 210's
//   -- exact split for the document library, on its own reasoning that "the same people who write the
//   -- note templates keep the protocols". 47 codes were live when this was written and six invented
//   -- ones have shipped in this product; an invented code 403s for everybody and errors nowhere.
//
//   -- ---- RLS: deny-by-default ----------------------------------------------------------------------
//   alter table practice_guidance_document enable row level security;
//   alter table practice_guidance_section enable row level security;
//
//   notify pgrst, 'reload schema';
//
// ---- ⚠ UNTIL THAT MIGRATION IS APPLIED ------------------------------------------------------------
//
// Everything below is written against those tables and stops at the door rather than pretending.
// guidanceStorePresence() ASKS THE DATABASE -- it does not assume, and it does not use head+count,
// because a missing table and an empty table both return count === null and four "missing" results in
// the survey were exactly that trap. The library reports `state: "absent"` with the migration named, and
// every write returns STORE_ABSENT rather than a stack trace. The moment the migration lands, all of it
// works with no code change. This is patient-access.ts's ACCESS_PROFILE_STORE_ABSENT pattern, which was
// carrying an unbuilt intake for exactly as long as that was true.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const GUIDANCE_TABLE = "practice_guidance_document";
export const GUIDANCE_SECTION_TABLE = "practice_guidance_section";
/** Named in the absent-store message so nobody has to guess which migration is missing. */
export const GUIDANCE_MIGRATION = "practice-guidance (practice_guidance_document + practice_guidance_section)";

/** PostgREST's schema-cache miss and Postgres's undefined-table, which mean the same thing here. */
const MISSING_TABLE_CODES = new Set(["PGRST205", "PGRST202", "42P01"]);
const isMissingTable = (error: any) =>
  !!error && (MISSING_TABLE_CODES.has(String(error.code)) || /could not find the table/i.test(String(error.message ?? "")));
const isUniqueViolation = (error: any) =>
  !!error && (String(error.code) === "23505" || /duplicate key|unique constraint/i.test(String(error.message ?? "")));
const isCheckViolation = (error: any) =>
  !!error && (String(error.code) === "23514" || /violates check constraint/i.test(String(error.message ?? "")));

const storeAbsent = <T>(): EngineResult<T> => ({
  ok: false, status: 503, code: "STORE_ABSENT",
  message: `${GUIDANCE_MODULE_NAME} has no store in this deployment yet. Migration "${GUIDANCE_MIGRATION}" has not been applied, so there is nowhere for a guidance document to go.`,
});

// ── IS THE STORE THERE? ─────────────────────────────────────────────────────────────────────────────

export type GuidanceStorePresence = {
  present: boolean;
  /** ⚠ Three outcomes, not two. A read that FAILED is not a table that is missing. */
  state: "present" | "absent" | "failed";
  tables: { table: string; present: boolean }[];
  detail: string | null;
};

/**
 * Ask the database, one `select ... limit 1` per table.
 *
 * ⚠ NOT head+count. A missing table and an empty table BOTH return `count === null`, and reading that as
 * "missing" is the trap that produced four wrong answers in the survey this build follows. The error
 * CODE is the only thing that distinguishes them.
 */
export async function guidanceStorePresence(admin: any): Promise<GuidanceStorePresence> {
  const results: { table: string; present: boolean }[] = [];
  let failure: string | null = null;

  for (const table of [GUIDANCE_TABLE, GUIDANCE_SECTION_TABLE]) {
    const { error } = await admin.from(table).select("id").limit(1);
    if (!error) { results.push({ table, present: true }); continue; }
    if (isMissingTable(error)) { results.push({ table, present: false }); continue; }
    // Something else went wrong. That is not "absent" and it must not be reported as one.
    results.push({ table, present: false });
    failure = failure ?? `${table}: ${error.message}`;
  }

  if (failure) return { present: false, state: "failed", tables: results, detail: failure };
  const present = results.every(r => r.present);
  return {
    present, state: present ? "present" : "absent", tables: results,
    detail: present ? null
      : `Migration "${GUIDANCE_MIGRATION}" has not been applied. ${results.filter(r => !r.present).map(r => r.table).join(" and ")} do not exist.`,
  };
}

// ── PURE: ASSEMBLING THE TEN SECTIONS ───────────────────────────────────────────────────────────────

export type GuidanceApproval = {
  id: string; status: string; assigned_to: string | null; requested_by: string;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  assignedToName?: string | null; decidedByName?: string | null;
} | null;

export type RenderedSection = {
  key: string;
  heading: string;
  source: "authored" | "derived";
  position: number;
  required: boolean;
  /** Authored: what somebody wrote. Derived: what the record says. */
  body: string | null;
  /** ⚠ `not_checked` where the record has nothing to say. Never a blank that reads as "fine". */
  state: "written" | "empty" | "derived" | "not_checked";
  /** Only for not_checked: what it would take for this to say something. */
  note: string | null;
};

/**
 * The document as a reader sees it: eight authored sections then Review and Approval, RENDERED.
 *
 * ⚠ THE DERIVED TWO NEVER SHOW A BLANK. A guidance document with no review date and an Approval heading
 * followed by white space reads as approved-and-current to anybody skimming it. Where the record has
 * nothing, it says so, in the `not_checked` idiom -- slate, a hollow mark, and the reason.
 */
export function renderSections(
  doc: { effective_from: string | null; review_on: string | null; status: string; version: number },
  authored: { section_key: string; heading: string; body: string; position: number; required: boolean }[],
  approval: GuidanceApproval,
): RenderedSection[] {
  const byKey = new Map(authored.map(s => [s.section_key, s]));

  const written: RenderedSection[] = GUIDANCE_SECTIONS_AUTHORED.map(def => {
    const row = byKey.get(def.key);
    const body = (row?.body ?? "").trim();
    return {
      key: def.key,
      heading: row?.heading ?? def.heading,
      source: "authored" as const,
      position: row?.position ?? def.position ?? 0,
      required: row?.required ?? def.required,
      body: body || null,
      state: body ? ("written" as const) : ("empty" as const),
      note: body ? null : def.prompt,
    };
  }).sort((a, b) => a.position - b.position);

  const derived: RenderedSection[] = GUIDANCE_SECTIONS_DERIVED.map((def, i) => {
    const position = written.length + i + 1;

    if (def.key === "review") {
      if (!doc.effective_from && !doc.review_on)
        return {
          key: def.key, heading: def.heading, source: "derived" as const, position, required: false,
          body: null, state: "not_checked" as const,
          note: "No effective date and no review date are set, so nothing here can say whether this document is current or overdue. Neither is typed into the document -- both are set on it, and this section reads them.",
        };
      const parts = [
        doc.effective_from ? `In force from ${doc.effective_from}.` : "No effective date is set.",
        doc.review_on ? `To be reviewed by ${doc.review_on}.` : "⚠ No review date is set, so nothing brings this document back.",
        `Version ${doc.version}.`,
      ];
      return {
        key: def.key, heading: def.heading, source: "derived" as const, position, required: false,
        body: parts.join(" "), state: "derived" as const, note: null,
      };
    }

    // APPROVAL. The real decision or nothing -- never a sentence somebody typed.
    if (!approval)
      return {
        key: def.key, heading: def.heading, source: "derived" as const, position, required: false,
        body: null, state: "not_checked" as const,
        note: "No approval has been requested for this document. This section is read from the approval record rather than typed, so it cannot claim an approval that did not happen.",
      };
    if (approval.status !== "APPROVED")
      return {
        key: def.key, heading: def.heading, source: "derived" as const, position, required: false,
        body: null, state: "not_checked" as const,
        note: `An approval was requested and it is ${approval.status.toLowerCase()}. Until somebody decides it, there is no approval to show.`,
      };
    const who = approval.decidedByName ?? "a colleague";
    return {
      key: def.key, heading: def.heading, source: "derived" as const, position, required: false,
      body: `Approved by ${who}${approval.decided_at ? ` on ${approval.decided_at.slice(0, 10)}` : ""}.${approval.decision_note ? ` "${approval.decision_note}"` : ""}`,
      state: "derived" as const, note: null,
    };
  });

  return [...written, ...derived];
}

// ── PURE: PUBLISH READINESS ─────────────────────────────────────────────────────────────────────────

export type GuidanceCheckResult = {
  code: string; requirement: string; severity: string; authority: string;
  state: "pass" | "fail" | "not_checked";
  detail: string; wouldNeed: string | null;
};

/**
 * ⚠ THREE STATES, and `not_checked` is the honest answer for two rows whose facts have no column to live
 * in. Never a green tick and never silence -- publish-constants.ts's rule, and it is the same rule
 * because it is the same mistake: an unwarned screen reads as a cleared screen.
 *
 * The `database` rows are REPORTED, NOT RE-IMPLEMENTED. They restate what the constraint will do, so
 * somebody can see the gap before they try; when they try, the database refuses and the refusal comes
 * back with the constraint named. A rule written twice is a rule that will one day be written
 * differently in the two places.
 */
export function guidanceReadiness(
  doc: { effective_from: string | null; review_on: string | null; approval_request_id: string | null; status: string },
  authored: { section_key: string; body: string; required: boolean }[],
  approval: GuidanceApproval,
): { checks: GuidanceCheckResult[]; blockers: number; warnings: number; publishable: boolean } {
  const missingRequired = authored.filter(s => s.required && !(s.body ?? "").trim()).map(s => s.section_key);

  const checks: GuidanceCheckResult[] = GUIDANCE_CHECKS.map(def => {
    const base = {
      code: def.code, requirement: def.requirement, severity: def.severity,
      authority: def.authority, detail: def.detail, wouldNeed: def.wouldNeed,
    };
    if (def.authority === "absent") return { ...base, state: "not_checked" as const };
    if (def.authority === "build") return { ...base, state: "pass" as const };

    switch (def.code) {
      case "REQUIRED_SECTIONS":
        return {
          ...base, state: missingRequired.length === 0 ? ("pass" as const) : ("fail" as const),
          detail: missingRequired.length
            ? `${def.detail} Empty: ${missingRequired.join(", ")}.`
            : def.detail,
        };
      case "APPROVAL_DECIDED":
        return { ...base, state: approval?.status === "APPROVED" ? ("pass" as const) : ("fail" as const) };
      case "REVIEW_DATE_SET":
        return { ...base, state: doc.review_on ? ("pass" as const) : ("fail" as const) };
      case "APPROVAL_LINKED":
        return { ...base, state: doc.approval_request_id ? ("pass" as const) : ("fail" as const) };
      case "EFFECTIVE_FROM_SET":
        return { ...base, state: doc.effective_from ? ("pass" as const) : ("fail" as const) };
      case "CODE_NOT_IN_USE":
        // ⚠ DELIBERATELY NOT PRE-CHECKED AGAINST THE TABLE. The index is the rule. Reporting it as a
        // pass here would be a second implementation of it, and the two would eventually disagree --
        // so this reports the rule and the attempt is what tests it.
        return {
          ...base, state: "pass" as const,
          detail: `${def.detail} This is not pre-checked here: the index is the rule, and publishing is what tests it.`,
        };
      default:
        return { ...base, state: "not_checked" as const };
    }
  });

  const failing = checks.filter(c => c.state === "fail");
  return {
    checks,
    blockers: failing.filter(c => c.severity === "blocker").length,
    warnings: failing.filter(c => c.severity === "warning").length + checks.filter(c => c.state === "not_checked" && c.severity === "warning").length,
    publishable: failing.filter(c => c.severity === "blocker").length === 0,
  };
}

// ── READS ───────────────────────────────────────────────────────────────────────────────────────────

export type GuidanceLibrary = {
  /** ⚠ Three states. `failed` is not `absent` and neither is an empty library. */
  state: "ok" | "absent" | "failed";
  detail: string | null;
  items: any[];
  /** Every figure below is the length of a list, and each carries the filter that opens it. */
  counts: { key: string; label: string; total: number; href: string }[];
  /** Published documents whose review date has passed. A list, never a bare number. */
  reviewOverdue: any[];
  facets: { key: string; label: string; state: string; detail: string; wouldNeed: string | null }[];
  notMonitored: typeof GUIDANCE_NOT_MONITORED;
};

const LIBRARY_COLUMNS =
  "id, code, title, summary, doc_type, specialty, tags, owner_id, status, version, supersedes_id, " +
  "approval_request_id, effective_from, review_on, published_at, archived_at, archived_reason, " +
  "created_at, created_by, updated_at";

export async function guidanceLibrary(admin: any, workspaceId: string, opts: {
  q?: string | null; docType?: string | null; status?: string | null;
  specialty?: string | null; tag?: string | null; author?: string | null;
} = {}): Promise<GuidanceLibrary> {
  const shell = {
    items: [] as any[],
    counts: [] as { key: string; label: string; total: number; href: string }[],
    reviewOverdue: [] as any[],
    facets: [] as { key: string; label: string; state: string; detail: string; wouldNeed: string | null }[],
    notMonitored: GUIDANCE_NOT_MONITORED,
  };
  const facets = GUIDANCE_FACETS
    .map(f => ({ key: f.key, label: f.label, state: f.state as string, detail: f.detail, wouldNeed: f.wouldNeed }));

  // ⚠ NO SEPARATE PRESENCE PROBE ON THE PAGE PATH. The real query's own error CODE distinguishes a
  // missing table from a failed read, so the answer costs nothing extra once the store exists.
  // guidanceStorePresence() remains for diagnostics and for the harness, where asking directly is the
  // point. What is NOT done either way is head+count: a missing table and an empty table both return
  // count === null, and reading that as "missing" is the trap that produced four wrong answers in the
  // survey this build follows.
  let query = admin.from(GUIDANCE_TABLE).select(LIBRARY_COLUMNS).eq("workspace_id", workspaceId);
  if (opts.docType && GUIDANCE_TYPE_CODES.includes(opts.docType)) query = query.eq("doc_type", opts.docType);
  if (opts.status && GUIDANCE_STATE_CODES.includes(opts.status)) query = query.eq("status", opts.status);
  if (opts.specialty?.trim()) query = query.ilike("specialty", `%${opts.specialty.trim()}%`);
  if (opts.author) query = query.eq("created_by", opts.author);
  if (opts.tag?.trim()) query = query.contains("tags", [opts.tag.trim()]);
  if (opts.q?.trim()) {
    const term = opts.q.trim().replace(/[%,()]/g, " ");
    query = query.or(`title.ilike.%${term}%,code.ilike.%${term}%,summary.ilike.%${term}%`);
  }

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(400);
  if (isMissingTable(error))
    return {
      ...shell, facets, state: "absent",
      detail: `Migration "${GUIDANCE_MIGRATION}" has not been applied. ${GUIDANCE_TABLE} and ${GUIDANCE_SECTION_TABLE} do not exist.`,
    };
  // ⚠ A FAILED READ IS NEVER A ZERO. `data == null` with no error is also a failure, not an empty shelf.
  if (error || data == null)
    return { ...shell, facets, state: "failed", detail: error?.message ?? "the guidance library came back as neither rows nor an error" };

  const rows = data as any[];

  // Names, in one round trip. An unresolved uuid on a screen reads as data rot.
  const people = [...new Set(rows.flatMap(r => [r.created_by, r.owner_id]).filter(Boolean))];
  const { data: profiles } = people.length
    ? await admin.from("profiles").select("id, full_name").in("id", people)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));

  const items = rows.map(r => ({
    ...r,
    typeLabel: guidanceTypeLabel(r.doc_type),
    stateLabel: guidanceState(r.status)?.label ?? r.status,
    inForce: guidanceState(r.status)?.inForce ?? false,
    authorName: r.created_by ? nameOf.get(r.created_by) ?? null : null,
    ownerName: r.owner_id ? nameOf.get(r.owner_id) ?? null : null,
    href: `/practice/knowledge-studio/${r.id}`,
  }));

  // ⚠ COUNTED OFF THE ROWS ALREADY READ, not by a second query with a different filter. Two reads is
  // how a figure and the list it claims to describe come to disagree.
  const today = new Date().toISOString().slice(0, 10);
  const reviewOverdue = items.filter(i => i.status === "published" && i.review_on && i.review_on < today);

  const counts = [
    { key: "published", label: "In force", total: items.filter(i => i.status === "published").length,
      href: "/practice/knowledge-studio?status=published" },
    { key: "in_review", label: "Waiting for approval", total: items.filter(i => i.status === "in_review").length,
      href: "/practice/knowledge-studio?status=in_review" },
    { key: "approved", label: "Approved, not yet in force", total: items.filter(i => i.status === "approved").length,
      href: "/practice/knowledge-studio?status=approved" },
    { key: "draft", label: "Drafts", total: items.filter(i => i.status === "draft").length,
      href: "/practice/knowledge-studio?status=draft" },
    { key: "review_overdue", label: "Past their review date", total: reviewOverdue.length,
      href: "/practice/knowledge-studio?status=published&overdue=1" },
  ];

  return { state: "ok", detail: null, items, counts, reviewOverdue, facets, notMonitored: GUIDANCE_NOT_MONITORED };
}

export type GuidanceDetail = {
  state: "ok" | "absent" | "failed" | "not_found";
  detail: string | null;
  document: any | null;
  sections: RenderedSection[];
  authored: any[];
  approval: GuidanceApproval;
  readiness: ReturnType<typeof guidanceReadiness> | null;
  /** Older versions, as rows you can open. */
  history: any[];
  moves: { from: string; to: string; label: string; why: string }[];
  notMonitored: typeof GUIDANCE_NOT_MONITORED;
};

export async function getGuidance(admin: any, workspaceId: string, guidanceId: string): Promise<GuidanceDetail> {
  const empty: GuidanceDetail = {
    state: "absent", detail: null, document: null, sections: [], authored: [],
    approval: null, readiness: null, history: [], moves: [], notMonitored: GUIDANCE_NOT_MONITORED,
  };

  // Classified from the read's own error, for the reason in guidanceLibrary above.
  const { data: doc, error } = await admin.from(GUIDANCE_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", guidanceId).eq("workspace_id", workspaceId).maybeSingle();
  if (isMissingTable(error))
    return {
      ...empty, state: "absent",
      detail: `Migration "${GUIDANCE_MIGRATION}" has not been applied. ${GUIDANCE_TABLE} and ${GUIDANCE_SECTION_TABLE} do not exist.`,
    };
  if (error) return { ...empty, state: "failed", detail: error.message };
  if (!doc) return { ...empty, state: "not_found", detail: null };

  const { data: sections, error: sErr } = await admin.from(GUIDANCE_SECTION_TABLE)
    .select("id, section_key, heading, body, position, required")
    .eq("guidance_id", guidanceId).eq("workspace_id", workspaceId).order("position");
  if (sErr || sections == null)
    return { ...empty, state: "failed", detail: sErr?.message ?? "the document's sections came back as neither rows nor an error" };

  let approval: GuidanceApproval = null;
  if (doc.approval_request_id) {
    const { data: a } = await admin.from("practice_approval_request")
      .select("id, status, assigned_to, requested_by, decided_by, decided_at, decision_note")
      .eq("id", doc.approval_request_id).eq("workspace_id", workspaceId).maybeSingle();
    if (a) {
      const ids = [a.assigned_to, a.decided_by, a.requested_by].filter(Boolean);
      const { data: profiles } = ids.length
        ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
      const nameOf = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name]));
      approval = {
        ...a,
        assignedToName: a.assigned_to ? nameOf.get(a.assigned_to) ?? null : null,
        decidedByName: a.decided_by ? nameOf.get(a.decided_by) ?? null : null,
      };
    }
  }

  const authored = sections as any[];
  const { data: history } = await admin.from(GUIDANCE_TABLE)
    .select("id, code, title, status, version, published_at, archived_at, archived_reason")
    .eq("workspace_id", workspaceId).eq("supersedes_id", guidanceId);

  // And the chain backwards, one hop -- what this one replaced.
  const { data: replaced } = doc.supersedes_id
    ? await admin.from(GUIDANCE_TABLE)
      .select("id, code, title, status, version, published_at, archived_at, archived_reason")
      .eq("workspace_id", workspaceId).eq("id", doc.supersedes_id).maybeSingle()
    : { data: null };

  return {
    state: "ok", detail: null,
    document: {
      ...doc,
      typeLabel: guidanceTypeLabel(doc.doc_type),
      stateLabel: guidanceState(doc.status)?.label ?? doc.status,
      stateMeaning: guidanceState(doc.status)?.meaning ?? null,
      editable: GUIDANCE_STATES_EDITABLE.includes(doc.status),
      inForce: guidanceState(doc.status)?.inForce ?? false,
    },
    sections: renderSections(doc, authored, approval),
    authored,
    approval,
    readiness: guidanceReadiness(doc, authored, approval),
    history: [
      ...(replaced ? [{ ...replaced, relation: "replaced by this" }] : []),
      ...(((history ?? []) as any[]).map(h => ({ ...h, relation: "replaces this" }))),
    ],
    moves: guidanceMovesFrom(doc.status),
    notMonitored: GUIDANCE_NOT_MONITORED,
  };
}

// ── WRITES ──────────────────────────────────────────────────────────────────────────────────────────

const cleanTags = (tags: unknown): string[] => {
  const list = Array.isArray(tags) ? tags : [];
  return [...new Set(list.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
};

export async function createGuidance(admin: any, args: {
  workspaceId: string; code: string; title: string; docType: string;
  summary?: string | null; specialty?: string | null; tags?: unknown; ownerId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const code = args.code.trim();
  const title = args.title.trim();
  if (!code) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "give it a reference somebody can quote, like SOP-014" };
  if (!title) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the document needs a title" };
  // ⚠ CHECKED HERE TOO, because the CHECK constraint's refusal names a column and this names the eight.
  // The constraint is still the rule -- this is a better sentence in front of the same wall.
  if (!GUIDANCE_TYPE_CODES.includes(args.docType))
    return { ok: false, status: 400, code: "UNKNOWN_TYPE", message: `a guidance document is one of: ${GUIDANCE_TYPE_CODES.join(", ")}` };

  const { data, error } = await admin.from(GUIDANCE_TABLE).insert({
    workspace_id: args.workspaceId, code, title, doc_type: args.docType,
    summary: args.summary?.trim() || null, specialty: args.specialty?.trim() || null,
    tags: cleanTags(args.tags), owner_id: args.ownerId ?? args.actorId,
    status: "draft", version: 1, created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (isMissingTable(error)) return storeAbsent();
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  // THE EIGHT SECTIONS ARE CREATED WITH THE DOCUMENT, not on demand. A guidance document whose structure
  // depends on what its author remembered to add is not a structured document.
  const { error: sErr } = await admin.from(GUIDANCE_SECTION_TABLE).insert(
    GUIDANCE_SECTIONS_AUTHORED.map(s => ({
      workspace_id: args.workspaceId, guidance_id: data.id,
      section_key: s.key, heading: s.heading, body: "", position: s.position, required: s.required,
    })),
  );
  if (sErr) {
    // ⚠ NOT DISCARDED. A document with no sections is worse than no document, and the partial-index trap
    // in this codebase is precisely a write error nobody looked at. Roll the parent back and say so.
    await admin.from(GUIDANCE_TABLE).delete().eq("id", data.id).eq("workspace_id", args.workspaceId);
    return { ok: false, status: 400, code: "SECTIONS_NOT_CREATED", message: `the document's sections could not be created, so nothing was kept: ${sErr.message}` };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.guidance_created",
    payload: { guidanceId: data.id, code, docType: args.docType }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Edit a draft.
 *
 * ⚠ ONLY A DRAFT. registration-config.ts's rule for published templates, and it holds harder here: a
 * document that changes while a colleague is reading it is not the document they approved, and one that
 * changes after they approved it is an approval that means nothing. The forward path from anything that
 * is not a draft is reopen (approved) or a new version (published) -- both explicit acts.
 */
export async function updateGuidance(admin: any, args: {
  workspaceId: string; guidanceId: string;
  title?: string; summary?: string | null; specialty?: string | null; tags?: unknown;
  ownerId?: string | null; effectiveFrom?: string | null; reviewOn?: string | null;
  sections?: { key: string; body: string }[];
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ updated: true; sectionsWritten: number }>> {
  const { data: doc, error: rErr } = await admin.from(GUIDANCE_TABLE)
    .select("id, status, code").eq("id", args.guidanceId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (!GUIDANCE_STATES_EDITABLE.includes(doc.status))
    return {
      ok: false, status: 422, code: "NOT_EDITABLE",
      message: `this document is ${guidanceState(doc.status)?.label.toLowerCase() ?? doc.status} and cannot be edited. ${doc.status === "published" ? "Start a new version instead -- the one in force stays exactly as it was approved." : doc.status === "archived" ? "An archived document is a record of what the practice used to say." : "Withdraw it from review first, or re-open it if it has been approved."}`,
    };

  const patch: Record<string, unknown> = { updated_at: nowIso(), updated_by: args.actorId };
  if (args.title !== undefined) {
    if (!args.title.trim()) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the document needs a title" };
    patch.title = args.title.trim();
  }
  if (args.summary !== undefined) patch.summary = args.summary?.trim() || null;
  if (args.specialty !== undefined) patch.specialty = args.specialty?.trim() || null;
  if (args.tags !== undefined) patch.tags = cleanTags(args.tags);
  if (args.ownerId !== undefined) patch.owner_id = args.ownerId || null;
  if (args.effectiveFrom !== undefined) patch.effective_from = args.effectiveFrom || null;
  if (args.reviewOn !== undefined) patch.review_on = args.reviewOn || null;

  const { error } = await admin.from(GUIDANCE_TABLE).update(patch)
    .eq("id", doc.id).eq("workspace_id", args.workspaceId);
  if (error) {
    if (isCheckViolation(error) && /review_after_effect/.test(String(error.message)))
      return { ok: false, status: 422, code: "REVIEW_BEFORE_EFFECT", message: `the review date has to be after the effective date -- the database refuses it (${GUIDANCE_CONSTRAINTS.reviewAfterEffect}), because a document whose review has already passed on the day it starts is born overdue` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  let written = 0;
  for (const s of args.sections ?? []) {
    if (!GUIDANCE_SECTION_KEYS.includes(s.key))
      return { ok: false, status: 400, code: "UNKNOWN_SECTION", message: `"${s.key}" is not one of this document's sections: ${GUIDANCE_SECTION_KEYS.join(", ")}. Review and Approval are read from the record and cannot be typed.` };
    // ⚠ SCOPED IN THE UPDATE ITSELF -- workspace AND parent -- rather than trusted from a prior read.
    const { data: hit, error: uErr } = await admin.from(GUIDANCE_SECTION_TABLE)
      .update({ body: String(s.body ?? "") })
      .eq("guidance_id", doc.id).eq("workspace_id", args.workspaceId).eq("section_key", s.key)
      .select("id");
    if (uErr) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: uErr.message };
    written += ((hit ?? []) as any[]).length;
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.guidance_updated",
    payload: { guidanceId: doc.id, sections: written }, correlationId: args.correlationId,
  });
  return { ok: true, data: { updated: true, sectionsWritten: written } };
}

/** draft -> in_review, creating the approval request. */
export async function submitGuidanceForApproval(admin: any, args: {
  workspaceId: string; guidanceId: string; assignedTo?: string | null; urgency?: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ approvalId: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.guidanceId, "in_review");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  // The required sections have to say something before somebody is asked to read it. Sending an empty
  // Procedure for approval wastes the one scarce thing in this loop, which is a colleague's attention.
  const { data: sections } = await admin.from(GUIDANCE_SECTION_TABLE)
    .select("section_key, body, required").eq("guidance_id", doc.id).eq("workspace_id", args.workspaceId);
  const missing = ((sections ?? []) as any[]).filter(s => s.required && !String(s.body ?? "").trim());
  if (missing.length)
    return { ok: false, status: 422, code: "REQUIRED_SECTIONS_EMPTY", message: `these sections have to say something before this goes for approval: ${missing.map(m => m.section_key).join(", ")}` };

  const approval = await requestApproval(admin, {
    workspaceId: args.workspaceId,
    // ⚠ 'other' IS ALREADY IN MIGRATION 208's CHECK, which is why this phase needs no approval
    // migration. subject_id carries the guidance row, so the queue entry opens the document.
    subjectKind: "other", subjectId: doc.id, area: "guidance",
    summary: `${guidanceTypeLabel(doc.doc_type)} ${doc.code}: ${doc.title}`.slice(0, 300),
    urgency: args.urgency === "urgent" ? "urgent" : "routine",
    assignedTo: args.assignedTo ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!approval.ok) return approval;

  const { error } = await admin.from(GUIDANCE_TABLE)
    .update({ status: "in_review", approval_request_id: approval.data.id, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "draft");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.guidance_sent_for_approval",
    payload: { guidanceId: doc.id, approvalId: approval.data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { approvalId: approval.data.id } };
}

/**
 * Bring the document into line with the decision on its approval request.
 *
 * ⚠ THIS ENGINE DOES NOT DECIDE. delegation.ts's decideApproval() owns the decision, including its
 * refusal to let anybody approve their own work and its refusal of a rejection without words. This reads
 * what was decided. Writing a second approval path here would be a second place the self-approval rule
 * has to be remembered.
 */
export async function syncGuidanceApproval(admin: any, args: {
  workspaceId: string; guidanceId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; changed: boolean }>> {
  const { data: doc, error: rErr } = await admin.from(GUIDANCE_TABLE)
    .select("id, status, approval_request_id").eq("id", args.guidanceId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "in_review")
    return { ok: false, status: 422, code: "NOT_IN_REVIEW", message: `only a document in review follows its approval; this one is ${guidanceState(doc.status)?.label.toLowerCase() ?? doc.status}` };
  if (!doc.approval_request_id)
    return { ok: false, status: 422, code: "NO_APPROVAL", message: "this document is in review with no approval request behind it" };

  const { data: a } = await admin.from("practice_approval_request")
    .select("id, status, decision_note").eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!a) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (a.status === "PENDING") return { ok: true, data: { status: "in_review", changed: false } };

  // APPROVED -> approved. REJECTED or WITHDRAWN -> back to draft, and the approval link goes with it: a
  // rejected request left attached would satisfy the published-row constraint on a later attempt.
  const next = a.status === "APPROVED" ? "approved" : "draft";
  const { error } = await admin.from(GUIDANCE_TABLE).update({
    status: next,
    approval_request_id: next === "approved" ? doc.approval_request_id : null,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "in_review");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.guidance_${next}`,
    payload: { guidanceId: doc.id, approvalStatus: a.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: next, changed: true } };
}

/** in_review -> draft. The author takes it back, and the pending request goes with it. */
export async function withdrawGuidanceFromReview(admin: any, args: {
  workspaceId: string; guidanceId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.guidanceId, "draft");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  if (doc.approval_request_id)
    await admin.from("practice_approval_request")
      .update({ status: "WITHDRAWN", decided_at: nowIso(), decision_note: "the author took the document back for further work" })
      .eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).eq("status", "PENDING");

  const { error } = await admin.from(GUIDANCE_TABLE)
    .update({ status: "draft", approval_request_id: null, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", doc.status);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: doc.status === "approved" ? "practice.guidance_reopened" : "practice.guidance_withdrawn_from_review",
    payload: { guidanceId: doc.id, from: doc.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "draft" } };
}

/**
 * approved -> published.
 *
 * ⚠ THE PREDECESSOR IS ARCHIVED FIRST, AND THE ORDER IS THE WHOLE POINT. `ux_practice_guidance_published_code`
 * allows exactly one published row per reference, so publishing before withdrawing is refused by the
 * database. Nothing here pre-checks the code -- the index is the rule, and a unique violation comes back
 * as CODE_IN_USE with the index named rather than as a stack trace.
 */
export async function publishGuidance(admin: any, args: {
  workspaceId: string; guidanceId: string; effectiveFrom?: string | null; reviewOn?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; superseded: string | null }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.guidanceId, "published");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const effective = args.effectiveFrom ?? doc.effective_from ?? null;
  const review = args.reviewOn ?? doc.review_on ?? null;

  // The two engine-owned blockers, in front of the constraint rather than instead of it.
  const { data: sections } = await admin.from(GUIDANCE_SECTION_TABLE)
    .select("section_key, body, required").eq("guidance_id", doc.id).eq("workspace_id", args.workspaceId);
  const missing = ((sections ?? []) as any[]).filter(s => s.required && !String(s.body ?? "").trim());
  if (missing.length)
    return { ok: false, status: 422, code: "REQUIRED_SECTIONS_EMPTY", message: `these sections have to say something before this can be published: ${missing.map(m => m.section_key).join(", ")}` };

  const { data: approval } = doc.approval_request_id
    ? await admin.from("practice_approval_request").select("id, status")
      .eq("id", doc.approval_request_id).eq("workspace_id", args.workspaceId).maybeSingle()
    : { data: null };
  // ⚠ THE DATABASE CAN SEE THAT AN APPROVAL IS LINKED. Only this can see it was DECIDED.
  if (!approval || approval.status !== "APPROVED")
    return { ok: false, status: 422, code: "APPROVAL_NOT_DECIDED", message: "nobody has approved this yet. The database will accept a linked approval request; it cannot tell whether anybody decided it, and this can." };

  // Withdraw the predecessor FIRST. If this fails, publishing is not attempted -- an unarchived
  // predecessor plus a failed publish leaves the practice exactly where it was, which is recoverable.
  let superseded: string | null = null;
  if (doc.supersedes_id) {
    const { data: prev } = await admin.from(GUIDANCE_TABLE)
      .select("id, status, version").eq("id", doc.supersedes_id).eq("workspace_id", args.workspaceId).maybeSingle();
    if (prev && prev.status === "published") {
      const { error: aErr } = await admin.from(GUIDANCE_TABLE).update({
        status: "archived", archived_at: nowIso(),
        archived_reason: `superseded by version ${doc.version}`,
        updated_at: nowIso(), updated_by: args.actorId,
      }).eq("id", prev.id).eq("workspace_id", args.workspaceId).eq("status", "published");
      if (aErr) return { ok: false, status: 400, code: "PREDECESSOR_NOT_WITHDRAWN", message: `the version this replaces could not be withdrawn, so nothing was published: ${aErr.message}` };
      superseded = prev.id;
    }
  }

  const { error } = await admin.from(GUIDANCE_TABLE).update({
    status: "published", effective_from: effective, review_on: review,
    published_at: nowIso(), published_by: args.actorId, updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", "approved");

  if (error) {
    if (isUniqueViolation(error))
      return {
        ok: false, status: 409, code: "CODE_IN_USE",
        message: `another document is already published under "${doc.code}". The database refuses it (${GUIDANCE_CONSTRAINTS.publishedCode}): one reference, one document in force. Withdraw the one in force first.`,
      };
    if (isCheckViolation(error) && /in_force/.test(String(error.message)))
      return {
        ok: false, status: 422, code: "NOT_IN_FORCE_READY",
        message: `a published document needs an effective date and an approval on the record. The database refuses it (${GUIDANCE_CONSTRAINTS.inForce}).`,
      };
    if (isCheckViolation(error) && /review_after_effect/.test(String(error.message)))
      return { ok: false, status: 422, code: "REVIEW_BEFORE_EFFECT", message: `the review date has to be after the effective date (${GUIDANCE_CONSTRAINTS.reviewAfterEffect})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.guidance_published",
    payload: { guidanceId: doc.id, code: doc.code, version: doc.version, superseded },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "published", superseded } };
}

export async function archiveGuidance(admin: any, args: {
  workspaceId: string; guidanceId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  const loaded = await loadForMove(admin, args.workspaceId, args.guidanceId, "archived");
  if (!loaded.ok) return loaded;
  const doc = loaded.data;

  const reason = (args.reason ?? "").trim();
  // ⚠ THIS GUARD IS NOW A DELIBERATE DUPLICATE OF THE CONSTRAINT, WHICH IT WAS NOT WHEN IT WAS WRITTEN.
  // The history matters because the comment that used to sit here was true and then quietly stopped
  // being true, and only a harness assertion caught it.
  //
  // Against migration 256, probed live:
  //
  //     archived_reason = NULL          -> REFUSED 23514
  //     archived_reason = ""            -> ACCEPTED
  //     archived_reason = "   "         -> ACCEPTED
  //
  // 256 said `archived_reason is not null` and its own comment claimed that stopped a blank reason. A
  // blank string is not null, so it did not, and THIS FUNCTION WAS THE ONLY WALL. Migration 257 closed
  // it -- the constraint now reads `archived_reason is not null and btrim(archived_reason) <> ''` and
  // all three rows above are refused by the database.
  //
  // ⚠ SO WHY KEEP THIS. Two reasons, and neither is "belt and braces" for its own sake. It refuses
  // BEFORE the write, so the caller gets REASON_REQUIRED with a sentence a practitioner can act on
  // rather than a 23514 naming a constraint. And a check constraint is one migration away from being
  // dropped by somebody solving a different problem, whereas this is covered by a test. Deleting it
  // would not open the gap today -- it would move the refusal to the database and make the message
  // worse, which the harness asserts by CODE rather than by whether a refusal happened at all.
  //
  // ⚠ THE TWO REFUSALS THEREFORE CARRY DIFFERENT CODES. This one is REASON_REQUIRED; the constraint's
  // is REASON_REQUIRED_BY_DATABASE, naming the constraint. They were the same code until a harness run
  // proved that could not distinguish them -- an assertion on REASON_REQUIRED passed whether or not
  // this guard existed, because removing it merely handed a refusal under the same name to the layer
  // below. That is the exact shape of the vacuous assertions this codebase keeps finding, and a test
  // that cannot tell which layer refused is testing neither.
  //
  // ⚠ THE GAP THIS PARAGRAPH USED TO DECLARE IS CLOSED, by migration 257. It said the constraint SHOULD
  // be `(archived_reason is not null and btrim(archived_reason) <> '')` and that until it was, this
  // function was the only wall. That is now what the constraint says. The harness assertion that made
  // the closure visible -- 11u-gap -- is inverted rather than deleted, so a relaxation back to 256's
  // wording fails a test instead of quietly restoring the gap and this comment with it.
  if (!reason)
    return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this is being withdrawn. The next person needs to tell \"superseded\" from \"found to be wrong\"." };

  const { error } = await admin.from(GUIDANCE_TABLE).update({
    status: "archived", archived_at: nowIso(), archived_reason: reason,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", doc.id).eq("workspace_id", args.workspaceId).eq("status", doc.status);
  if (error) {
    if (isCheckViolation(error) && /archived_reason/.test(String(error.message)))
      return { ok: false, status: 422, code: "REASON_REQUIRED_BY_DATABASE", message: `the database refuses an archived document with no reason (${GUIDANCE_CONSTRAINTS.archivedReason})` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.guidance_archived",
    payload: { guidanceId: doc.id, from: doc.status, reason }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "archived" } };
}

/**
 * Start the next version of something that is in force.
 *
 * A NEW ROW, NOT AN EDIT. The version in force stays exactly as it was approved, and the new draft
 * carries its own sections copied forward. This is registration-config.ts's duplicate-to-draft rule and
 * practice_pathway_template's supersedes link, put together.
 */
export async function reviseGuidance(admin: any, args: {
  workspaceId: string; guidanceId: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number }>> {
  const { data: doc, error: rErr } = await admin.from(GUIDANCE_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", args.guidanceId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (rErr && isMissingTable(rErr)) return storeAbsent();
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (doc.status !== "published")
    return { ok: false, status: 422, code: "NOT_PUBLISHED", message: `only a document in force has a next version; this one is ${guidanceState(doc.status)?.label.toLowerCase() ?? doc.status}` };

  // One open draft per lineage. Two people revising the same protocol in parallel end with one of them
  // discovering their work was superseded by the other's, which is the version-control failure this
  // whole model exists to avoid.
  const { data: existing } = await admin.from(GUIDANCE_TABLE)
    .select("id, status, version").eq("workspace_id", args.workspaceId).eq("supersedes_id", doc.id)
    .neq("status", "archived").limit(1).maybeSingle();
  if (existing)
    return { ok: false, status: 409, code: "REVISION_OPEN", message: `version ${existing.version} of this document is already open (${guidanceState(existing.status)?.label.toLowerCase() ?? existing.status}). Finish or abandon it first.` };

  const { data: created, error } = await admin.from(GUIDANCE_TABLE).insert({
    workspace_id: args.workspaceId, code: doc.code, title: doc.title, summary: doc.summary,
    doc_type: doc.doc_type, specialty: doc.specialty, tags: doc.tags ?? [], owner_id: doc.owner_id,
    status: "draft", version: (doc.version ?? 1) + 1, supersedes_id: doc.id,
    // ⚠ THE APPROVAL IS NOT COPIED. A new version carries none of the old one's approval, because
    // nobody has read it. The dates are not copied either -- an effective date is about this version.
    approval_request_id: null, effective_from: null, review_on: null,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, version").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const { data: sections } = await admin.from(GUIDANCE_SECTION_TABLE)
    .select("section_key, heading, body, position, required").eq("guidance_id", doc.id).eq("workspace_id", args.workspaceId);
  const rows = ((sections ?? []) as any[]).length
    ? (sections as any[]).map(s => ({
        workspace_id: args.workspaceId, guidance_id: created.id, section_key: s.section_key,
        heading: s.heading, body: s.body, position: s.position, required: s.required,
      }))
    // The predecessor somehow had none. Start from the catalogue rather than producing an empty document.
    : GUIDANCE_SECTIONS_AUTHORED.map(s => ({
        workspace_id: args.workspaceId, guidance_id: created.id, section_key: s.key,
        heading: s.heading, body: "", position: s.position, required: s.required,
      }));

  const { error: sErr } = await admin.from(GUIDANCE_SECTION_TABLE).insert(rows);
  if (sErr) {
    await admin.from(GUIDANCE_TABLE).delete().eq("id", created.id).eq("workspace_id", args.workspaceId);
    return { ok: false, status: 400, code: "SECTIONS_NOT_CREATED", message: `the new version's sections could not be created, so nothing was kept: ${sErr.message}` };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.guidance_revised",
    payload: { guidanceId: created.id, supersedes: doc.id, version: created.version },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: created.id as string, version: created.version as number } };
}

// ── SHARED ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Load a document and refuse the move by NAME if it is not one that exists.
 *
 * ⚠ REFUSED BY NAME, NOT BY FALLING THROUGH. A transition that quietly does nothing is how somebody
 * comes to believe a document is published when it is not.
 */
async function loadForMove(admin: any, workspaceId: string, guidanceId: string, to: string): Promise<
  { ok: true; data: any } | { ok: false; status: number; code: string; message: string }
> {
  const { data: doc, error } = await admin.from(GUIDANCE_TABLE)
    .select(LIBRARY_COLUMNS).eq("id", guidanceId).eq("workspace_id", workspaceId).maybeSingle();
  if (error && isMissingTable(error)) return storeAbsent();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!doc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (!guidanceCanMove(doc.status, to)) {
    const from = guidanceState(doc.status)?.label.toLowerCase() ?? doc.status;
    const target = guidanceState(to)?.label.toLowerCase() ?? to;
    return {
      ok: false, status: 422, code: "MOVE_NOT_ALLOWED",
      message: `a ${from} document cannot become ${target}. From ${from}, the moves that exist are: ${
        guidanceMovesFrom(doc.status).map(t => t.label).join(", ") || "none -- this is where a document's life ends"
      }.`,
    };
  }
  return { ok: true, data: doc };
}
