import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, workspaceClock } from "@/lib/practice/practice-time";

// CPR-240 PROFESSIONAL PORTFOLIO.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A PORTFOLIO IS A DOCUMENT SOMEBODY SUBMITS FOR APPRAISAL AND REVALIDATION. IF IT OVERSTATES, IT IS
// THE CLINICIAN WHO SIGNED IT.
//
// This is the one module where an invented figure does not merely mislead a user: it travels, under
// their name, to a body that will act on it. The comp prints "Total Experience 8.6 yrs -- Since 2016"
// and "Patients Managed 2,348 -- All time". This product holds only what was recorded IN it, so "all
// time" means "since you started using this software".
//
// EVERY FIGURE IS WHAT THIS PRODUCT RECORDED, AND THE COVERAGE WINDOW IS PART OF THE PORTFOLIO -- in
// the header of the page and of the export, not a footnote. It is an extract, not a career.
//
// NOTHING IS "VERIFIED". Every item carries its PROVENANCE instead:
//   source_linked    it arose from clinical work recorded here
//   self_declared    a practitioner typed it in
//   operator_checked somebody recorded that they looked, and their id stays against it
// which is both true and more use to an appraiser than a tick.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THE PROFESSIONAL RECORD BELONGS TO THE PERSON, NOT TO THE PRACTICE (CPR-IDENT-SURVEY-001, D1-D4)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT WAS WRONG, AND IT NEEDED NO DELETE TO BITE. `access.ts` refuses entry to an ARCHIVED, SUSPENDED,
// CLOSING or CLOSED practice; every read below used to filter on `workspace_id`; and `exportPortfolio`
// ran off the same context, so the escape hatch needed an enterable workspace too. Archive a practice,
// open another -- which the one-practice-per-person rule permits once the first is CLOSED -- and the
// portfolio page renders EMPTY AND CORRECT-LOOKING: nought entries, an honest coverage sentence, no
// error. Nothing had been deleted. The record was simply unreachable by the only person entitled to it,
// and the discovery would come at revalidation.
//
// SO: the declared entries and the practitioner's own professional facts are keyed on the USER.
// `workspace_id` survives as PROVENANCE -- where this was entered -- never as scope. An entry says
// "I did this, at that practice", and it outlives the practice.
//
// D2. `practice_practitioner_profile` IS RETIRED INTO `practice_practitioner_identity` rather than
// re-keyed, because two person-scoped tables describing one person is the duplication the survey found,
// preserved under a new name. ⚠ THE PROVENANCE TRAVELS IN THE COLUMN NAMES: the moved facts are
// `self_declared_*` on a table that also carries `licence_verified_at/by/reference`. A registration
// number is a string somebody typed about themselves; a licence state is true because a named person
// recorded that they looked. Under a bare `registration_number` the two would sit side by side in every
// `select *`, every export and every JSON key, and be read as one kind of thing. A comment can be
// deleted in a refactor -- a column name cannot be, silently. Migration 270 adds the second half of the
// separation as a DATABASE CHECK: a verified licence cannot exist without the id of its verifier.
//
// D4. ⚠ THE `recorded` HALF DOES NOT TRAVEL, AND IT IS NOT SNAPSHOTTED -- CONSIDERED AND DEFERRED.
// Those counts are computed by joining `created_by`/`performed_by`/`author_id` against WORKSPACE-SCOPED
// clinical tables, so re-deriving them requires standing access to a patient record the practitioner may
// have left. The survey's answer was a frozen extract taken while they were still there. It is not built:
// it needs a store for the snapshot, a moment to take it at (a lifecycle transition, a departure, an
// explicit act), and a rule for what happens when the same person is re-added. What would close it is a
// `practice_portfolio_snapshot` row -- workspace, user, coverage window, the counts as at that instant,
// taken on archive/close/membership-revoke and readable person-scoped for ever after. Until that exists
// `buildProfessionalRecord` says plainly that the recorded half is absent and why, rather than printing
// zeroes that read as a career with no clinical work in it.
//
// THE MIGRATION THAT MAKES THIS TRUE IS 270, AND ITS DDL IS AT THE FOOT OF THIS FILE.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export const PORTFOLIO_KINDS = [
  ["qualification", "Qualification"],
  ["certification", "Certification"],
  ["publication", "Publication"],
  ["achievement", "Achievement or award"],
  ["teaching", "Teaching elsewhere"],
  ["leadership", "Leadership or committee"],
  ["research", "Research"],
  ["other", "Other"],
] as const;

export const PROVENANCE = {
  sourceLinked: {
    key: "source_linked",
    label: "From work recorded here",
    detail: "This arose from a consultation, procedure or activity recorded in this product at the time it happened.",
  },
  selfDeclared: {
    key: "self_declared",
    label: "Declared by you",
    detail: "You typed this in. Nothing here checked it against a registry, a journal or an employer.",
  },
  // ⚠ THE THIRD ONE EXISTS BECAUSE THE LICENCE STATE NOW SHARES A TABLE WITH SELF-DECLARED FACTS.
  // It is deliberately not called "verified": nothing in this product contacts a council. What is true
  // is that a named person recorded that they looked, and their id stays against it (migration 218).
  operatorChecked: {
    key: "operator_checked",
    label: "Checked by somebody, and recorded as such",
    detail: "Somebody recorded that they looked at your licence, and their id stays against that record. Nothing here contacted a regulator, so this is an account of who checked rather than a verification by this product.",
  },
} as const;

