// THE PLATFORM PLANE'S DATA BOUNDARY — the allowlist, and the rule that judges a read against it.
// PLAT-OVERSIGHT-SURVEY-001 §6.2. Enforced by scripts/plane-boundary-harness.ts.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE RULE, STATED SO A MACHINE CAN CHECK IT
//
//   No file reachable by import from `src/app/super-admin/**` or `src/app/api/platform/**` may read a
//   `practice_*` table outside this allowlist, and for each allowlisted table the COLUMNS it selects are
//   declared here too. Anything not listed fails. Anything that cannot be parsed fails.
//
// ⚠ WHY THIS FILE EXISTS AT ALL, AND IT IS NOT A STYLE PREFERENCE.
//
// `src/lib/practice/operations.ts:3–7` says "nothing here can be widened by accident: the selects say
// so". That is a comment. Changing `select("workspace_id")` to `select("workspace_id, given_name")` is a
// four-word edit, and every other control in this codebase would let it through:
//
//   - RLS on `practice_*` is ENABLED WITH ZERO POLICIES (migration 191:319–332) and every platform page
//     holds the service-role client, so the database will not refuse the widened read;
//   - `requireHqContext` returns `admin` — that same client — as the first field of its context, so the
//     HQ guard decides who opens the page and never what the page reads;
//   - the access matrix models the door: `MatrixEntry` in scan.ts has no data dimension at all.
//
// So the distance between "five integers per practice" and clinical content is ONE JOIN, and nothing
// would refuse it. This file is the refusal.
//
// ⚠ IT DESCRIBES TODAY, DELIBERATELY. The allowlist was derived from what the platform closure actually
// reads, so it lands green and every later change is legible as a change. An allowlist written to the
// policy someone WISHES were true starts red, gets muted, and protects nothing.
//
// PENDING TIGHTENINGS — decided in §9, not yet expressed here. See PENDING at the bottom of this file.
//
// PURE, AND IMPORTS NOTHING. The scanner (plane-boundary-scan.ts) pulls in the TypeScript compiler and
// must not be imported by application code; this module may be, and §7.3 of the survey intends it to be:
// the practitioner-facing sentence about what the platform can see should be generated from
// `describeAllowlist()` so the sentence and the harness cannot diverge.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SelectKind =
  | "columns"      // .select("a, b")
  | "star"         // .select() or .select("*")
  | "none"         // the chain never selected anything
  | "unresolved";  // a select whose argument is not a literal this scanner can read

export type BoundarySite = {
  file: string;
  line: number;
  /** null when the table name could not be resolved to a literal — which is a FAILURE, never a pass. */
  table: string | null;
  /** Set when one `.from()` resolves to several tables (a table name held in a variable). */
  resolvedFrom: string | null;
  /** The source text of the `.from()` argument — the key a declared exception is written against. */
  argText: string;
  select: SelectKind;
  columns: string[];
  /** PostgREST embedded resources — `select("id, practice_patient(given_name)")`. The join, in a string. */
  embeds: { table: string; columns: string[] }[];
  /** `{ head: true }` — PostgREST returns the count and NO ROWS. */
  head: boolean;
  exactCount: boolean;
  /** The chain contains insert/update/upsert/delete. */
  write: boolean;
  verbs: string[];
  /** Columns named in .eq/.in/.order/… — REPORTED, NOT ASSERTED. See the note on FILTERS below. */
  filters: string[];
  chain: string;
  unresolved: string | null;
};

export type TablePolicy = {
  table: string;
  /**
   * Columns this plane may select. `"*"` allows the whole row and is only ever correct for a table that
   * holds no practitioner or patient data at all.
   */
  columns: readonly string[] | "*";
  /** A `{ head: true }` count is permitted: PostgREST returns a number and no rows. */
  count: boolean;
  why: string;
};

// ── THE ALLOWLIST ────────────────────────────────────────────────────────────────────────────────────
//
// Two clinical tables appear here. Both are present for exactly one column — `workspace_id`, the tenancy
// key — because the operator console counts rows to answer "is this practice being used" and "did the
// clinical loop close". Neither name, nor note, nor diagnosis, nor date of birth is reachable, and the
// harness is what makes that sentence true rather than aspirational.
//
// ⚠ `practice_audit_event` IS ABSENT ON PURPOSE. Survey §4.4: its payloads carry clinical detail, and it
// is the practice's own trail. Reaching it from a super-admin page must turn this harness red.

