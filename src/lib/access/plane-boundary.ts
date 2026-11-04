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
  /**
   * When set, the table may be read ONLY by files whose repo-relative path starts with this prefix. A read from anywhere else
   * is refused even with the right columns. It is how an allowlist entry says WHO may read, not only what.
   */
  onlyFrom?: string;
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
  // SQIE-CLOSE-2026-11 WS-G (4 Nov 2026): the two SQIE-COMPLETE-01 entries that admitted individual_scholar_question
  // (id, library_version_id) and individual_scholar_attempt (question_id, correct, answered_at) are REMOVED. Library item
  // performance now reads only migration 996's functions (ckri_library_item_stats, ckri_question_format_correctness),
  // which count consenting learners only, suppress cells under the CKRI minimum cohort and return declared columns with
  // no learner id or content. Both tables stay governed (PLANE_TABLE_PREFIXES) with no entry, so any direct read of them
  // from this plane is refused.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // HQ-USERS-DIRECTORY-01 (owner GO 2 Nov 2026) -- THE USERS DIRECTORY AND THE USER PROFILE.
  //
  // The directory shows ACTUAL product entitlements, and the profile shows a person's access, their own education and
  // professional LABELS, and an administrative participation category. Every table below is named EXACTLY in
  // PLANE_TABLE_PREFIXES (plane-boundary-scan.ts), never as a prefix. `individual_scholar_learner_context` (the person's own
  // working record) is governed with no entry at all, so a read of it is refused. `individual_professional_profile_item` and
  // `_context` are not admitted by the professional entry and are not denied either, because verification and reminder code
  // in the closure reads them today: denying them is a separate decision.
  // ⚠ NONE OF THESE ADMITS A PRIVATE RECORD. No Scholar note, learning history, Personal AI, formative assessment, plan,
  // passport item, evidence, registration number, biography or photo is readable from here. Section 7 of the profile
  // says so on screen, and a planted read of individual_identity_profile.biography turns this harness red.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  {
    table: "individual_membership",
    columns: ["user_id", "status", "source", "onboarded_at", "created_at"],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. Gate 3 of the three-gate model: WHETHER a person holds Competen Individual and how it began. " +
      "`user_id` and `status` build the directory's product access and the Individual filter (user-directory.ts, the same rows the gate " +
      "reads), `user_id` alone is the reminder job's membership test, and `source`, `onboarded_at` and `created_at` are the profile's " +
      "Products section (hq_pilot_grant, signup or hq_grant, and whether the welcome was finished). `note`, the terms and privacy " +
      "acceptance versions, `primary_experience` (the person's own preference) and the granter ids are outside this plane. It is " +
      "employment-shaped access information of the class the HQ appointments board already shows, and it names no learning content.",
  },
  {
    table: "individual_entitlement",
    columns: ["id", "user_id", "experience_code", "status", "starts_at", "ends_at", "source", "plan_code", "granted_by", "created_at"],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. The access PERIODS a person holds: which experience (scholar or professional), its status, its dates, " +
      "the basis it was given on (pilot, hq_grant, payment, signup) and the plan code a paid period carries. `granted_by` is a uuid read " +
      "ONLY to print the grantor's NAME in the profile (profiles.full_name, the HQ staff member who gave the access), as the pilot " +
      "access board already attributes a grant. Outside this plane: `note`, the terms and privacy versions, the adult declaration and " +
      "confirmation columns, `operating_entity` and the checkout reference, so no payment amount, no declaration and no free text " +
      "leaves the table. Liveness is NEVER computed from these dates: the directory asks individual_live_entitlement.",
  },
  {
    table: "individual_live_entitlement",
    columns: ["id", "user_id", "experience_code", "ends_at", "source"],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. The periods that are live NOW on the DATABASE clock (the view exists so no caller compares the application " +
      "clock with a stored date). The directory reads `user_id`, `experience_code` and `ends_at` to print 'Scholar until 31 Jan 2027' " +
      "beside a person, the profile reads `id` to mark which period is live, and the unit-economics page reads `user_id` and `source` " +
      "to count paid against complimentary seats. Nothing else of the view is taken.",
  },
  {
    table: "individual_invitation",
    columns: [
      "id", "status", "invite_scholar", "invite_professional", "expires_at", "entitlement_ends_at", "created_at", "accepted_at",
      "revoked_at", "entitlement_source", "prefill",
    ],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. Where a person's invitation stands: which experiences it offered, when it expires, when the access it " +
      "grants ends, and (migration 850) which source it writes and the optional details HQ itself typed in when inviting, shown as 'Supplied " +
      "at invitation, not yet confirmed'. Found by the invited person's profile id, not by email. NEVER taken: `note` (free text), " +
      "the invited email and name (the profile already holds them), the revocation reason, and the adult-confirmation columns. " +
      "`prefill` is HQ-authored, an allowlist of eight short strings, and is never written into a learner-owned table.",
  },
  {
    table: "individual_live_invitation",
    columns: ["id"],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. One column. Which of a person's invitations can still be accepted NOW on the database clock, so an invitation " +
      "past its expiry reads 'Expired' rather than 'Waiting'. The row's other columns are not taken.",
  },
  {
    table: "individual_identity_profile",
    columns: ["user_id", "preferred_name"],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. TWO COLUMNS: whether the person has an identity profile at all, and the preferred name they chose, shown " +
      "next to the official name and marked 'Chosen by the person'. `headline`, `location`, `biography`, the photo path and mime and every " +
      "other column are the person's own display and are outside this plane permanently. The preferred name is learner-owned: HQ reads it " +
      "and cannot change it once the profile exists.",
  },
  {
    table: "individual_scholar_learner",
    columns: ["user_id", "programme_code", "level_label", "institution_label"],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01. The three LABELS the person chose for their study: programme, level and institution, shown read-only in " +
      "'Education & Professional Context' as 'Set by the person in Scholar'. Labels only. The codes behind level and institution, the " +
      "chosen-at time and every working record (individual_scholar_learner_context and the rest of the family) are outside this plane, which " +
      "is why this entry is an exact table name and not a prefix.",
  },
  {
    table: "individual_scholar_programme",
    columns: "*",
    count: true,
    why:
      "The Scholar programme CATALOGUE (migration 387): a profession, a country, a level and the framework link, one row per programme the " +
      "product offers. Platform-owned configuration that names no person, which is why `*` is honest here as it is for the identifier format. " +
      "Read by the programme administration pages and, since HQ-USERS-DIRECTORY-01, by the profile to print a programme's NAME where " +
      "the person's row holds its code.",
  },
  {
    table: "individual_professional_profile",
    columns: [
      "id", "user_id", "self_declared_profession", "self_declared_registration_body", "self_declared_registration_country",
      "self_declared_registration_expires_on", "registration_reminded_for",
    ],
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01 reads THREE LABELS the person declared: profession, registration body and registration country, shown read-only " +
      "and marked self-declared and unverified. The REGISTRATION NUMBER (`self_declared_registration_number`) is outside this plane and the " +
      "profile says it is not shown to HQ. The other columns here (`id`, `user_id`, the expiry date and the reminded-for date) are the " +
      "registration-reminder job's, reached through platform/jobs.ts from the CKP intelligence page, a read that existed before this entry and is " +
      "declared rather than hidden. It reads dates, never the number. The profile's items and context (individual_professional_profile_item and " +
      "_context: the person's CPD, skills and working notes) are separate tables and stay outside this plane.",
  },
  {
    table: "hq_account_participation",
    columns: "*",
    count: true,
    why:
      "HQ-USERS-DIRECTORY-01 (migration 850). HQ's OWN administrative label per person: regular, pilot or staff_tester, an optional cohort, an " +
      "optional end, who set it and why. It is landlord-authored, holds nothing the person wrote and nothing clinical, and DECIDES NO ACCESS: " +
      "no function, policy or guard reads it. `*` is honest here for the same reason it is for the MOS registers. The directory reads it to " +
      "filter by category and the profile shows it beside the person's actual entitlements. Absent until 850 is applied: every read here treats a " +
      "missing table as 'not set up here'.",
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
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // THE ASSESSMENT & CHECKLIST CATALOGUE (migration 894, 3 Nov 2026). The Holdings registry of assessment instruments:
  // identity, classification, relations, availability per product line and collections. It is landlord-owned reference
  // data. It holds NO learner, patient, respondent, answer, evidence, outcome or progression record, and the catalogue
  // code is built so that it cannot read one: the capture and progression tables (asmt_instance and its neighbours) are
  // governed by an exact entry in PLANE_TABLE_PREFIXES with NO allowlist entry, so any read of them from this plane is
  // refused outright (TABLE_NOT_ALLOWED). Each entry below names its columns and is readable ONLY from
  // src/lib/assessment/catalogue/** (`onlyFrom`), the one module that owns catalogue reads. A page, a route or another
  // library that wants one of these tables must add its own entry here, with its own reason.
  // asmt_instrument_org_scope is governed with no entry: Phase 1 has no screen for it, so nothing may read it yet.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  ...([
    ["asmt_catalogue_dimension", ["code", "label", "is_active", "allows_hierarchy", "position"],
      "the classification axes (method, subject domain, population, setting, level, specialty, keyword): a code, a label and two switches. Configuration, no subject."],
    ["asmt_catalogue_term", ["id", "dimension_code", "code", "label", "parent_id", "source_kind", "source_ref", "is_active", "position"],
      "the classification terms: a label and a code on an axis, an optional parent and an optional pointer (kind and id) to the authority a term names, such as a qualification level. The pointer is an id, never the row."],
    ["asmt_instrument_term", ["instrument_id", "term_id", "is_primary"],
      "which terms an instrument carries, and the one primary term per axis. Two ids and a flag: it names no person."],
    ["asmt_instrument_relation", ["instrument_id", "related_instrument_id", "relation", "note"],
      "instrument to instrument links (related, adapted from, supersedes, companion) with a short note. Between definitions only."],
    ["asmt_instrument_reference", ["id", "instrument_id", "kind", "ref_table", "ref_id", "ref_code", "ref_label", "ref_version"],
      "an instrument's references to a standard, framework or policy, by id, code and label. The referenced row is NOT copied here."],
    ["asmt_instrument_availability", ["instrument_id", "product_line", "mode", "granted_at", "note"],
      "which product line may discover an instrument (available, optional, unavailable). granted_by (a person id) is deliberately not selected: the screen needs the mode and the date, and the actor is in the append-only event trail."],
    ["asmt_collection", ["id", "code", "name", "description", "is_active", "owner_scope"],
      "named lists of instruments. owner_scope says Holdings or a product or organisation owner. The owner id columns are not selected."],
    ["asmt_collection_member", ["collection_id", "instrument_id", "position"],
      "which instruments sit in which collection, and in what order."],
  ] as const).map(([table, columns, what]) => ({
    table,
    columns,
    count: true,
    onlyFrom: "src/lib/assessment/catalogue/",
    why: `Assessment & Checklist Catalogue (migration 894), read only from src/lib/assessment/catalogue/**: ${what} Holdings reference data. It contains no learner, patient or assessment record.`,
  })),
  // ASMT-CATALOGUE-IMPORT-01 (migration 930). The import record: an uploaded workbook (name, digest, size, storage object), its
  // status and the extracted draft the person corrected. Readable ONLY from src/lib/assessment/import/** (`onlyFrom`), the module
  // that owns the import. The draft is the person's own working copy of a workbook they uploaded: criteria text, never a learner,
  // patient or assessment record. created_by is selected to show who imported, as the catalogue trail does for every event.
  {
    table: "asmt_import",
    columns: ["id", "file_name", "file_sha256", "byte_size", "storage_bucket", "storage_path", "status", "draft", "extracted_at", "registered_at", "created_by", "created_at"],
    count: false,
    onlyFrom: "src/lib/assessment/import/",
    why: "Instrument import (migration 930), read only from src/lib/assessment/import/**: the uploaded workbook's record and the extracted draft the person is correcting. Holdings reference data in the making. It contains no learner, patient or assessment record.",
  },
  // >>> ASSESSOR-WORKSPACE (Checklist Studio S4). The captured assessment data, read ONLY by the assessor workspace library
  // (`onlyFrom`): a read of the same table from the Studio, the catalogue or any other file is refused even with the right columns.
  // The assessor library filters every read by the actor (respondent_id, or granted_by for the grants I made) and every read of
  // answers, evidence, comments or outcomes by an instance it has proved is the actor's. asmt_progression_decision has NO entry here.
  ...([
    ["asmt_instance", ["id", "instrument_version_id", "subject_kind", "subject_id", "subject_user_id", "respondent_role", "respondent_id", "respondent_snapshot", "grant_id",
      "owner_scope", "status", "attestation", "amends_instance_id", "started_at", "submitted_at"],
      "One use of a published checklist on one person by one respondent. The assessor workspace reads an assessor's OWN instances (respondent_id = the signed in assessor, respondent_role = assessor) to list, open, resume and submit them, and the subject's submitted assessor-evaluated instances (subject_user_id, status submitted) in progression.ts only, to compute a stage on the server without returning them. Columns are identifiers, the status and the frozen authority snapshot (position, capability, appointment, date). Owner columns other than the scope are not selected."],
    ["asmt_instance_layout", ["instance_id", "layout_version_id", "is_primary"],
      "Which published layout versions were pinned to an assessor's own instance at its start. Two ids and a flag, read after the instance has been proved to be the assessor's own."],
    ["asmt_response", ["item_id", "field_key", "value", "revision", "satisfactory"],
      "The assessor's answers on an instance they own, keyed by item and field, with the revision the autosave compares and the satisfactory flag the database computed. Read after own() has proved the instance is the actor's. progression.ts reads the same columns for the subject's submitted instances to take the lowest rating per group, on the server only."],
    ["asmt_evidence", ["id", "item_id", "kind", "ref_kind", "ref_id", "note", "created_at"],
      "Evidence an assessor attached to an instance they own: a note or a reference to a record. storage_path and provenance are NOT selected (there is no upload path here). Read after own() has proved the instance is the actor's."],
    ["asmt_comment", ["id", "item_id", "kind", "body", "author_id", "created_at"],
      "Comments, safety concerns, strengths and recommendations an assessor wrote on an instance they own. Read after own() has proved the instance is the actor's."],
    ["asmt_outcome", ["id", "instance_id", "engine_version", "rules_hash", "outcome_code", "outcome_class", "group_outcomes", "aggregates", "trace", "trace_hash", "backstop_applied", "backstop_detail", "created_at"],
      "The recorded outcome of an instance the assessor submitted, for the report and the submit response. progression.ts also reads outcome id, code, class, trace and backstop detail of the subject's submitted assessor-evaluated instances to build progression evidence on the server, and returns none of it."],
    ["asmt_respondent_grant", ["id", "instrument_id", "subject_kind", "subject_id", "subject_user_id", "respondent_id", "respondent_role", "appointment_id", "granted_by", "reason", "valid_from",
      "valid_until", "accepted_at", "ended_at", "end_reason", "created_at"],
      "The authority to assess one person with one checklist. An assessor reads the grants made TO them (respondent_id = actor) to see what is waiting, ready or ended, and a coordinator reads the grants they MADE (granted_by = actor). accepted_by and ended_by are not selected. The reason is the coordinator's own text about the grant."],
  ] as const).map(([table, columns, what]) => ({
    table,
    columns,
    count: false,
    onlyFrom: "src/lib/assessment/assessor/",
    why: `ASSESSOR-WORKSPACE (migration 891), read only from src/lib/assessment/assessor/**: ${what}`,
  })),
  // <<< ASSESSOR-WORKSPACE
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // SCHOLAR-ENGAGEMENT-ANALYTICS-01 (migration 910, 3 Nov 2026). The learner engagement dashboard. Read ONLY from
  // src/lib/hq/scholar-analytics/** (`onlyFrom`), which turns rows into counts, days, estimated minutes and costs; the API
  // then decides whether a name may leave the server at all. ⚠ NO CONTENT COLUMN IS ADMITTED: no material text, lesson
  // content, note, answer, response, case narrative, AI prompt or AI answer. Ids, timestamps, statuses, the action name of
  // a Learn step, the AI gateway's own operation name, token counts and cost estimate. `user_id` is admitted because the
  // dashboard is per learner by design (pseudonymised on the way out, named only with hq.scholar.analytics.identifiable.read).
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // The platform-owned tables it also reads (hq_account_classification, plat_ai_requests, ai_usage_ledger, ai_allowance_account)
  // are not governed by PLANE_TABLE_PREFIXES and so carry no entry: the loader's selects name their columns all the same.
  ...([
    ["individual_scholar_material", ["id", "user_id", "created_at"], "that an upload happened and when. Title, file name, storage path and sizes are not selected."],
    ["individual_scholar_learning_session", ["id", "user_id", "created_at", "last_active_at", "status"], "a Learn session's start, last activity and state. Title, topic, competency and objective text are not selected."],
    ["individual_scholar_learning_event", ["session_id", "user_id", "action", "created_at"], "the steps of a Learn session (teach, resume, skip...) and their times, for active-time estimation and resume counts. The verdict column is not selected."],
    ["individual_scholar_artefact", ["id", "user_id", "created_at", "action", "superseded_at"], "that an explanation was saved, of which action, and whether a later version replaced it. The content, background, flags and refs are not selected."],
    ["individual_scholar_review", ["user_id", "reviewed_at"], "that a flashcard was reviewed and when. The card, the quality grade and the interval are not selected."],
    ["individual_scholar_revision_session", ["id", "user_id", "created_at", "last_active_at", "completed_at", "status"], "a revision session's start, last activity, completion and state. The set, mode, feedback and position are not selected."],
    ["individual_scholar_case_session", ["id", "user_id", "created_at", "last_active_at", "completed_at", "status"], "a clinical reasoning case session's start, last activity, completion and state. The case, stages, facts, variation and debrief are not selected."],
    ["individual_scholar_osce_attempt", ["id", "user_id", "started_at", "finished_at", "duration_seconds", "created_at"], "an OSCE attempt's start, finish and recorded duration. Responses, ticks, score, feedback and gaps are not selected."],
    ["individual_scholar_evaluation", ["id", "user_id", "created_at"], "that an Evaluate activity happened and when. Kind, scope, criteria, results and evidence are not selected."],
    ["individual_scholar_study_plan", ["user_id", "updated_at"], "that the person edited their plan and when. Exam date, goal, priorities and minutes are not selected."],
    ["individual_scholar_calendar_entry", ["user_id", "created_at"], "that a plan item was scheduled and when. Kind, ref, dates and value are not selected."],
    ["asmt_instance", ["id", "respondent_id", "subject_user_id", "started_at", "submitted_at", "status"], "a competency self-assessment's start and submission (respondent = subject only). Answers, evidence, outcomes and the authority snapshot are not selected."],
  ] as const).map(([table, columns, what]) => ({
    table,
    columns,
    count: true,
    onlyFrom: "src/lib/hq/scholar-analytics/",
    why: `SCHOLAR-ENGAGEMENT-ANALYTICS-01 (migration 910), read only from src/lib/hq/scholar-analytics/**: ${what}`,
  })),
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