/**
 * D3 -- WHAT A PRACTITIONER IS TOLD AT THE MOMENT OF WRITING, NOW THAT THEIR WORDS OUTLIVE THE PRACTICE.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THREE FIELDS CARRY THE RISK, NOT ONE. The obvious one is `detail`. `title` is 3 to 300 characters of
 * free text and a case report titled with an age, a condition and a hospital identifies one child in a
 * small country. `organisation` names a place. All three travel, all three leave this practice's control,
 * and NOTHING SCANS ANY OF THEM -- retro-scanning free text for identifiers is not reliable and this
 * product does not promise it.
 *
 * So the warning is AT THE FIELD, as a sentence, in the register this product already writes in
 * (identifier-format.ts's acknowledgement). It does not make an entry safe. It makes the practitioner the
 * author of the risk WITH KNOWLEDGE, which is the same position this module already takes about the
 * document as a whole.
 *
 * ⚠ EXPORTED SO THE SCREEN AND THE HARNESS READ THE SAME STRINGS. A warning that lives only in JSX is one
 * a redesign drops with nothing failing.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export const PORTABLE_ENTRY_NOTICE =
  "What you type here is yours and it outlives this practice. It stays with you if this practice is "
  + "archived, suspended or closed, it travels into your own professional record, and you can export it "
  + "without opening a practice at all -- which also means it leaves this practice's control. Nothing "
  + "here reads it for patient details, so that part is yours: do not name a patient in any of these "
  + "boxes, and remember that an age, a condition and a place together name one just as surely as a name "
  + "does.";

/** The three free-text fields, each with the sentence that belongs beside it. */
export const PORTABLE_FIELDS = [
  {
    field: "title",
    label: "Title",
    notice: "The title travels with you and leaves this practice's control. A case report titled with an age, a condition and a hospital identifies the patient it is about -- name the work, not the person it was about.",
  },
  {
    field: "organisation",
    label: "Organisation",
    notice: "The organisation travels with you and leaves this practice's control. Name the body that awarded, published or employed -- not the ward, clinic or bed the patient was on.",
  },
  {
    field: "detail",
    label: "Detail",
    notice: "This is free text, it travels with you, and it leaves this practice's control for as long as you keep the entry. Nothing here scans it. Write what the work was, and nothing that could identify a patient -- no name, no number, no date of birth, and no age, condition and place together.",
  },
] as const;

/**
 * What this portfolio does not claim.
 *
 * THE FIRST TWO ARE THE ONES THAT MATTER, because they are the two an appraiser would otherwise assume.
 */
export const PORTFOLIO_LIMITS = [
  {
    key: "coverage",
    label: "This is not your career",
    detail: "It covers work recorded in this product, and nothing before that. The design calls the same figures \"All time\" and puts \"Total Experience 8.6 yrs\" at the top. Your coverage window is printed on the portfolio and on every export, because a document that quietly passes an extract off as a career is one you would be signing.",
  },
  {
    key: "verification",
    label: "Nothing here is verified",
    detail: "The design says \"Verified and trustworthy\" and \"Comprehensive & Verified\". No registry was contacted, no employer confirmed a post, no journal confirmed a paper. Each item says instead whether it came from work recorded here or was declared by you -- which is true, and more use than a tick.",
  },
  {
    key: "score",
    label: "There is no portfolio score",
    detail: "The design shows 842/1000 marked \"Excellent\", a donut of its parts and a line chart of it rising. It is one invented number drawn three ways, and a weak portfolio with many entries would score above a strong one with few.",
  },
  {
    key: "attachments",
    label: "Certificates and documents cannot be stored here",
    detail: "The design counts 286 documents, 34 certificates and 62 photos. There is no file storage in this product. A certificate can be recorded with its number and expiry date; the certificate itself lives where it already lives.",
  },
  {
    key: "sharing",
    label: "Nothing is sent anywhere",
    detail: "The design offers to share with colleagues, for credentialing and for opportunities. This product sends nothing, to anybody, ever. You export the portfolio and send it yourself, which also means you see exactly what you sent.",
  },
  {
    key: "cpd_target",
    label: "No CPD target, and no progress against one",
    detail: "The design shows \"CPD Target (2025) 62%\". Nobody set a target in this product, and the requirement depends on your regulator. CPD minutes are counted; what they should add up to is not something this software knows.",
  },
] as const;