export const PRACTICE_ALLOWLIST: readonly TablePolicy[] = [
  {
    table: "practice_platform_flags",
    columns: ["flag", "enabled", "note"],
    count: true,
    why: "the three launch flags. Platform-owned configuration; holds nothing about any practice.",
  },
  {
    table: "pd_launch_attestation",
    columns: ["release_ref", "attested_at"],
    count: true,
    why:
      "CPR-PD-014 §8.2, the human attestation ledger created by migration 340. Only these two columns "
      + "are selected directly, and only to discover WHICH BUILD is under test -- the verdicts themselves "
      + "come through plat_pd_launch_attestation_current(), whose returned columns are fixed in the "
      + "function. It is platform governance about Competen Practice releases, not about any practice: "
      + "no workspace id, no practitioner, no patient. attested_by is a uuid rather than a name, "
      + "deliberately, so this table is not a second place a person's name can leak from.",
  },
  {
    table: "pd_ops_config",
    columns: ["config_key", "value_hours", "description"],
    count: true,
    why:
      "CPR-PD-014 §4.5 thresholds -- how many hours without progress marks a practice STALLED, and how "
      + "long a newly provisioned practice stays NEW. Platform-owned operational configuration created by "
      + "migration 339: two rows keyed by a string, holding integers and their own descriptions. It "
      + "names no practice and contains no tenant data, and it is read rather than hardcoded precisely "
      + "so the threshold is not UI magic.",
  },
  {
    table: "practice_entitlement",
    columns: ["id", "workspace_id", "product_code", "plan_code", "status", "starts_at", "ends_at", "source"],
    count: true,
    why:
      "⚠ `source` ADDED 2026-09-02 (migration 368, ADR-015 rung 3). It records WHICH source wrote a "
      + "period -- provisioning, payment, director or unknown -- so the rule about not silently "
      + "overriding a payment can ask about the period being changed rather than about whether the "
      + "practice has ever paid. It is a four-value enum naming a system component. It identifies no "
      + "person, carries no amount and no currency, and says nothing about a patient. "
      + "CPR-PD commercial administration, added 2026-09-02 by the owner's decision after their own "
      + "practice was locked out by a lapsed trial and NOTHING in this product could reactivate it. The "
      + "screen a member lands on says 'reactivating the plan restores access'; provisioning was the "
      + "only writer this table had ever had, and this plane refused even to read it -- so a practice "
      + "whose trial ended was told a remedy existed and given no way to reach it, by anybody. "
      + "hq.practice.commercial.manage (migration 367) is the right that fixes that, and it cannot act "
      + "on a table it cannot see. "
      + "WHAT IS EXPOSED IS THE PLAN WINDOW AND NOTHING ELSE: which product, which plan code, the "
      + "status, and the two dates. No patient, no practitioner, no clinical content and no diary -- "
      + "the row's only other column is sponsor_ref, a uuid pointing outside this table, and it is "
      + "deliberately NOT listed because nothing on this plane needs to resolve it. "
      + "workspace_id is here because the whole point is to act on ONE named practice, which the plane "
      + "already identifies through practice_workspace.",
  },
  {
    table: "practice_workspace",
    columns: [
      "id", "name", "type", "status", "owner_person_id", "country", "timezone",
      "created_at", "updated_at",
      // ⚠ ADDED BY MIGRATION 312 AND NOT TAUGHT TO THIS FILE UNTIL NOW. The Practices register
      // correctly refused to offer search by handle and cited a different table as the reason — a
      // refusal that was TRUE when written and became an oversight the moment 312 applied. Same class
      // as the recorded hq-scan rule: a new column must be taught to the boundary in the same commit
      // that creates it, or a surface goes on refusing something that has since become possible.
      //
      // Neither is sensitive. practice_handle is the human-facing identifier a practice puts on its own
      // materials, and product_code says which Competen product the workspace belongs to.
      "practice_handle", "product_code",
    ],
    count: true,
    why:
      "the operational row the console renders: which practices exist, who owns one, what state it is in. " +
      "`owner_person_id` is a join key to `profiles`, which is platform data the operator already " +
      "administers — see D1 under PENDING for the email/name tightening on that join.",
  },
  {
    table: "practice_membership",
    columns: ["workspace_id", "user_id", "role_code", "status", "joined_at", "created_at"],
    count: true,
    why:
      "⚠ WIDENED FROM COUNTED-NEVER-LISTED, 2026-08-18, BY OWNER DECISION FOR CPR-PD-004. This read " +
      "`['workspace_id'] -- counted, never listed`, and that sentence and the Practitioners module are " +
      "a direct contradiction: PD-004 prescribes a landlord-side roster of the people using Competen " +
      "Practice, and a roster is a list. The specification was commissioned knowing what it shows; a " +
      "Product Director who cannot see practitioners is not one. So the boundary moved rather than the " +
      "module being quietly reduced to a number. " +
      "⚠ WHAT THIS ADMITS IS A WORKING RELATIONSHIP, NOT A CLINICAL ONE. Who holds a seat, in which " +
      "practice, under what role, in what state, since when. That is employment-shaped information " +
      "about a professional using a product, and it is the same class the HQ appointments board " +
      "already shows about platform staff. " +
      "⚠ WHAT IT STILL REFUSES, AND THE REFUSALS ARE THE POINT: no email (D1 -- the owner's NAME is the " +
      "reasoned lookup, and the roster follows it), no clinical column, and nothing about what the " +
      "person did to a patient. `practice_patient`, `practice_appointment` and `practice_encounter` " +
      "below are untouched at workspace_id and must stay there -- the widening is one table wide, and " +
      "listing WHO WORKS HERE has never implied listing WHOM THEY SAW.",
  },
  {
    table: "practice_appointment",
    columns: ["workspace_id"],
    count: true,
    why: "counted, never listed. ⚠ TENANCY COLUMN ONLY — a patient's appointment time is not operational telemetry.",
  },
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ THE MOS SUBSTRATE — LANDLORD-OWNED, AND INVISIBLE TO THIS FILE UNTIL 2026-08-18.
  //
  // These fourteen tables were built FOR the Product Director workspace: the canonical subject registry,
  // the operational event envelope, the incident model and the five support record types. They are the
  // landlord's own records about running the product.
  //
  // They were read from `/super-admin` for the whole of that build and this allowlist never saw one of
  // them — not because anybody bypassed it, but because the scanner matched table names on the prefix
  // `practice_` and could not see a `mos_` read at all. Widening the prefix surfaced fourteen tables and
  // twelve read sites in a single run. The reads were always legitimate; the BLIND SPOT was the defect,
  // and it is the same one recorded against scan.ts: a guard that cannot see a new family reports
  // silence, and silence reads as safety.
  //
  // WHY `*` IS CORRECT HERE AND IS NOT CORRECT FOR practice_patient. This boundary exists to stop the
  // landlord reading a TENANT'S CLINICAL RECORD. None of these tables holds one — PD-009's acceptance
  // proves no support record type has a patient column, and the incident model carries a subject, a
  // journey and an owner. A landlord reading its own incident register is not a boundary crossing.
  //
  // ⚠ mos_event IS THE EXCEPTION AND KEEPS AN EXPLICIT COLUMN LIST, because it has a free-form metadata
  // column. That column carries a CHECK refusing thirteen patient keys, so a PHI write is rejected
  // rather than reviewed — and it is still not granted here, because this plane needs to know WHICH
  // journey ran and whether it succeeded, never what it was about.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // ⚠ EXACTLY WHAT IS READ, AND NOTHING ELSE. mos_subject_type and mos_support_event were on this list
  // for one run and came straight back off: the harness reported them as DEAD GRANTS, because nothing
  // on this plane reads either. A grant nobody uses is a door left open for nobody, and it is the kind
  // of thing that is still open years later when somebody does want to walk through it.
  ...(["mos_subject", "mos_journey", "mos_journey_event",
    "mos_incident", "mos_incident_open", "mos_incident_event",
    "mos_support_case", "mos_problem", "mos_problem_incident",
    "mos_escalation", "mos_postmortem", "mos_corrective_action"] as const).map(table => ({
      table,
      columns: "*" as const,
      count: true,
      why:
        "Landlord-owned operational substrate, built for this workspace. Holds no patient or "
        + "practitioner clinical record — the landlord's own incident, support and subject registers. "
        + "See the block comment above for why this was invisible to the boundary until 2026-08-18.",
    })),
  // ⚠ THE PD-003 PROJECTIONS. CPR-PD-003 Operationalisation §4: "PD-003 must not scan appointments and
  // encounters on each page load. Activity is a management-plane PROJECTION." The register reads these
  // two rows per practice instead of the event store, and §14 is why the shape matters: a projection
  // carries observed_at, so the surface can say HOW FRESH an answer is. A live query cannot — it only
  // knows it just ran, which is the claim that hides a refresher that stopped weeks ago.
  //
  // Neither holds clinical content: an activity row is a timestamp, a type and a count, and a health row
  // is one of six states with its reason and a drill-through reference.
  ...(["pd_practice_activity", "pd_practice_health"] as const).map(table => ({
    table,
    columns: "*" as const,
    count: true,
    why:
      "PD-003 management-plane projection. Landlord-authored summary state about a practice — a "
      + "timestamp, a type, a count, a health state and its reason. Holds no clinical content, and "
      + "carries observed_at so the register can state its own freshness rather than implying it is live.",
  })),
  {
    table: "mos_event",
    columns: ["practice_id", "journey_key", "event_name", "outcome", "occurred_at", "duration_ms"],
    count: true,
    why:
      "⚠ THE ONE STORE ON THIS PLANE THAT CANNOT CARRY CLINICAL CONTENT BY CONSTRUCTION, which is why "
      + "it is allowlisted where practice_appointment and practice_encounter are held to their tenancy "
      + "column alone. Its metadata column carries a CHECK constraint refusing thirteen patient keys — "
      + "patient_id, mrn, nhs_number, date_of_birth, diagnosis, medication, clinical_note and the rest — "
      + "so a PHI leak through this table is not a review failure waiting to happen, it is a rejected "
      + "write. And metadata is deliberately NOT allowlisted here regardless: this plane reads WHICH "
      + "journey ran, whether it succeeded and how long it took, never what it was about. "
      + "That distinction is the whole reason a landlord surface can state a practice's activity without "
      + "reading a single appointment: 'this practice completed forty bookings last week' is operational "
      + "telemetry, and 'here is who they saw' is the clinician's book.",
  },
  {
    table: "practice_session",
    columns: ["user_id"],
    count: true,
    why:
      "⚠ ONE COLUMN, ADDED 2026-08-18 FOR CPR-PD-004's 'seen in the last 30 days'. This is a sign-in " +
      "session, not a clinical session -- see practice-sessions.ts, which is the practitioner's WORKING " +
      "day and is a different table. " +
      "⚠ THE WINDOW AND THE REVOCATION ARE FILTERS, NEVER SELECTS. `last_seen_at` and `revoked_at` " +
      "narrow the query; neither is read back, so no timestamp and no device ever leaves the database " +
      "for this plane. What crosses is a set of user ids that had a live session inside the window -- " +
      "the minimum that can answer the question, and one bit per person rather than a history. " +
      "⚠ AND THE COLUMN IS AN UPDATE, WHICH IS WHY THE ANSWER IS THREE-VALUED AND NOT A METRIC. " +
      "security.ts:342 overwrites last_seen_at in place, so this can say 'seen in the window', 'not " +
      "seen', or 'no session ever recorded' -- and cannot say activity days, sessions per week or any " +
      "engagement score. PD-004 asks for those; the roster states that they have no source rather than " +
      "deriving them from the one bit this grant permits.",
  },
  {
    table: "practice_patient",
    columns: ["workspace_id"],
    count: true,
    why:
      "⚠ TENANCY COLUMN ONLY. This is the table the survey is about. `given_name`, `family_name`, " +
      "`date_of_birth` and every identifier on it are outside this plane, permanently.",
  },
  {
    table: "practice_encounter",
    columns: ["workspace_id"],
    count: true,
    why:
      "⚠ TENANCY COLUMN ONLY. `status` is filtered on to count SIGNED/AMENDED rows for the clinical-loop " +
      "gate, and a filter is not a select — see FILTERS below for what that does and does not cover.",
  },
  {
    table: "practice_invoice",
    columns: ["workspace_id"],
    count: true,
    why:
      "⚠ TENANCY COLUMN ONLY, counted never listed (added 2026-08-16 with the ops billing tiles). " +
      "The count answers \"is the money loop alive on this practice\", which is the same operational " +
      "question the encounter count answers. `total_minor`, `currency`, `patient_id` and every other " +
      "column are outside this plane permanently — a named practitioner's revenue is business " +
      "intelligence about their book, exactly what D2's banding exists to prevent.",
  },
  {
    table: "practice_payment",
    columns: ["workspace_id"],
    count: true,
    why:
      "⚠ TENANCY COLUMN ONLY, counted never listed. Amounts, methods and collectors stay on the " +
      "practice plane; the platform sees only that payments are being recorded at all.",
  },
  {
    table: "practice_role_capabilities",
    columns: [],
    count: true,
    why: "row count only, to prove migrations 191–194 are live. No column is selected.",
  },
  {
    table: "practice_plans",
    columns: ["plan_code", "name", "trial_days", "active"],
    count: true,
    why:
      "⚠ WIDENED 2026-09-02 FROM row-count-only, for CPR-PD-PROV-001 §4 step 2. The provisioning " +
      "wizard makes a Product Director choose the access basis a new practice is created on, and §3 " +
      "requires that the codes and names come from canonical commercial configuration rather than " +
      "being written into the component -- which is not possible from a plane that may only count the " +
      "rows. THE REASON THIS IS A SMALL DECISION: `practice_plans` is a CATALOGUE, not tenant data. It " +
      "has one row per plan the whole product offers, names no practice, no person and no workspace, " +
      "and carries no money -- amount_minor and currency exist on it but are NOT taken here, so the " +
      "'carries no money' claim the previous entry made stays true of what this plane can read.",
  },
  {
    table: "practice_onboarding_step_catalog",
    columns: [],
    count: true,
    why: "row count only, for the seed gate.",
  },
  {
    table: "practice_identifier_format",
    columns: "*",
    count: true,
    why:
      "the SHAPE of a practitioner number — prefix, digits, check digit, version. Platform-owned " +
      "configuration with a single row and no subject, which is why `*` is honest here and nowhere else.",
  },
  {
    table: "practice_identifier_format_history",
    columns: "*",
    count: true,
    why: "the change log of that shape. Same subject as above: the format, not a person.",
  },
  {
    table: "practice_practitioner_identity",
    // ⚠ `user_id` ADDED 2026-08-18 AS A JOIN KEY AND NOTHING ELSE (CPR-PD-004). The roster shows a
    // practitioner NUMBER beside a name it already holds from profiles, and without this column the two
    // cannot be matched. It carries no information of its own that the caller does not already have --
    // it is the same identifier the membership row is keyed by. The "NO PROFILE FIELDS" rule below is
    // UNCHANGED and still binding: handle, display_name, discovery and the licence-verification columns
    // stay outside this plane, which is why the roster shows no profession or specialty.
    columns: ["practitioner_number", "number_format_version", "user_id"],
    count: true,
    why:
      "⚠ NO PROFILE FIELDS. `handle`, `display_name`, `discovery` and the licence-verification columns are " +
      "outside this plane. The two columns allowed are the identifier itself and the format version it was " +
      "issued under, read to refuse a format change that would strand the sequence " +
      "(identifier-format.ts:167). " +
      "⚠ Two notes. The survey's §6.2 allowlist omitted `number_format_version`, which is selected " +
      "beside `practitioner_number` in the same call and would have started the harness red. And that " +
      "call sits in `updateFormat`, reachable from the operator console only through " +
      "`/api/v1/practice/identifier-format` — an OUT_OF_SCOPE_OPERATOR_ROUTE — so within this rule's " +
      "entry set the columns are a dead grant and only the head-count is live. They are declared anyway " +
      "because the human surface is the same console; the harness prints them as unread.",
  },
];