/**
 * The entry that governs a table. A table may carry one entry per reading module (`onlyFrom`): given the reading file,
 * the entry whose `onlyFrom` covers it wins, else the first entry, so a second module's read is judged by its own columns
 * and a read from nowhere declared is still refused by whichever entry comes first (SCHOLAR-ENGAGEMENT-ANALYTICS-01).
 */
export const policyFor = (table: string, file?: string): TablePolicy | undefined =>
  (file ? PRACTICE_ALLOWLIST.find(p => p.table === table && p.onlyFrom && file.startsWith(p.onlyFrom)) : undefined)
  ?? PRACTICE_ALLOWLIST.find(p => p.table === table);

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

  const policy = policyFor(site.table, site.file);

  // 3. A chain that neither selected nor wrote. Not obviously harmless — it is a query this scanner
  //    could not classify — so it is refused rather than assumed inert.
  if (site.select === "none" && !site.write)
    return { ok: false, code: "NO_TERMINAL", detail: `${site.table}: .from() with neither a select nor a write (verbs: ${site.verbs.join(".") || "none"})` };

  // 4. A write that reads nothing back discloses nothing.
  if (site.select === "none" && site.write)
    return { ok: true, code: "WRITE_NO_READBACK", detail: `${site.table}: ${site.verbs.join(".")} returns no rows` };

  if (!policy)
    return { ok: false, code: "TABLE_NOT_ALLOWED", detail: `${site.table} is not on the platform-plane allowlist` };

  // 4b. An entry may name the only place it can be read from. Right table, right columns, wrong file: refused.
  if (policy.onlyFrom && !site.file.startsWith(policy.onlyFrom))
    return { ok: false, code: "TABLE_NOT_ALLOWED", detail: `${site.table} may be read only from ${policy.onlyFrom}**, not from ${site.file}` };

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