// ── THE PRACTITIONER ─────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE COLUMNS THIS ENGINE READS OFF THE IDENTITY, NAMED ONE BY ONE RATHER THAN `select *`.
 *
 * A `*` would carry every future column of `practice_practitioner_identity` into a document a
 * practitioner sends to a regulator, the moment somebody adds one. `primary_workspace_id`, `user_id` and
 * `licence_verified_by` are exactly the fields PIS-000 s13 forbids exposing, and two of them are already
 * on the row. So the list is explicit and adding to it is a decision somebody has to type.
 */
const RECORD_COLUMNS =
  "user_id, practitioner_number, display_name, qualifications, specialties, biography, languages, "
  + "self_declared_profession, self_declared_registration_number, self_declared_registration_body, "
  + "self_declared_registration_expires_on, self_declared_practising_since, "
  + "licence_verified_at, licence_reference";

/**
 * The practitioner's own professional facts. PERSON-SCOPED -- no workspace reaches this function.
 *
 * ⚠ THE SHAPE IS BUILT FIELD BY FIELD, and the self-declared half keeps the column names that say so.
 * The licence half is a separate object with its own provenance, so nothing in a rendered document can
 * put a typed registration number and a recorded licence check under one heading.
 */
export type ProfessionalFacts = {
  user_id: string;
  practitioner_number: string | null;
  display_name: string | null;
  qualifications: string | null;
  specialties: string | null;
  biography: string | null;
  languages: string | null;
  self_declared_profession: string | null;
  self_declared_registration_number: string | null;
  self_declared_registration_body: string | null;
  self_declared_registration_expires_on: string | null;
  self_declared_practising_since: string | null;
  /** Covers the `self_declared_*` fields above, and nothing else on this object. */
  provenance: string;
  /** ⚠ A DIFFERENT KIND OF FACT, KEPT IN ITS OWN BOX. Never merged into the fields above. */
  licence: {
    checked: boolean;
    checkedAt: string | null;
    reference: string | null;
    provenance: string;
    /** Whose id sits behind it is NOT here -- see RECORD_COLUMNS. */
    verifiedByThisProduct: false;
  };
};

export async function getProfile(admin: any, userId: string): Promise<ProfessionalFacts | null> {
  const { data } = await admin.from("practice_practitioner_identity")
    .select(RECORD_COLUMNS).eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const r = data as any;
  return {
    user_id: r.user_id,
    practitioner_number: r.practitioner_number ?? null,
    display_name: r.display_name ?? null,
    qualifications: r.qualifications ?? null,
    specialties: r.specialties ?? null,
    biography: r.biography ?? null,
    languages: r.languages ?? null,
    self_declared_profession: r.self_declared_profession ?? null,
    self_declared_registration_number: r.self_declared_registration_number ?? null,
    self_declared_registration_body: r.self_declared_registration_body ?? null,
    self_declared_registration_expires_on: r.self_declared_registration_expires_on ?? null,
    self_declared_practising_since: r.self_declared_practising_since ?? null,
    provenance: PROVENANCE.selfDeclared.key,
    licence: {
      checked: !!r.licence_verified_at,
      checkedAt: r.licence_verified_at ?? null,
      reference: r.licence_reference ?? null,
      provenance: PROVENANCE.operatorChecked.key,
      verifiedByThisProduct: false,
    },
  };
}

/**
 * Save the practitioner's own professional facts onto their identity.
 *
 * ⚠ IT WILL NOT CREATE A ROW, AND THAT REFUSAL IS THE POINT. The identity carries a permanent
 * practitioner number allocated from a sequence (migration 218) -- there is no honest way for this
 * function to mint one, and a second store keyed on the same person is precisely what D2 retired. A
 * person with no identity is told so and pointed at the surface that issues one.
 *
 * `workspaceId` is PROVENANCE for the audit row -- where the typing happened -- and is optional, because
 * this must remain callable by somebody with no practice they can open.
 */