/**
 * Stored functions this plane may call.
 *
 * ⚠ AN RPC IS A COLUMN RULE WITH THE COLUMNS HIDDEN INSIDE IT. A `practice_*` function can return
 * anything its body selects, and no amount of care about `.select()` strings sees inside one. Survey
 * §1.3 says there are no `.rpc()` calls "under src/app/super-admin/" — true of the directory, and the
 * closure disagrees: `identifier-format.ts:170` calls one, two imports from the identifiers page.
 */
export const PRACTICE_RPC_ALLOWLIST: readonly string[] = [
  // Returns the next integer of a sequence and nothing else. Called to refuse a format change that
  // would strand the numbering (identifier-format.ts:170).
  "practice_next_practitioner_sequence",

  // CPR-PD-014 §8.1. Returns EXACTLY eight operational fields per workspace — practice_id, stage,
  // steps_total, steps_completed, started_at, last_progress_at, completed_at, stalled_reason_code —
  // and cannot return anything else, because the columns are fixed in the function's own RETURNS TABLE
  // (migration 339).
  //
  // ⚠ IT EXISTS PRECISELY BECAUSE OF THE WARNING ABOVE. `practice_onboarding.step_data` holds
  // practitioner-entered payloads, and this plane must never receive them. Reading the table directly
  // would put a column rule on every caller for ever; a function that CANNOT select step_data moves the
  // rule into the substrate, where forgetting it is not possible. That is why the answer to "an RPC
  // hides its columns" here is a function whose columns are declared and auditable in one place.
  //
  // The catalogue it counts against is already allowlisted for row count only, which is all the
  // denominator needs.
  "plat_practice_onboarding_projection",
];