export async function saveProfile(admin: any, userId: string, args: {
  fullName?: string; profession?: string; specialty?: string;
  registrationNumber?: string; registrationBody?: string; registrationExpiresOn?: string | null;
  practisingSince?: string | null; summary?: string;
  workspaceId?: string | null; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  for (const [value, label] of [
    [args.registrationExpiresOn, "registrationExpiresOn"], [args.practisingSince, "practisingSince"],
  ] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a date (YYYY-MM-DD)` };
  }

  const patch: Record<string, unknown> = { updated_at: nowIso() };
  // ⚠ EVERY REGISTRATION FACT LANDS IN A COLUMN WHOSE NAME SAYS IT IS SELF-DECLARED. See the header.
  const map: Record<string, string> = {
    fullName: "display_name", specialty: "specialties", summary: "biography",
    profession: "self_declared_profession",
    registrationNumber: "self_declared_registration_number",
    registrationBody: "self_declared_registration_body",
    registrationExpiresOn: "self_declared_registration_expires_on",
    practisingSince: "self_declared_practising_since",
  };
  for (const [k, column] of Object.entries(map)) {
    const v = (args as any)[k];
    if (v !== undefined) patch[column] = typeof v === "string" ? (v.trim() || null) : v;
  }
  // display_name is NOT NULL with a 2-to-120 check on it (migration 218). Refused here with a sentence
  // rather than handed to Postgres to refuse with a constraint name.
  if ("display_name" in patch) {
    const n = patch.display_name;
    if (typeof n !== "string" || n.length < 2 || n.length > 120)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a name is 2 to 120 characters" };
  }

  const { data: updated, error } = await admin.from("practice_practitioner_identity")
    .update(patch).eq("user_id", userId).select("user_id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  // An update that matched nothing is not a success -- the silent-write class this codebase records.
  if (!updated || updated.length === 0)
    return {
      ok: false, status: 409, code: "NO_IDENTITY",
      message: "no practitioner identity has been issued to you yet, and this cannot issue one -- a practitioner number is permanent and comes from Practice Setup",
    };

  await audit(admin, {
    workspaceId: args.workspaceId ?? null, actorId: userId, eventType: "practice.profile_saved",
    payload: { userId, fields: Object.keys(patch).filter(k => k !== "updated_at") },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: userId } };
}

// ── DECLARED ENTRIES ─────────────────────────────────────────────────────────────────────────────────

export async function addEntry(admin: any, ctx: WorkspaceContext, args: {
  kind: string; title: string; detail?: string; organisation?: string;
  occurredOn?: string | null; expiresOn?: string | null; reference?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!PORTFOLIO_KINDS.some(([k]) => k === args.kind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `kind must be one of: ${PORTFOLIO_KINDS.map(([k]) => k).join(", ")}` };
  if (args.title.trim().length < 3)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "an entry needs a title" };

  for (const [value, label] of [[args.occurredOn, "occurredOn"], [args.expiresOn, "expiresOn"]] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `${label} must be a date (YYYY-MM-DD)` };
  }
  // A certificate that expired before it was issued is a typo, and one that reaches an appraiser is a
  // question the practitioner has to answer.
  if (args.occurredOn && args.expiresOn && args.expiresOn < args.occurredOn)
    return { ok: false, status: 400, code: "EXPIRES_BEFORE_ISSUE", message: "that expires before it was awarded" };

  const { data, error } = await admin.from("practice_portfolio_entry").insert({
    // ⚠ PROVENANCE, NOT SCOPE. Where this was typed, kept so an erasure or subject-access enquiry against
    // that practice can still find an entry mentioning one of its patients -- and nullable from migration
    // 270 on, so closing the practice clears the pointer instead of taking the entry with it.
    workspace_id: ctx.workspaceId, user_id: ctx.userId,
    kind: args.kind, title: args.title.trim(), detail: args.detail?.trim() || null,
    organisation: args.organisation?.trim() || null,
    occurred_on: args.occurredOn ?? null, expires_on: args.expiresOn ?? null,
    reference: args.reference?.trim() || null,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.portfolio_entry_added",
    payload: { entryId: data.id, kind: args.kind }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function removeEntry(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ deleted: true }>> {
  // ⚠ THERE IS ONE SCOPE ON THIS TABLE NOW, AND IT IS THE PERSON. Looking the entry up by workspace
  // would refuse an author their own entry the moment they moved practice -- the exact failure D1 fixes.
  const { data: e } = await admin.from("practice_portfolio_entry")
    .select("id, user_id").eq("id", args.id).maybeSingle();
  if (!e) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (e.user_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's portfolio" };

  await admin.from("practice_portfolio_entry").delete().eq("id", e.id);
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.portfolio_entry_removed",
    payload: { entryId: e.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { deleted: true } };
}

// ── THE PORTFOLIO ────────────────────────────────────────────────────────────────────────────────────

/**
 * What this product actually recorded for this person, and from when.
 *
 * THE COVERAGE WINDOW IS COMPUTED, NOT CONFIGURED. It is the earliest thing this product holds for
 * them -- so it cannot be set to a flattering date, and it moves only when the record does.
 */
async function coverage(admin: any, ctx: WorkspaceContext) {
  const earliestOf = async (table: string, column: string, userColumn: string) => {
    const { data } = await admin.from(table).select(column)
      .eq("workspace_id", ctx.workspaceId).eq(userColumn, ctx.userId)
      .order(column, { ascending: true }).limit(1).maybeSingle();
    return (data as any)?.[column] ?? null;
  };

  const dates = (await Promise.all([
    earliestOf("practice_encounter", "started_at", "created_by"),
    earliestOf("practice_procedure", "performed_at", "performed_by"),
    earliestOf("practice_clinical_activity", "occurred_at", "performed_by"),
    earliestOf("practice_reflection", "created_at", "author_id"),
  ])).filter(Boolean).map(String).sort();

  const { data: ws } = await admin.from("practice_workspace")
    .select("created_at").eq("id", ctx.workspaceId).maybeSingle();

  return {
    from: dates[0] ? dates[0].slice(0, 10) : null,
    workspaceCreated: ws?.created_at ? String(ws.created_at).slice(0, 10) : null,
    // THE SENTENCE THAT GOES ON THE EXPORT. Written here rather than on the page, so the page and the
    // document cannot drift apart about what the figures mean.
    statement: dates[0]
      ? `Covers work recorded in this product from ${String(dates[0]).slice(0, 10)} onwards. It is not a complete record of this practitioner's career.`
      : "Nothing has been recorded in this product yet, so this portfolio covers no clinical work. It is not a record of this practitioner's career.",
  };
}

/**
 * Every declared entry this person has ever made, WHEREVER THEY MADE IT.
 *
 * ⚠ NO WORKSPACE FILTER, ANYWHERE IN THIS FUNCTION. That single `.eq("workspace_id", ...)` is what made
 * a portfolio disappear when a practice was archived. `workspace_id` is read here only to say WHERE an
 * entry was typed, and the practice's name is resolved for the practitioner's own entries alone.
 */
async function declaredEntries(admin: any, userId: string, today: string) {
  const { data: entries } = await admin.from("practice_portfolio_entry").select("*")
    .eq("user_id", userId).order("occurred_on", { ascending: false });
  const entryRows = (entries ?? []) as any[];

  // The provenance, as a name rather than a uuid. One batched read, over the workspaces named by this
  // person's OWN entries and no others.
  const wsIds = [...new Set(entryRows.map(e => e.workspace_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (wsIds.length > 0) {
    const { data: ws } = await admin.from("practice_workspace").select("id, name").in("id", wsIds);
    for (const w of ((ws ?? []) as any[])) names.set(w.id as string, (w.name as string) ?? "");
  }

  const byKind = PORTFOLIO_KINDS.map(([key, label]) => ({
    key, label,
    items: entryRows.filter(e => e.kind === key).map(e => ({
      ...e,
      // DERIVED, NEVER STORED -- the rule CPR-140 set for overdue. A stored "expired" flag needs
      // something to run, and an appraisal portfolio is exactly where a stale flag does damage.
      expired: !!e.expires_on && e.expires_on < today,
      expiringSoon: !!e.expires_on && e.expires_on >= today && e.expires_on <= addDays(today, 90),
      provenance: PROVENANCE.selfDeclared.key,
      // "I did this, at that practice." Null when the practice has been deleted, which is what
      // ON DELETE SET NULL means and is not the same as never having had one.
      recordedAtPractice: e.workspace_id ? (names.get(e.workspace_id) ?? null) : null,
    })),
  })).filter(g => g.items.length > 0);

  return { rows: entryRows, byKind };
}

export async function buildPortfolio(admin: any, ctx: WorkspaceContext) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);

  const [
    cover, profile,
    { data: encounters }, { data: procedures }, { data: activities },
    { count: reflections }, { count: learnings }, declared,
  ] = await Promise.all([
    coverage(admin, ctx),
    getProfile(admin, ctx.userId),
    admin.from("practice_encounter").select("id, patient_id, started_at")
      .eq("workspace_id", ctx.workspaceId).eq("created_by", ctx.userId).limit(5000),
    admin.from("practice_procedure").select("id, label, status, performed_at, cpd_minutes, portfolio")
      .eq("workspace_id", ctx.workspaceId).eq("performed_by", ctx.userId).limit(5000),
    admin.from("practice_clinical_activity").select("id, kind, title, occurred_at, duration_minutes, cpd_minutes, portfolio")
      .eq("workspace_id", ctx.workspaceId).eq("performed_by", ctx.userId).limit(5000),
    admin.from("practice_reflection").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId),
    admin.from("practice_case_learning").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("author_id", ctx.userId),
    // ⚠ PERSON-SCOPED. Everything above this line is the practice's record of clinical work and is
    // rightly filtered on the workspace. This one is the practitioner's own, and is not.
    declaredEntries(admin, ctx.userId, today),
  ]);

  const encounterRows = (encounters ?? []) as any[];
  const procedureRows = ((procedures ?? []) as any[]).filter(p => p.status === "PERFORMED");
  const activityRows = (activities ?? []) as any[];
  const entryRows = declared.rows;

  const byProcedure = new Map<string, number>();
  for (const p of procedureRows) byProcedure.set(p.label, (byProcedure.get(p.label) ?? 0) + 1);
  const byActivity = new Map<string, number>();
  for (const a of activityRows) byActivity.set(a.kind, (byActivity.get(a.kind) ?? 0) + 1);

  const entriesByKind = declared.byKind;

  const expiring = entriesByKind.flatMap(g => g.items).filter(i => i.expired || i.expiringSoon);
  const registrationExpired = !!profile?.self_declared_registration_expires_on
    && profile.self_declared_registration_expires_on < today;

  return {
    coverage: cover,
    profile,

    // ── FROM WORK RECORDED HERE ──────────────────────────────────────────────────────────────
    recorded: {
      provenance: PROVENANCE.sourceLinked.key,
      consultations: encounterRows.length,
      // A COUNT OF PEOPLE, NOT OF VISITS. The comp's "Patients Managed 2,348" over 2,348 encounters
      // would be one visit each, which is not what a practice looks like.
      patients: new Set(encounterRows.map(e => e.patient_id)).size,
      procedures: procedureRows.length,
      procedureTypes: [...byProcedure.entries()].map(([label, total]) => ({ label, total }))
        .sort((a, b) => b.total - a.total),
      activities: activityRows.length,
      activityKinds: [...byActivity.entries()].map(([kind, total]) => ({ kind, total }))
        .sort((a, b) => b.total - a.total),
      teachingSessions: activityRows.filter(a => a.kind === "teaching" || a.kind === "training").length,
      cpdMinutes: [...procedureRows, ...activityRows].reduce((n, r) => n + (r.cpd_minutes ?? 0), 0),
      markedForPortfolio: [...procedureRows, ...activityRows].filter(r => r.portfolio).length,
      reflections: reflections ?? 0,
      learningPoints: learnings ?? 0,
    },

    // ── DECLARED BY THE PRACTITIONER ─────────────────────────────────────────────────────────
    declared: {
      provenance: PROVENANCE.selfDeclared.key,
      total: entryRows.length,
      byKind: entriesByKind,
    },

    // WHAT AN APPRAISER WOULD ASK ABOUT FIRST. Derived, and the only "attention" this page has.
    attention: {
      expiring,
      registrationExpired,
      registrationExpiresOn: profile?.self_declared_registration_expires_on ?? null,
      profileIncomplete: !profile || !profile.display_name || !profile.self_declared_profession,
    },

    // The doctrine, as fields, so no client can render any of them.
    scored: false,
    verified: false,
    coversWholeCareer: false,
    limits: PORTFOLIO_LIMITS,
    today,
  };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The export.
 *
 * THE COVERAGE STATEMENT IS THE FIRST FIELD, not a footer. A document whose caveat is at the bottom is
 * a document whose caveat gets cropped.
 */
export async function exportPortfolio(admin: any, ctx: WorkspaceContext, args: {
  correlationId: string;
}): Promise<EngineResult<Record<string, unknown>>> {
  const portfolio = await buildPortfolio(admin, ctx);

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.portfolio_exported",
    payload: { coverageFrom: portfolio.coverage.from }, correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      // Deliberately first, and deliberately prose.
      coverage: portfolio.coverage.statement,
      notVerified: "Nothing in this document has been verified by this product. Items marked as declared were typed in by the practitioner; items marked as recorded arose from work entered here at the time.",
      generatedAt: nowIso(),
      generatedFor: portfolio.profile?.display_name ?? null,
      isClinicalDocument: false,
      profile: portfolio.profile,
      recorded: portfolio.recorded,
      declared: portfolio.declared,
      // NO SCORE, NO TOTALS ACROSS THE TWO HALVES. Adding a declared publication to a recorded procedure
      // produces a number that means nothing and reads as a career.
      scored: false,
      sentByThisProduct: false,
    },
  };
}

// ── THE RECORD THAT DOES NOT NEED A PRACTICE ─────────────────────────────────────────────────────────

/**
 * ⚠ THE WHOLE POINT OF D1, AS A FUNCTION: NO WorkspaceContext, ANYWHERE IN THIS SIGNATURE.
 *
 * `buildPortfolio` and `exportPortfolio` both take a context, and a context cannot be resolved for an
 * ARCHIVED, SUSPENDED, CLOSING or CLOSED practice (access.ts). So the escape hatch could not be reached
 * by the one person who needed it -- somebody whose practice had just been archived. This one takes a
 * user id and reads two person-scoped stores, and it works for a practitioner with no practice at all.
 *
 * ⚠ AND IT IS HONEST ABOUT ITS HALF. The `recorded` counts are NOT here -- see D4 in the file header.
 * Printing them as zeroes would say "you did no clinical work", which is a different and false claim
 * from "this document does not carry that half".
 */
export async function buildProfessionalRecord(admin: any, userId: string) {
  // No workspace, so no workspace clock. UTC, and the field says which -- an expiry judged a day early
  // or late by a timezone is a caveat, not a lie, and the alternative is guessing at a practice.
  const today = new Date().toISOString().slice(0, 10);
  const [profile, declared] = await Promise.all([
    getProfile(admin, userId),
    declaredEntries(admin, userId, today),
  ]);

  return {
    // Deliberately first, and deliberately prose -- the same rule the practice export follows.
    coverage:
      "This is your own professional record: the facts you declared about yourself, and the entries you "
      + "typed. It carries no account of clinical work, because that is recorded inside a practice and "
      + "belongs to it. It is not a complete record of your career.",
    profile,
    declared: {
      provenance: PROVENANCE.selfDeclared.key,
      total: declared.rows.length,
      byKind: declared.byKind,
    },
    /** ⚠ SAID, NOT OMITTED. An absent section a reader cannot see the shape of is a section nobody misses. */
    recordedNotIncluded:
      "Consultations, procedures, teaching and CPD minutes are not in this document. They are counted by "
      + "joining your name against a practice's patient record, so re-deriving them would need standing "
      + "access to a practice you may have left. A frozen extract taken while you were still there was "
      + "considered and has not been built -- see D4.",
    expiryJudgedOn: today,
    expiryTimezone: "UTC",
    scored: false,
    verified: false,
    coversWholeCareer: false,
    limits: PORTFOLIO_LIMITS,
    today,
  };
}