// ── WHAT THIS RULE DOES NOT COVER, SAID PLAINLY ──────────────────────────────────────────────────────
//
// FILTERS. `.eq("family_name", x)` names a column without selecting it, and a caller who can filter can
// in principle confirm a value by binary search. Asserting filter columns would fail every legitimate
// `.eq("id", …)` and `.in("workspace_id", …)` in the closure, so filters are COLLECTED AND REPORTED, not
// asserted. Saying so here is the point: an uncovered case that is written down is a known gap, and an
// uncovered case that is not is a false negative wearing a green tick.
//
// WRITES. `.insert()` / `.update()` without a `.select()` return no rows and disclose nothing, so they
// are reported and not judged. A write that reads rows back IS judged, because `.insert(x).select("…")`
// is a read with extra steps.
//
// RPC AND VIEWS. Survey §1.3 says there are no `.rpc()` calls "under `src/app/super-admin/`". True of
// the directory; the CLOSURE disagrees — `identifier-format.ts:170` calls one. The harness judges
// reachable `practice_*` RPCs against PRACTICE_RPC_ALLOWLIST above. Database VIEWS are a
// migration-level fact and are not re-derived here.
//
// ⚠ REACHABILITY IS BY SYMBOL, NOT BY BUNDLE, AND THAT IS A TRADE. The harness judges a read only when
// some export the platform plane imports can actually reach the declaration containing it. A read
// planted in a module that is bundled but uncallable does not turn it red. The alternative — bundle-level
// reachability — produces 23 refusals for reads no platform page can cause, all of them arriving through
// `identifier-format.ts:1 import { audit } from "@/lib/practice/provisioning"`, and an allowlist written
// to satisfy them would have to permit `practice_entitlement` and a practitioner's `biography`. The
// harness prints the bundled-but-uncallable set on every run so the trade stays visible.

// ── DECLARED BLIND SPOTS ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE PLATFORM PLANE READS TABLES WHOSE NAMES ARE NOT IN THE SOURCE. Nine reads in the reachable
// closure take their table from a runtime value — a registry row, a caller's argument, a request body —
// and no column rule can see through them. That is a real gap and it is NOT the survey's; §1.3 does not
// mention it, because a search for `practice_*` string literals cannot find a read that never spells
// one.
//
// They are listed rather than ignored, each with the reason it is not a practice read, so that:
//   - a NEW dynamic read fails the harness until somebody writes down why it is safe,
//   - a listed one that DISAPPEARS also fails (staleness), so the list cannot rot into fiction,
//   - the size of the list is visible, which is the honest measure of how much of this plane the
//     column rule does not cover.
//
// ⚠ NONE OF THESE IS A PRACTICE READ TODAY, AND THAT IS A HUMAN JUDGEMENT, NOT A PROOF. Each was read
// by hand at the line given. Where a table name arrives from outside the file the harness cannot
// confirm it, which is exactly why the exception has to be written down.
export type UnresolvedException = {
  /** Repo-relative path. */
  file: string;
  /** The source text of the `.from()` argument, as the scanner prints it. */
  arg: string;
  why: string;
};

export const UNRESOLVED_EXCEPTIONS: readonly UnresolvedException[] = [
  {
    file: "src/app/api/platform/comments/route.ts", arg: "entity.table",
    why: "COMMENT_ENTITIES is a local registry of comment subjects (hospitals, frameworks, plat_*). " +
      "The key comes from the request body and is looked up in that registry, so an unknown key yields " +
      "no table rather than an arbitrary one. No entry names a practice_* table.",
  },
  {
    file: "src/lib/assets/registry.ts", arg: "table",
    why: "probe(table) head-counts an arbitrary store to report which asset domains are populated. The " +
      "candidate names arrive from the asset registry's own domain list (competency/framework stores).",
  },
  {
    file: "src/lib/platform/monitoring.ts", arg: "p.table",
    why: "PROBES is a local list of subsystem health probes; each entry names a platform table and the " +
      "read is a head-only reachability count.",
  },
  {
    file: "src/lib/platform/provisioning.ts", arg: "c.table",
    why: "the tenant provisioning checklist, a local registry of plat_*/tenant tables.",
  },
  {
    file: "src/lib/qie/engines.ts", arg: "table",
    why: "probeStore(admin, tables, …) tries a list of candidate store names supplied by the QIE " +
      "catalogue to tell 'absent' from 'empty'; the candidates are quality/competency stores.",
  },
];