export async function exportProfessionalRecord(admin: any, userId: string, args: {
  /** Where the export was asked from, when there is such a place. PROVENANCE for the audit row only. */
  workspaceId?: string | null; correlationId: string;
}): Promise<EngineResult<Record<string, unknown>>> {
  const record = await buildProfessionalRecord(admin, userId);

  await audit(admin, {
    workspaceId: args.workspaceId ?? null, actorId: userId,
    eventType: "practice.professional_record_exported",
    payload: { entries: (record.declared as any).total }, correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      coverage: record.coverage,
      notVerified: "Nothing in this document has been verified by this product. Every fact in it was typed in by the practitioner it is about. Where a licence check is recorded, it says who recorded it -- that is an account of who looked, not a verification by this product.",
      recordedNotIncluded: record.recordedNotIncluded,
      generatedAt: nowIso(),
      generatedFor: record.profile?.display_name ?? null,
      isClinicalDocument: false,
      profile: record.profile,
      declared: record.declared,
      scored: false,
      sentByThisProduct: false,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// MIGRATION 270 -- THE DDL THIS ENGINE NEEDS.
//
// ⚠ 261-267 are applied and 268-269 belong to the booking build, so this is 270. Not written as a file
// here: it is extracted and numbered by hand, applied once.
//
// -- ============================================================
// -- MIGRATION 270: THE PROFESSIONAL RECORD BELONGS TO THE PERSON (CPR-IDENT-SURVEY-001 D1, D2)
// --
// -- ⚠ THIS MIGRATION SETTLES A CONTRADICTION BETWEEN TWO EARLIER ONES, DELIBERATELY AND BY DECISION.
// --
// -- Migration 217 scoped the professional portfolio to the WORKSPACE and argued for it in as many
// -- words: "One row per person per workspace" (217:47). Migration 218 scoped the practitioner identity
// -- to the PERSON and argued the opposite: "if this row were scoped to a workspace, the workspace
// -- cascade would delete the identity along with it" (218:12-14). Both are reasoned, both are in the
// -- repository, and they cannot both be right about the same person.
// --
// -- 218'S DOCTRINE WINS. 217'S ARGUMENT IS SUPERSEDED HERE, NAMED RATHER THAN QUIETLY OUTVOTED -- two
// -- contradictory headers with no resolution between them is exactly how this came about. Nothing in
// -- 217 was wrong about a consultation. It was wrong about a portfolio: a qualification, a publication,
// -- a fellowship and a registration number describe the PERSON, and the practice merely hosted the
// -- typing.
// --
// -- THE FAILURE THIS FIXES NEEDED NO DELETE. access.ts refuses entry to an ARCHIVED, SUSPENDED, CLOSING
// -- or CLOSED practice and every portfolio read was filtered on workspace_id, so archiving a practice
// -- and opening another rendered the portfolio EMPTY AND CORRECT-LOOKING. Nothing was deleted. The
// -- record was unreachable by the only person entitled to it.
// --
// -- ⚠ PRECONDITION, VERIFIED BEFORE THIS WAS WRITTEN: practice_practitioner_profile and
// -- practice_portfolio_entry both held ZERO rows on 2026-08-09. Section 4 carries anything that has
// -- appeared since onto the identity before the retired table is dropped, so applying this later is not
// -- a data loss. Section 4 is the ONE part that is not re-runnable, because the table it reads from is
// -- gone once it has run. A second run fails loudly there and undoes nothing.
// --
// -- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql.
// -- ============================================================
//
// -- ---- 1. The declared entry becomes person-scoped, and the workspace becomes PROVENANCE ------------
// --
// -- Not "where this may be read" but "where this was entered". NULLABLE, ON DELETE SET NULL: the exact
// -- shape migration 218 already uses for primary_workspace_id, so this is this codebase's established
// -- pattern rather than a new one. Keeping the pointer is what lets an erasure or subject-access
// -- enquiry against the old practice still find an entry that mentions one of its patients. Dropping
// -- the column would make the entry portable AND untraceable, which trades one data-protection problem
// -- for a worse one.
//
// alter table practice_portfolio_entry drop constraint if exists practice_portfolio_entry_workspace_id_fkey;
// alter table practice_portfolio_entry drop constraint if exists practice_portfolio_entry_workspace_provenance_fk;
// alter table practice_portfolio_entry alter column workspace_id drop not null;
// alter table practice_portfolio_entry add constraint practice_portfolio_entry_workspace_provenance_fk
//   foreign key (workspace_id) references practice_workspace(id) on delete set null;
//
// -- The reads are by person now. Both old indexes led with workspace_id, which is no longer the scope
// -- of any query in the engine, and a leading column nothing filters on is an index that never opens.
//
// drop index if exists idx_practice_portfolio_entry_user;
// drop index if exists idx_practice_portfolio_entry_expiry;
// create index if not exists idx_practice_portfolio_entry_person
//   on practice_portfolio_entry(user_id, kind, occurred_on desc);
// create index if not exists idx_practice_portfolio_entry_person_expiry
//   on practice_portfolio_entry(user_id, expires_on) where expires_on is not null;
// -- And one for the provenance question, which is asked of the PRACTICE rather than of the person:
// -- "which entries were typed here" -- the whole-practice export, and any erasure enquiry.
// create index if not exists idx_practice_portfolio_entry_provenance
//   on practice_portfolio_entry(workspace_id) where workspace_id is not null;
//
// -- ---- 2. The self-declared professional facts move onto the identity ------------------------------
// --
// -- ⚠ THE PROVENANCE TRAVELS IN THE COLUMN NAME, AND THAT IS THE WHOLE POINT OF THIS SECTION.
// --
// -- practice_practitioner_identity already carries licence_verified_at, licence_verified_by and
// -- licence_reference: a state that is true because a NAMED PERSON recorded that they looked. A
// -- registration number is a string somebody typed about themselves. Putting the second beside the
// -- first under a bare name like registration_number would manufacture exactly the assurance 217 and
// -- 218 both refuse, because a reader of select *, of an export, or of a JSON key sees a licence
// -- reference and a registration number side by side and reads both as checked.
// --
// -- So the name carries it. self_declared_registration_number is self-declared in every select, every
// -- export, every log line and every payload key, and there is no way to render it that drops the word.
// -- A comment can be deleted in a refactor. A column name cannot be, silently.
// --
// -- ⚠ AND NOT A PROVENANCE COLUMN, DELIBERATELY. 217:116-117 refused one for this table and the reason
// -- holds here: "a column that is always the same value invites somebody to set it to the other one".
//
// alter table practice_practitioner_identity add column if not exists self_declared_profession text;
// alter table practice_practitioner_identity add column if not exists self_declared_registration_number text;
// alter table practice_practitioner_identity add column if not exists self_declared_registration_body text;
// alter table practice_practitioner_identity add column if not exists self_declared_registration_expires_on date;
// alter table practice_practitioner_identity add column if not exists self_declared_practising_since date;
//
// -- ---- 3. A LICENCE CANNOT HAVE BEEN CHECKED BY NOBODY ----------------------------------------------
// --
// -- The other half of keeping the two apart, and this half is enforced by the database rather than
// -- named. 218:79-80 says a tick with nobody behind it is the claim CPR-240 refused, but nothing
// -- stopped a row carrying licence_verified_at with a null licence_verified_by, which IS that tick. Now
// -- the state cannot exist without the id of the person who recorded that they looked. All 43 live
// -- identities hold null in both columns and pass unchanged.
//
// alter table practice_practitioner_identity drop constraint if exists practice_identity_licence_has_a_verifier;
// alter table practice_practitioner_identity add constraint practice_identity_licence_has_a_verifier
//   check ((licence_verified_at is null and licence_verified_by is null)
//       or (licence_verified_at is not null and licence_verified_by is not null));
//
// -- ---- 4. Carry the retired table forward, then retire it -------------------------------------------
// --
// -- ⚠ THE ONE NON-RE-RUNNABLE SECTION. See the precondition in the header.
// --
// -- Two person-scoped tables describing one person is the duplication the survey found, preserved under
// -- a new name, so the profile is RETIRED rather than re-keyed. coalesce() throughout: the identity is
// -- the surviving record and nothing already on it is overwritten by a copy from the table being
// -- dropped. distinct on picks the most recently updated profile row for anybody who has more than one.
//
// update practice_practitioner_identity i set
//   self_declared_profession = coalesce(i.self_declared_profession, p.profession),
//   self_declared_registration_number = coalesce(i.self_declared_registration_number, p.registration_number),
//   self_declared_registration_body = coalesce(i.self_declared_registration_body, p.registration_body),
//   self_declared_registration_expires_on = coalesce(i.self_declared_registration_expires_on, p.registration_expires_on),
//   self_declared_practising_since = coalesce(i.self_declared_practising_since, p.practising_since),
//   specialties = coalesce(i.specialties, nullif(btrim(concat_ws(', ', p.specialty, p.sub_specialty)), '')),
//   biography = coalesce(i.biography, nullif(btrim(p.summary), '')),
//   display_name = case
//     when char_length(btrim(coalesce(p.full_name, ''))) between 2 and 120 then btrim(p.full_name)
//     else i.display_name end,
//   updated_at = now()
// from (select distinct on (user_id) * from practice_practitioner_profile order by user_id, updated_at desc) p
// where p.user_id = i.user_id;
//
// drop table if exists practice_practitioner_profile;
//
// -- ---- 5. RLS: deny-by-default, unchanged -----------------------------------------------------------
//
// alter table practice_portfolio_entry enable row level security;
// alter table practice_practitioner_identity enable row level security;
//
// notify pgrst, 'reload schema';
// ════════════════════════════════════════════════════════════════════════════════════════════════════