// ── ⚠ THE RULE'S OWN BLIND SPOT: OPERATOR ROUTES FILED UNDER THE PRACTICE PRODUCT ────────────────────
//
// §6.2 names two entry points — `src/app/super-admin/**` and `src/app/api/platform/**` — and FIVE
// super-admin-only API routes live in neither, because they are filed by PRODUCT and not by PLANE:
//
//   src/app/api/v1/practice/flags/route.ts                    flips the three launch flags
//   src/app/api/v1/practice/identifier-format/route.ts        changes the practitioner-number shape
//   src/app/api/v1/practice/operations/users/route.ts         the operator's reasoned user search
//   src/app/api/v1/practice/provisioning/individual/route.ts  provisions a workspace for a named user
//   src/app/api/v1/practice/provisioning/[requestId]/route.ts resumes a failed provisioning saga
//
// ⚠ THEY NO LONGER ANSWER 403 TO EVERY NON-SUPER CALLER, AND THAT WAS THE POINT (PD-014 build 2,
// 2026-08-17). This comment used to say they did. All five now gate on `hqApiGate([...])` against a
// named Practice capability instead of on ownership, because "answers 403 to a non-super caller" was
// describing a defect rather than a design: the Practice Product Director these endpoints exist to
// serve was refused by every one of them, while any super_admin invoked them holding no HQ position at
// all. What has NOT changed is why they are listed here -- none of them calls `requirePracticeContext`,
// so they are the platform plane by every test except their path, and this harness still does not judge
// their reads. Two of them reach `src/lib/practice/provisioning.ts`, whose reads it therefore skips.
//
// ⚠ THEY ARE NOT SILENTLY ADOPTED. Extending the entry set to cover them would force the allowlist to
// admit `practice_entitlement`, `practice_configuration`, `practice_onboarding`,
// `practice_role_assignment` and — through `provisioning.ts:191`'s dynamic import of
// `identity-service.ts` — a practitioner's `display_name`, `biography` and `qualifications`. That is a
// second, genuinely different surface (the provisioning saga, which BUILDS a practice) and it wants its
// own allowlist, not this one widened until it permits everything. Recording the five here keeps the gap
// visible; the harness asserts the list is exactly the set that exists, so a SIXTH one fails.
// ⚠ THE SIXTH ENTRY IS A DIFFERENT CASE FROM THE FIVE, AND IS RECORDED AS ONE RATHER THAN LUMPED IN.
// launch-attestation/route.ts is operator-plane by the same test -- hqApiGate, no requirePracticeContext
// -- but it reaches NO practice_* table at all. It writes one row to pd_launch_attestation, which is a
// platform table this allowlist already governs through plat_pd_launch_attestation_current(). So it is
// not an unjudged practice read like the other five: there is nothing here for the entry set to judge.
// It is declared because A6 asserts this list is EXACTLY the operator-only set, which is what makes a
// seventh route fail and get read by somebody.
// ⚠ THE SEVENTH IS A THIRD CASE AGAIN, and the difference is worth stating rather than filing it with
// the others. entitlement/route.ts reaches exactly one practice table -- practice_entitlement -- and
// that table is IN the allowlist above, with its own reason. So unlike the five it is not an unjudged
// read, and unlike launch-attestation it is not a route that touches no practice table at all: it is
// the first operator route whose practice reads this allowlist actually governs.
//
// It is declared here for one reason only: A6 asserts this list is EXACTLY the operator-only set, so an
// undeclared route fails whether or not its reads are safe. That assertion is what makes an EIGHTH one
// get read by a person, and weakening it to "unless the table is allowlisted" would give up the property
// that caught this route in the first place.
export const OUT_OF_SCOPE_OPERATOR_ROUTES: readonly string[] = [
  "src/app/api/v1/practice/entitlement/route.ts",
  "src/app/api/v1/practice/flags/route.ts",
  "src/app/api/v1/practice/launch-attestation/route.ts",
  "src/app/api/v1/practice/identifier-format/route.ts",
  "src/app/api/v1/practice/operations/users/route.ts",
  "src/app/api/v1/practice/provisioning/individual/route.ts",
  "src/app/api/v1/practice/provisioning/[requestId]/route.ts",
];

export type Verdict = {
  ok: boolean;
  code:
    | "ALLOWED" | "COUNT_ONLY" | "WRITE_NO_READBACK" | "UNRESOLVED_DECLARED"
    | "UNRESOLVED_TABLE" | "UNRESOLVED_SELECT" | "NO_TERMINAL"
    | "TABLE_NOT_ALLOWED" | "COLUMN_NOT_ALLOWED" | "STAR_NOT_ALLOWED" | "EMBED_NOT_ALLOWED";
  detail: string;
};

export const exceptionFor = (site: BoundarySite): UnresolvedException | undefined =>
  UNRESOLVED_EXCEPTIONS.find(e => e.file === site.file && e.arg === site.argText);

export const policyFor = (table: string): TablePolicy | undefined =>
  PRACTICE_ALLOWLIST.find(p => p.table === table);

/**
 * Judge one read against the allowlist. Pure — no filesystem, no source text — so the rule can be
 * exercised directly by the harness's controls with hand-built sites.
 *
 * ⚠ THE ORDER OF THESE BRANCHES IS THE CONTROL. Everything unparseable is refused BEFORE anything is
 * looked up, so a site the scanner failed to read can never fall through into "no practice table here".
 */
export function judge(site: BoundarySite): Verdict {
  // 1. Could not read the table name. scan.ts's house rule: unknown is never open — unless somebody has
  //    written down, in this file, why this particular read is not a practice read.
  if (site.table === null) {
    const declared = exceptionFor(site);
    return declared
      ? { ok: true, code: "UNRESOLVED_DECLARED", detail: `${site.file}: .from(${site.argText}) — ${declared.why}` }
      : { ok: false, code: "UNRESOLVED_TABLE", detail: site.unresolved ?? "the table name is not a literal" };
  }

  // 2. Could not read the select list, on a table we know is a practice table.
  if (site.select === "unresolved")
    return { ok: false, code: "UNRESOLVED_SELECT", detail: site.unresolved ?? `${site.table}: the select list is not a literal` };

  const policy = policyFor(site.table);

  // 3. A chain that neither selected nor wrote. Not obviously harmless — it is a query this scanner
  //    could not classify — so it is refused rather than assumed inert.
  if (site.select === "none" && !site.write)
    return { ok: false, code: "NO_TERMINAL", detail: `${site.table}: .from() with neither a select nor a write (verbs: ${site.verbs.join(".") || "none"})` };

  // 4. A write that reads nothing back discloses nothing.
  if (site.select === "none" && site.write)
    return { ok: true, code: "WRITE_NO_READBACK", detail: `${site.table}: ${site.verbs.join(".")} returns no rows` };

  if (!policy)
    return { ok: false, code: "TABLE_NOT_ALLOWED", detail: `${site.table} is not on the platform-plane allowlist` };

  // 5. `{ head: true }` returns the count and no rows, whatever the select list says. This is what makes
  //    `select("*", { count: "exact", head: true })` acceptable and `select("*")` not.
  if (site.head)
    return policy.count
      ? { ok: true, code: "COUNT_ONLY", detail: `${site.table}: head-only count, no rows returned` }
      : { ok: false, code: "COLUMN_NOT_ALLOWED", detail: `${site.table}: counting is not permitted` };

  if (site.select === "star")
    return policy.columns === "*"
      ? { ok: true, code: "ALLOWED", detail: `${site.table}: whole-row read, declared` }
      : { ok: false, code: "STAR_NOT_ALLOWED", detail: `${site.table}: select("*") reads every column; the allowlist names ${(policy.columns as readonly string[]).length}` };

  // 6. Embedded resources are foreign-table reads and are judged as such.
  for (const e of site.embeds) {
    const nested = judge({
      ...site, table: e.table, columns: e.columns, embeds: [], select: "columns",
      head: false, write: false, unresolved: null,
    });
    if (!nested.ok)
      return { ok: false, code: "EMBED_NOT_ALLOWED", detail: `${site.table} embeds ${e.table}(${e.columns.join(", ")}) — ${nested.detail}` };
  }

  if (policy.columns === "*")
    return { ok: true, code: "ALLOWED", detail: `${site.table}: whole-row read, declared` };

  const allowed = new Set(policy.columns);
  const bad = site.columns.filter(c => c !== "" && !allowed.has(c));
  if (bad.length)
    return { ok: false, code: "COLUMN_NOT_ALLOWED", detail: `${site.table}: ${bad.join(", ")} — allowed: ${[...allowed].join(", ") || "(count only)"}` };

  return { ok: true, code: "ALLOWED", detail: `${site.table}: ${site.columns.join(", ") || "(no columns)"}` };
}

// ── PENDING TIGHTENINGS ──────────────────────────────────────────────────────────────────────────────
//
// ⚠ DECIDED IN §9 AND NOT EXPRESSED ABOVE. They are recorded here because this file is where they land,
// and because a decision with no home drifts back into being an opinion.
//
//   D1 — OWNER NAME, NOT OWNER EMAIL, in the standing view. This does not move any line of the allowlist
//        above: the owner join is on `profiles`, which is not a `practice_*` table and is outside this
//        rule's subject. If D1 is to be enforced by a harness it needs a `profiles`-scoped allowlist that
//        distinguishes the STANDING loader from the reasoned search path
//        (`src/app/api/v1/practice/operations/users/route.ts`), where email stays legitimate. This
//        harness does not draw that distinction and does not claim to.
//
//   D2 — BUCKETED COUNTS (0 / 1–9 / 10–99 / 100+) in the standing view. Also invisible here, and for a
//        sharper reason: bucketing happens AFTER the read. The select is still `select("workspace_id")`
//        on the same four tables, so the boundary this file guards is identical before and after D2.
//        ⚠ If a future edit implements bucketing by reading a column instead of counting rows, that read
//        must appear above or it is refused — which is the correct outcome.
//
// Both are tightenings of what is DISPLAYED. This file governs what is READ. They meet only if a
// tightening removes a read, and neither does.

/** The field list for a practitioner-facing disclosure (§7.3), so the sentence cannot outrun the rule. */
export function describeAllowlist(): { table: string; columns: string; why: string }[] {
  return PRACTICE_ALLOWLIST.map(p => ({
    table: p.table,
    columns: p.columns === "*" ? "every column" : (p.columns.length ? p.columns.join(", ") : "row count only"),
    why: p.why,
  }));
}
