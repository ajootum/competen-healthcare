import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";
import { practiceToday, zonedDayRange } from "@/lib/practice/practice-time";
import { defaultAppointmentMinutes } from "@/lib/practice/configuration";
import { checkPlacement } from "@/lib/practice/scheduling";
import {
  BOOKING_CHANNELS, BOOKING_CHANNEL_CODES, BOOKING_CHANNELS_WITH_A_DOOR, bookingChannel,
  RULE_STATUS_CODES, RULE_STATUSES_IN_FORCE,
  CONFIRMATION_MODE_CODES, PATIENT_ELIGIBILITY_CODES,
  specificityOf, specificityRung, specificityReasons, scopesCanOverlap, scopeDimensions,
  plainWindow, plainCapacity, PLATFORM_DEFAULT_RUNG,
  type ScopeShape,
} from "@/lib/practice/booking-rule-constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 3 -- THE BOOKING RULES ENGINE. Migration 244.
//
// s19's Phase 3: "Rule cards, builder, hierarchy, conflict validation, simulation", exit condition
// "INTERNAL PRACTITIONER/STAFF BOOKING FOLLOWS RULES". So this file has two halves that must agree with
// each other: the half that AUTHORS a rule (s7.1's card, s7.2's builder, s11's conflict validation,
// migration 244's versioning) and the half that DECIDES A BOOKING with one (s11's ladder, s7.4's
// capacity, s7.5's follow-up window, s7.6's eligibility, s7.2's confirmation).
//
// ---- FIVE RULES THIS FILE EXISTS TO ENFORCE ---------------------------------------------------------
//
//   1. ⚠ AC-13: EVERY BOOKING STORES THE RULE ID AND THE VERSION THAT DECIDED IT. A booking made in
//      March under a rule edited in June must still be explicable in September; without the version,
//      "which rule allowed this?" is answered with a different rule wearing the same id. Both columns
//      are written in the SAME INSERT as the appointment -- a second UPDATE could fail and leave a
//      booking that lies about having been decided by nothing.
//
//   2. ⚠ s11: AT EQUAL SPECIFICITY AND EQUAL PRIORITY, ACTIVATION IS BLOCKED UNTIL RESOLVED. Not a coin
//      toss, not first-wins, not newest-wins. Enforced in BOTH directions: activating a rule that would
//      tie is refused with the other rule NAMED, and if two tied rules are somehow both active anyway
//      (they can be written straight into the table) evaluation REFUSES rather than picking one.
//
//   3. ⚠ EVALUATION IS SERVER-SIDE, AND NOTHING ABOUT A DECISION ARRIVES IN A REQUEST. The argument to
//      bookUnderRules is a description of the booking -- who, when, what, which channel -- and never a
//      rule id, a version or a verdict. Even the facts eligibility turns on (is this patient new, how
//      old are they, do they have a live follow-up) are READ HERE rather than accepted, because a fact
//      that arrives in a body is a fact somebody can edit.
//
//   4. ⚠ A FAILED READ IS NEVER A ZERO. If the rules cannot be read, a booking REFUSES; it does not fall
//      through to "no rule applies", which would turn a database blip into an open diary. The same for
//      the capacity count, the patient's history and the follow-up plan.
//
//   5. ⚠ AN OVERRIDE REQUIRES A REASON, IS WRITTEN BEFORE THE BOOKING, AND ITS WRITE IS CHECKED (s14,
//      AC-14). audit() swallows its own failure by design, which is right for a log and wrong for this:
//      an override nobody can find afterwards is an override that did not happen, so the record is
//      written here with its error read, and the booking is refused if it could not be recorded.
//
// ---- ONE DELIBERATE DEVIATION, AND IT IS NOT A ROLLBACK ---------------------------------------------
//
// ⚠ RULES WRITTEN BY THIS ENGINE SET THE LEGACY `active` FLAG TO FALSE, AND `status` IS THE AUTHORITY.
//
// Migration 230 put a PARTIAL UNIQUE INDEX on practice_booking_rule -- ux_practice_booking_rule_scope,
// over (workspace_id, coalesce(location_id, zero-uuid), coalesce(appointment_type, '*')) WHERE active.
// It was right for a single inline row per scope. It is fatal to s7's card model: a Friday session rule
// and a Monday session rule at the same hospital both coalesce to (that hospital, '*') and the second
// one cannot be marked active. Worse, it makes s11 UNTESTABLE and UNREACHABLE -- because the specificity
// weights are powers of two, two rules can only have EQUAL specificity by constraining exactly the same
// dimensions, which means they share a location and an appointment type, which means the index refuses
// the second. "At equal specificity, explicit priority determines the winner" would be a sentence about
// a state the database forbids.
//
// So card rules leave `active` false and are evaluated by `status`. The consequence is stated rather
// than hidden: availability-config.ts's resolveBookingRule -- the check the calendar's own quick-book
// runs -- reads `active` and therefore does NOT see card rules. The legacy single-row editor keeps
// working exactly as it did, its rules stay visible to BOTH engines (status defaults to 'active'), and
// the honest fix is a migration dropping that index, which is not this build's to write. It is reported.
//
// ---- WHAT IS NOT HERE ------------------------------------------------------------------------------
//
//   Phase 4  s8's patient-facing access -- handle, link, OTP, publish state. The patient_self and
//            referral channels are storable as a rule's scope (AC-06 requires that) and have NO DOOR:
//            a booking through them is refused with the phase named.
//   Phase 5  s7.5's recall queue and s7.7's walk-in session limits, cutoff and queue rules.
//   Phase 6  s10's scenario preview and publish validation.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** The three states, as practice-sessions.ts defines them. `ok` with an empty value is not `unreadable`. */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: string };

export const ruleReadingValue = <T>(r: Reading<T>, fallback: T): T =>
  r.state === "ok" ? r.value : fallback;

const nowIso = () => new Date().toISOString();

/** Live = a real person expecting to be seen. The same three statuses the rest of this area uses. */
const LIVE_BOOKING_STATUSES = ["REQUESTED", "CONFIRMED", "ARRIVED"];
/** A follow-up somebody is still expected to attend. */
const LIVE_FOLLOW_UP_STATUSES = ["OPEN", "SCHEDULED"];

/**
 * ⚠ EVERY COLUMN THIS ENGINE DECIDES WITH, IN ONE LIST. A rule read that omits a column silently turns
 * that part of somebody's policy off, and the omission looks exactly like a policy nobody set.
 */
const RULE_COLUMNS =
  "id, workspace_id, name, description, status, priority, effective_from, effective_to, "
  + "location_id, session_template_id, appointment_type, channel, "
  + "capacity_total, capacity_new, capacity_follow_up, capacity_urgent_reserve, overbooking_allowed, "
  + "patient_eligibility, min_age_years, max_age_years, confirmation_mode, "
  + "follow_up_early_days, follow_up_late_days, version, active, "
  + "lead_time_minutes, booking_horizon_days, cancellation_notice_minutes, walk_in_daily_limit, "
  + "emergency_reserve_minutes, visibility, created_at, updated_at, created_by";

/** The fields a version snapshot photographs. Changing any of them is an edit worth a new version. */
export const VERSIONED_FIELDS = [
  "name", "description", "status", "priority", "effective_from", "effective_to",
  "location_id", "session_template_id", "appointment_type", "channel",
  "capacity_total", "capacity_new", "capacity_follow_up", "capacity_urgent_reserve",
  "overbooking_allowed", "patient_eligibility", "min_age_years", "max_age_years",
  "confirmation_mode", "follow_up_early_days", "follow_up_late_days",
  "lead_time_minutes", "booking_horizon_days", "cancellation_notice_minutes",
  "walk_in_daily_limit", "emergency_reserve_minutes", "visibility",
] as const;

const scopeOf = (r: any): ScopeShape => ({
  effectiveFrom: (r.effective_from as string | null) ?? null,
  effectiveTo: (r.effective_to as string | null) ?? null,
  sessionTemplateId: (r.session_template_id as string | null) ?? null,
  locationId: (r.location_id as string | null) ?? null,
  appointmentType: (r.appointment_type as string | null) ?? null,
  channel: (r.channel as string | null) ?? null,
  patientEligibility: (r.patient_eligibility as string) ?? "any",
  minAgeYears: (r.min_age_years as number | null) ?? null,
  maxAgeYears: (r.max_age_years as number | null) ?? null,
});

// ── s7.1's CARD ──────────────────────────────────────────────────────────────────────────────────────

export type BookingRuleCard = {
  id: string;
  /** ⚠ NULL for a rule written before the card model. The screen says so; it never prints an empty name. */
  name: string | null;
  description: string | null;
  status: string;
  priority: number;
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  locationId: string | null;
  locationName: string | null;
  sessionTemplateId: string | null;
  sessionName: string | null;
  appointmentType: string | null;
  channel: string | null;
  channelLabel: string;
  /** s7.1: "Scope -- TMR International Hospital · Friday outpatient session". */
  scopeLine: string;
  /** s7.1: "Window -- Opens 60 days ahead · closes 2 hours before", in s15's plain language. */
  windowLine: string;
  /** s7.1: "Capacity -- 5 new · 10 follow-up · 2 walk-ins · 1 urgent reserve". */
  capacityLine: string;
  confirmationMode: string;
  patientEligibility: string;
  minAgeYears: number | null;
  maxAgeYears: number | null;
  followUpEarlyDays: number | null;
  followUpLateDays: number | null;
  capacityTotal: number | null;
  capacityNew: number | null;
  capacityFollowUp: number | null;
  capacityUrgentReserve: number | null;
  overbookingAllowed: number;
  leadTimeMinutes: number;
  bookingHorizonDays: number | null;
  walkInDailyLimit: number | null;
  /** s11's arithmetic, on the card, so the ladder is legible before anything is refused. */
  specificity: number;
  rung: string;
  reasons: string[];
  /** True when this row predates the card model and has no name of its own. */
  legacy: boolean;
  /** The ids of every active rule this one is deadlocked with. s11: activation is blocked until resolved. */
  conflictsWith: string[];
};

export type RuleConflict = {
  a: { id: string; name: string | null };
  b: { id: string; name: string | null };
  specificity: number;
  priority: number;
  rung: string;
  /** What a practitioner has to do about it, in their words. */
  resolution: string;
};

function toCard(r: any, names: { location: Map<string, string>; session: Map<string, string> }): BookingRuleCard {
  const s = scopeOf(r);
  const scopeBits: string[] = [];
  scopeBits.push(r.location_id ? names.location.get(r.location_id as string) ?? "A location" : "Whole practice");
  if (r.session_template_id) scopeBits.push(names.session.get(r.session_template_id as string) ?? "One session");
  if (r.appointment_type) scopeBits.push(String(r.appointment_type).replace(/_/g, " "));
  if (r.effective_from || r.effective_to)
    scopeBits.push(`${r.effective_from ?? "any date"} to ${r.effective_to ?? "no end"}`);

  return {
    id: r.id as string,
    name: (r.name as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    status: (r.status as string) ?? "active",
    priority: (r.priority as number) ?? 0,
    version: (r.version as number) ?? 1,
    effectiveFrom: s.effectiveFrom,
    effectiveTo: s.effectiveTo,
    locationId: s.locationId,
    locationName: s.locationId ? names.location.get(s.locationId) ?? null : null,
    sessionTemplateId: s.sessionTemplateId,
    sessionName: s.sessionTemplateId ? names.session.get(s.sessionTemplateId) ?? null : null,
    appointmentType: s.appointmentType,
    channel: s.channel,
    channelLabel: s.channel ? bookingChannel(s.channel)?.label ?? s.channel : "Every channel",
    scopeLine: scopeBits.join(" · "),
    windowLine: plainWindow((r.booking_horizon_days as number | null) ?? null, (r.lead_time_minutes as number) ?? 0),
    capacityLine: plainCapacity({
      total: (r.capacity_total as number | null) ?? null,
      newPatients: (r.capacity_new as number | null) ?? null,
      followUp: (r.capacity_follow_up as number | null) ?? null,
      urgentReserve: (r.capacity_urgent_reserve as number | null) ?? null,
      overbooking: (r.overbooking_allowed as number) ?? 0,
      walkInDailyLimit: (r.walk_in_daily_limit as number | null) ?? null,
    }),
    confirmationMode: (r.confirmation_mode as string) ?? "instant",
    patientEligibility: s.patientEligibility,
    minAgeYears: s.minAgeYears,
    maxAgeYears: s.maxAgeYears,
    followUpEarlyDays: (r.follow_up_early_days as number | null) ?? null,
    followUpLateDays: (r.follow_up_late_days as number | null) ?? null,
    capacityTotal: (r.capacity_total as number | null) ?? null,
    capacityNew: (r.capacity_new as number | null) ?? null,
    capacityFollowUp: (r.capacity_follow_up as number | null) ?? null,
    capacityUrgentReserve: (r.capacity_urgent_reserve as number | null) ?? null,
    overbookingAllowed: (r.overbooking_allowed as number) ?? 0,
    leadTimeMinutes: (r.lead_time_minutes as number) ?? 0,
    bookingHorizonDays: (r.booking_horizon_days as number | null) ?? null,
    walkInDailyLimit: (r.walk_in_daily_limit as number | null) ?? null,
    specificity: specificityOf(s),
    rung: specificityRung(s),
    reasons: specificityReasons(s),
    legacy: (r.name as string | null) === null,
    conflictsWith: [],
  };
}

/**
 * s11's CONFLICT TEST, over a set of rules that are already in force.
 *
 * ⚠ EQUAL SPECIFICITY, EQUAL PRIORITY, AND SCOPES THAT COULD BOTH APPLY. The third clause is not in
 * s11's sentence and it is what keeps the rule from crying wolf: two rules at different hospitals score
 * identically and can never decide the same booking, and reporting that pair as a conflict would stop a
 * practitioner having two hospitals.
 */
export function conflictsAmong(rules: any[]): RuleConflict[] {
  const inForce = rules.filter(r => RULE_STATUSES_IN_FORCE.includes((r.status as string) ?? "active"));
  const out: RuleConflict[] = [];
  for (let i = 0; i < inForce.length; i++) {
    for (let j = i + 1; j < inForce.length; j++) {
      const a = inForce[i], b = inForce[j];
      const sa = scopeOf(a), sb = scopeOf(b);
      if (specificityOf(sa) !== specificityOf(sb)) continue;
      if (((a.priority as number) ?? 0) !== ((b.priority as number) ?? 0)) continue;
      if (!scopesCanOverlap(sa, sb)) continue;
      out.push({
        a: { id: a.id as string, name: (a.name as string | null) ?? null },
        b: { id: b.id as string, name: (b.name as string | null) ?? null },
        specificity: specificityOf(sa),
        priority: (a.priority as number) ?? 0,
        rung: specificityRung(sa),
        resolution:
          "These two are equally specific and equally important, so nothing can choose between them. "
          + "Give one of them a higher priority, narrow one of their scopes, or pause one.",
      });
    }
  }
  return out;
}

/** Every rule this practice has, as cards, with the conflicts marked on them. */
export async function listBookingRules(admin: any, ctx: WorkspaceContext): Promise<Reading<BookingRuleCard[]>> {
  const { data, error } = await admin.from("practice_booking_rule")
    .select(RULE_COLUMNS).eq("workspace_id", ctx.workspaceId);
  // ⚠ NOT AN EMPTY LIST. "No rules" and "the rules could not be read" are the same length and opposite
  // facts, and only one of them means nothing is refusing a booking today.
  if (error) return { state: "unreadable", reason: `your booking rules could not be read: ${error.message}` };

  const rows = (data ?? []) as any[];
  const [{ data: locs }, { data: sess }] = await Promise.all([
    admin.from("practice_location").select("id, name").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_availability_template").select("id, session_name, weekday, starts_minute")
      .eq("workspace_id", ctx.workspaceId),
  ]);
  const names = {
    location: new Map(((locs ?? []) as any[]).map(l => [l.id as string, l.name as string])),
    session: new Map(((sess ?? []) as any[]).map(s => [
      s.id as string,
      (s.session_name as string | null) ?? `Session on day ${s.weekday}`,
    ])),
  };

  const cards = rows.map(r => toCard(r, names));
  const byId = new Map(cards.map(c => [c.id, c]));
  for (const c of conflictsAmong(rows)) {
    byId.get(c.a.id)?.conflictsWith.push(c.b.id);
    byId.get(c.b.id)?.conflictsWith.push(c.a.id);
  }
  // Most specific first, then most important, then by name -- the order the ladder decides in.
  cards.sort((x, y) => y.specificity - x.specificity || y.priority - x.priority
    || (x.name ?? "").localeCompare(y.name ?? ""));
  return { state: "ok", value: cards };
}

// ── AUTHORING (s7.2's builder, s14's permission, migration 244's versioning) ─────────────────────────

export type RuleInput = {
  ruleId?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  locationId?: string | null;
  sessionTemplateId?: string | null;
  appointmentType?: string | null;
  channel?: string | null;
  capacityTotal?: number | null;
  capacityNew?: number | null;
  capacityFollowUp?: number | null;
  capacityUrgentReserve?: number | null;
  overbookingAllowed?: number | null;
  patientEligibility?: string | null;
  minAgeYears?: number | null;
  maxAgeYears?: number | null;
  confirmationMode?: string | null;
  followUpEarlyDays?: number | null;
  followUpLateDays?: number | null;
  leadTimeMinutes?: number | null;
  bookingHorizonDays?: number | null;
  cancellationNoticeMinutes?: number | null;
  walkInDailyLimit?: number | null;
  /** Why it changed. s14 wants a reason on a configuration change; a version nobody explained is a guess. */
  reason?: string | null;
  actorId: string;
  correlationId: string;
};

const int = (v: unknown): number | null =>
  v === undefined || v === null || v === "" ? null : Math.trunc(Number(v));

/**
 * CREATE OR EDIT A RULE, AND KEEP THE HISTORY THAT MAKES AC-13 MEAN SOMETHING.
 *
 * ⚠ THE SNAPSHOT IS WRITTEN BEFORE THE UPDATE, AND ITS ERROR IS READ. The other order loses history
 * silently: if the update lands and the snapshot fails, version 3 exists and nothing records what
 * version 2 said, which is exactly the question a booking made under version 2 will be asked.
 *
 * ⚠ A SAVE THAT CHANGES NOTHING DOES NOT BUMP THE VERSION. A version that moves when nothing moved makes
 * the number meaningless as an answer to "which rule decided this", because two different numbers would
 * name the same rule.
 */
export async function saveBookingRule(admin: any, ctx: WorkspaceContext, args: RuleInput): Promise<EngineResult<{
  id: string; version: number; created: boolean; changed: string[]; conflicts: RuleConflict[];
}>> {
  // s14: "Create/override booking rule -- account owner: Yes. AUTHORISED STAFF: EXPLICIT PERMISSION
  // ONLY." practice.settings.manage is the capability the owner role holds by default and no other role
  // does, so a delegate only has it if somebody granted it to them by name. That IS "explicit permission
  // only", expressed in the capability catalogue that already exists rather than in a new invented code.
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required to write a booking rule" };

  // ── The rule as it exists now, if it exists.
  let existing: any = null;
  if (args.ruleId) {
    const { data, error } = await admin.from("practice_booking_rule")
      .select(RULE_COLUMNS).eq("id", args.ruleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the rule could not be read: ${error.message}` };
    if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    existing = data;
  }

  const name = args.name === undefined ? (existing?.name ?? null) : (args.name?.trim() || null);
  // s7.1's card is a card because it has a NAME. A new rule without one is a row nobody can recognise on
  // a list of four, which is the defect s2.1 names.
  if (!existing && !name)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a rule needs a name; the card model exists so you can tell four rules apart" };
  if (name !== null && (name.length < 1 || name.length > 120))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a rule name runs from 1 to 120 characters" };

  const next: Record<string, any> = {
    name,
    description: args.description === undefined ? (existing?.description ?? null) : (args.description?.trim() || null),
    status: args.status ?? existing?.status ?? "draft",
    priority: args.priority === undefined || args.priority === null ? (existing?.priority ?? 0) : int(args.priority),
    effective_from: args.effectiveFrom === undefined ? (existing?.effective_from ?? null) : (args.effectiveFrom || null),
    effective_to: args.effectiveTo === undefined ? (existing?.effective_to ?? null) : (args.effectiveTo || null),
    location_id: args.locationId === undefined ? (existing?.location_id ?? null) : (args.locationId || null),
    session_template_id: args.sessionTemplateId === undefined ? (existing?.session_template_id ?? null) : (args.sessionTemplateId || null),
    appointment_type: args.appointmentType === undefined ? (existing?.appointment_type ?? null) : (args.appointmentType || null),
    channel: args.channel === undefined ? (existing?.channel ?? null) : (args.channel || null),
    capacity_total: args.capacityTotal === undefined ? (existing?.capacity_total ?? null) : int(args.capacityTotal),
    capacity_new: args.capacityNew === undefined ? (existing?.capacity_new ?? null) : int(args.capacityNew),
    capacity_follow_up: args.capacityFollowUp === undefined ? (existing?.capacity_follow_up ?? null) : int(args.capacityFollowUp),
    capacity_urgent_reserve: args.capacityUrgentReserve === undefined ? (existing?.capacity_urgent_reserve ?? null) : int(args.capacityUrgentReserve),
    overbooking_allowed: args.overbookingAllowed === undefined || args.overbookingAllowed === null
      ? (existing?.overbooking_allowed ?? 0) : int(args.overbookingAllowed),
    patient_eligibility: args.patientEligibility ?? existing?.patient_eligibility ?? "any",
    min_age_years: args.minAgeYears === undefined ? (existing?.min_age_years ?? null) : int(args.minAgeYears),
    max_age_years: args.maxAgeYears === undefined ? (existing?.max_age_years ?? null) : int(args.maxAgeYears),
    confirmation_mode: args.confirmationMode ?? existing?.confirmation_mode ?? "instant",
    follow_up_early_days: args.followUpEarlyDays === undefined ? (existing?.follow_up_early_days ?? null) : int(args.followUpEarlyDays),
    follow_up_late_days: args.followUpLateDays === undefined ? (existing?.follow_up_late_days ?? null) : int(args.followUpLateDays),
    lead_time_minutes: args.leadTimeMinutes === undefined || args.leadTimeMinutes === null
      ? (existing?.lead_time_minutes ?? 0) : int(args.leadTimeMinutes),
    booking_horizon_days: args.bookingHorizonDays === undefined ? (existing?.booking_horizon_days ?? null) : int(args.bookingHorizonDays),
    cancellation_notice_minutes: args.cancellationNoticeMinutes === undefined || args.cancellationNoticeMinutes === null
      ? (existing?.cancellation_notice_minutes ?? 0) : int(args.cancellationNoticeMinutes),
    walk_in_daily_limit: args.walkInDailyLimit === undefined ? (existing?.walk_in_daily_limit ?? null) : int(args.walkInDailyLimit),
    emergency_reserve_minutes: existing?.emergency_reserve_minutes ?? 0,
    visibility: existing?.visibility ?? "internal",
  };

  const bad = validateRuleShape(next);
  if (bad) return bad;

  // Scope references must belong to this practice. A rule naming another practice's location or session
  // is a cross-tenant reference nothing else would ever notice.
  for (const [table, id, what] of [
    ["practice_location", next.location_id, "location"],
    ["practice_availability_template", next.session_template_id, "session"],
  ] as const) {
    if (!id) continue;
    const { data: row, error } = await admin.from(table)
      .select("id").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the ${what} could not be read: ${error.message}` };
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  }

  // ══ s11's CONFLICT VALIDATION, BEFORE THE WRITE ═════════════════════════════════════════════════
  //
  // Only when the rule is being put IN FORCE. A draft that would tie is a draft somebody is still
  // writing, and refusing to save it would make the conflict impossible to see before committing to it.
  const conflicts = await conflictsIfActivated(admin, ctx, next, existing?.id ?? null);
  if (!conflicts.ok) return conflicts;
  if (RULE_STATUSES_IN_FORCE.includes(next.status) && conflicts.data.length > 0) {
    const other = conflicts.data[0];
    const otherName = other.b.name ?? other.a.name ?? "an unnamed rule from before the card model";
    return {
      ok: false, status: 422, code: "RULE_CONFLICT",
      message: `this rule and "${otherName}" are equally specific (${other.rung.toLowerCase()}) and equally important (priority ${other.priority}), so nothing could choose between them. ${other.resolution}`,
    };
  }

  // ══ CREATE ═════════════════════════════════════════════════════════════════════════════════════
  if (!existing) {
    const { data, error } = await admin.from("practice_booking_rule").insert({
      workspace_id: ctx.workspaceId,
      ...next,
      version: 1,
      // ⚠ FALSE ON PURPOSE. See the header: migration 230's partial unique index makes the card model
      // and s11 unexpressible if this is true. `status` is the authority for this engine.
      active: false,
      created_by: args.actorId,
    }).select("id, version").maybeSingle();
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    if (!data) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the rule was not created" };

    await audit(admin, {
      workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_rule_created",
      payload: { ruleId: data.id, version: 1, reason: args.reason ?? null, rule: next },
      correlationId: args.correlationId,
    });
    return { ok: true, data: { id: data.id as string, version: 1, created: true, changed: [...VERSIONED_FIELDS], conflicts: [] } };
  }

  // ══ EDIT ═══════════════════════════════════════════════════════════════════════════════════════
  const changed = VERSIONED_FIELDS.filter(f => (existing[f] ?? null) !== (next[f] ?? null));
  if (changed.length === 0)
    return { ok: true, data: { id: existing.id as string, version: existing.version as number, created: false, changed: [], conflicts: conflicts.data } };

  // THE WHOLE PRIOR SHAPE, AT THE PRIOR VERSION NUMBER. So "what did version 3 say" is one row lookup
  // months later, rather than a replay of every diff since.
  const priorPayload: Record<string, any> = {};
  for (const f of VERSIONED_FIELDS) priorPayload[f] = existing[f] ?? null;
  const { error: snapErr } = await admin.from("practice_booking_rule_version").insert({
    workspace_id: ctx.workspaceId,
    rule_id: existing.id,
    version: existing.version,
    payload: priorPayload,
    reason: args.reason?.trim()?.slice(0, 500) || null,
    created_by: args.actorId,
  });
  // ⚠ REFUSED, NOT LOGGED AND CONTINUED. An edit whose predecessor was not kept is an edit that destroys
  // the answer AC-13 exists to give.
  if (snapErr)
    return { ok: false, status: 500, code: "HISTORY_NOT_KEPT", message: `the previous version could not be kept, so the rule was not changed: ${snapErr.message}` };

  const nextVersion = (existing.version as number) + 1;
  const { data: updated, error: upErr } = await admin.from("practice_booking_rule")
    .update({ ...next, version: nextVersion, active: false, updated_at: nowIso() })
    .eq("id", existing.id).eq("workspace_id", ctx.workspaceId).eq("version", existing.version)
    .select("id, version").maybeSingle();
  if (upErr) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: upErr.message };
  // The version is the optimistic-concurrency token as well as the audit one: two people editing one
  // rule cannot both win, and the loser is told rather than overwritten.
  if (!updated)
    return { ok: false, status: 409, code: "VERSION_CONFLICT", message: "this rule changed underneath you; reload and try again" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_rule_updated",
    payload: {
      ruleId: existing.id, fromVersion: existing.version, toVersion: nextVersion,
      changed, reason: args.reason ?? null,
      before: priorPayload, after: next,
    },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: existing.id as string, version: nextVersion, created: false, changed: [...changed], conflicts: conflicts.data } };
}

function validateRuleShape(next: Record<string, any>): EngineResult<never> | null {
  if (!RULE_STATUS_CODES.includes(next.status))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `status must be one of: ${RULE_STATUS_CODES.join(", ")}` };
  if (next.channel !== null && !BOOKING_CHANNEL_CODES.includes(next.channel))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `channel must be one of s7.3's six: ${BOOKING_CHANNEL_CODES.join(", ")}` };
  if (!CONFIRMATION_MODE_CODES.includes(next.confirmation_mode))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `confirmation must be one of: ${CONFIRMATION_MODE_CODES.join(", ")}` };
  if (!PATIENT_ELIGIBILITY_CODES.includes(next.patient_eligibility))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `patient eligibility must be one of s7.6's: ${PATIENT_ELIGIBILITY_CODES.join(", ")}` };
  if (typeof next.priority !== "number" || !Number.isFinite(next.priority) || next.priority < 0 || next.priority > 1000)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "priority runs from 0 to 1000" };
  if (next.effective_from && next.effective_to && next.effective_to < next.effective_from)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the last date a rule applies cannot be before the first" };
  if (next.min_age_years !== null && next.max_age_years !== null && next.max_age_years < next.min_age_years)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "the oldest age cannot be below the youngest" };

  // ⚠ s7.4's FIRST RULE, REFUSED HERE AS WELL AS BY THE DATABASE. Migration 244's CHECK is the backstop
  // and a constraint name is not a sentence: a reserve larger than the total is a rule that can never be
  // satisfied, and it must fail in front of the person typing it rather than in front of a patient.
  const reserved = (next.capacity_new ?? 0) + (next.capacity_follow_up ?? 0) + (next.capacity_urgent_reserve ?? 0);
  if (next.capacity_total !== null && reserved > next.capacity_total)
    return {
      ok: false, status: 422, code: "RESERVE_EXCEEDS_TOTAL",
      message: `you have set aside ${reserved} places out of a session total of ${next.capacity_total}. Reserved capacity cannot exceed the session's own, or the rule could never be satisfied.`,
    };
  return null;
}

/** Every in-force rule this one would deadlock with if it were put in force. */
async function conflictsIfActivated(
  admin: any, ctx: WorkspaceContext, candidate: Record<string, any>, excludeId: string | null,
): Promise<EngineResult<RuleConflict[]>> {
  const { data, error } = await admin.from("practice_booking_rule")
    .select(RULE_COLUMNS).eq("workspace_id", ctx.workspaceId);
  if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the other rules could not be read, so a conflict could not be ruled out: ${error.message}` };
  const others = ((data ?? []) as any[]).filter(r => r.id !== excludeId);
  const probe = { ...candidate, id: excludeId ?? "__candidate__", status: "active" };
  return { ok: true, data: conflictsAmong([probe, ...others]).filter(c => c.a.id === probe.id || c.b.id === probe.id) };
}

/** s7.1's card actions: pause, resume, archive. Activation runs s11's conflict test. */
export async function setRuleStatus(admin: any, ctx: WorkspaceContext, args: {
  ruleId: string; status: string; reason?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; status: string; version: number }>> {
  const saved = await saveBookingRule(admin, ctx, {
    ruleId: args.ruleId, status: args.status, reason: args.reason ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!saved.ok) return saved;
  return { ok: true, data: { id: saved.data.id, status: args.status, version: saved.data.version } };
}

export type RuleVersionEntry = {
  version: number;
  live: boolean;
  payload: Record<string, any>;
  reason: string | null;
  recordedAt: string | null;
};

/** Every version of one rule, oldest first, with the live one last and marked. */
export async function ruleVersionHistory(
  admin: any, ctx: WorkspaceContext, ruleId: string,
): Promise<Reading<RuleVersionEntry[]>> {
  const { data: live, error: liveErr } = await admin.from("practice_booking_rule")
    .select(RULE_COLUMNS).eq("id", ruleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (liveErr) return { state: "unreadable", reason: `the rule could not be read: ${liveErr.message}` };
  if (!live) return { state: "unreadable", reason: "that rule is not in this practice" };

  const { data: past, error } = await admin.from("practice_booking_rule_version")
    .select("version, payload, reason, created_at")
    .eq("rule_id", ruleId).eq("workspace_id", ctx.workspaceId).order("version");
  if (error) return { state: "unreadable", reason: `the rule's history could not be read: ${error.message}` };

  const livePayload: Record<string, any> = {};
  for (const f of VERSIONED_FIELDS) livePayload[f] = (live as any)[f] ?? null;

  return {
    state: "ok",
    value: [
      ...((past ?? []) as any[]).map(p => ({
        version: p.version as number, live: false,
        payload: (p.payload ?? {}) as Record<string, any>,
        reason: (p.reason as string | null) ?? null,
        recordedAt: (p.created_at as string) ?? null,
      })),
      { version: live.version as number, live: true, payload: livePayload, reason: null, recordedAt: (live.updated_at as string | null) ?? null },
    ],
  };
}

// ── EVALUATION (s11's ladder, s7.4, s7.5, s7.6, s7.2's confirmation) ────────────────────────────────

export type BookingRequest = {
  channel: string;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes?: number | null;
  locationId?: string | null;
  patientId?: string | null;
  /** s7.5. Present when the booking is being made against a follow-up plan. */
  followUpId?: string | null;
  /** s7.6's "referred only". A fact about this booking, not about the patient record. */
  referred?: boolean;
};

export type Refusal = {
  code: string;
  message: string;
  /** s14: an authorised override applies to CAPACITY and WINDOW, and to nothing else. */
  overridable: boolean;
};

export type RuleDecision = {
  allowed: boolean;
  /** ⚠ NULL means no rule decided this. That is a real answer -- s11's sixth rung -- and never a blank. */
  ruleId: string | null;
  ruleName: string | null;
  ruleVersion: number | null;
  decidedBy: "rule" | "platform_default";
  rung: string;
  specificity: number;
  /** s11: "Users must be able to see why a rule won." */
  why: string[];
  runnersUp: { id: string; name: string | null; specificity: number; priority: number; rung: string }[];
  confirmationMode: string;
  /** What the appointment would be created as. s7.2's confirmation section, made concrete. */
  initialStatus: "CONFIRMED" | "REQUESTED";
  refusals: Refusal[];
  capacity: {
    windowLabel: string;
    used: number; usedNew: number; usedFollowUp: number;
    total: number | null; ceiling: number | null;
    urgentReserve: number | null;
  } | null;
  /** Caveats that are true of this decision. Never a substitute for a refusal. */
  notes: string[];
};

type PatientFacts = {
  isNew: boolean | null;
  ageYears: number | null;
  hasActiveFollowUp: boolean | null;
  /**
   * s7.6's "referred only". ⚠ THE ONE FACT THAT IS NOT READ FROM A RECORD, because there is no referral
   * table: it is a property of the booking being made, not of the patient. It is therefore the one
   * eligibility criterion an internal caller asserts, and the rule that turns on it says so on the card.
   */
  referred: boolean;
};

/**
 * ⚠ THE FACTS ELIGIBILITY TURNS ON ARE READ, NEVER ACCEPTED. "Is this patient new" arriving in a request
 * body is a claim, and a rule that only lets new patients into a Friday clinic would be settled by
 * whoever wrote the request.
 */
async function readPatientFacts(
  admin: any, ctx: WorkspaceContext, patientId: string | null, onDate: string, referred: boolean,
): Promise<Reading<PatientFacts>> {
  if (!patientId)
    return { state: "ok", value: { isNew: null, ageYears: null, hasActiveFollowUp: null, referred } };

  const { data: p, error: pErr } = await admin.from("practice_patient")
    .select("id, birth_date").eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return { state: "unreadable", reason: `the patient record could not be read: ${pErr.message}` };
  if (!p) return { state: "unreadable", reason: "that patient is not in this practice" };

  const { data: history, error: hErr } = await admin.from("practice_appointment")
    .select("id, status").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .in("status", ["COMPLETED", "ARRIVED", "CONFIRMED", "REQUESTED", "NO_SHOW"]).limit(1);
  if (hErr) return { state: "unreadable", reason: `this patient's appointment history could not be read: ${hErr.message}` };

  const { data: fups, error: fErr } = await admin.from("practice_follow_up")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .in("status", LIVE_FOLLOW_UP_STATUSES).limit(1);
  if (fErr) return { state: "unreadable", reason: `this patient's follow-up plans could not be read: ${fErr.message}` };

  let ageYears: number | null = null;
  const dob = (p.birth_date as string | null) ?? null;
  if (dob) {
    const [by, bm, bd] = dob.split("-").map(Number);
    const [ay, am, ad] = onDate.split("-").map(Number);
    ageYears = ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
  }

  return {
    state: "ok",
    value: {
      isNew: ((history ?? []) as any[]).length === 0,
      ageYears,
      hasActiveFollowUp: ((fups ?? []) as any[]).length > 0,
      referred,
    },
  };
}

/** Does this rule's eligibility describe this patient? Null facts mean NO, and the caller says why. */
function eligibilityMatches(r: any, facts: PatientFacts): { matches: boolean; unknown: string | null } {
  const s = scopeOf(r);
  if (s.minAgeYears !== null || s.maxAgeYears !== null) {
    if (facts.ageYears === null)
      return { matches: false, unknown: "a rule scoped by age could not be applied because no date of birth is recorded for this patient" };
    if (s.minAgeYears !== null && facts.ageYears < s.minAgeYears) return { matches: false, unknown: null };
    if (s.maxAgeYears !== null && facts.ageYears > s.maxAgeYears) return { matches: false, unknown: null };
  }
  switch (s.patientEligibility) {
    case "any": return { matches: true, unknown: null };
    case "new_only":
      if (facts.isNew === null)
        return { matches: false, unknown: "a rule for new patients could not be applied because this booking is not linked to a patient record" };
      return { matches: facts.isNew, unknown: null };
    case "existing_only":
      if (facts.isNew === null)
        return { matches: false, unknown: "a rule for existing patients could not be applied because this booking is not linked to a patient record" };
      return { matches: !facts.isNew, unknown: null };
    case "referred_only":
      return { matches: facts.referred, unknown: null };
    case "paediatric":
      if (facts.ageYears === null)
        return { matches: false, unknown: "a rule for children could not be applied because no date of birth is recorded for this patient" };
      return { matches: facts.ageYears < 18, unknown: null };
    case "adult":
      if (facts.ageYears === null)
        return { matches: false, unknown: "a rule for adults could not be applied because no date of birth is recorded for this patient" };
      return { matches: facts.ageYears >= 18, unknown: null };
    case "active_follow_up":
      if (facts.hasActiveFollowUp === null)
        return { matches: false, unknown: "a rule for patients on a follow-up plan could not be applied because this booking is not linked to a patient record" };
      return { matches: facts.hasActiveFollowUp, unknown: null };
    default: return { matches: true, unknown: null };
  }
}

/** The session occurrence a moment falls inside, so s7.4's "capacity is per session" is per session. */
async function sessionAt(admin: any, ctx: WorkspaceContext, args: {
  timezone: string; date: string; minuteOfDay: number; locationId: string | null;
}): Promise<Reading<{ id: string; name: string | null; startsMinute: number; endsMinute: number } | null>> {
  const weekday = ((new Date(`${args.date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const { data, error } = await admin.from("practice_availability_template")
    .select("id, session_name, weekday, starts_minute, ends_minute, location_id, status, effective_from, effective_to")
    .eq("workspace_id", ctx.workspaceId).eq("weekday", weekday).eq("status", "active");
  if (error) return { state: "unreadable", reason: `your sessions could not be read: ${error.message}` };

  const hit = ((data ?? []) as any[]).find(t => {
    if (args.locationId && t.location_id && t.location_id !== args.locationId) return false;
    if (t.effective_from && args.date < t.effective_from) return false;
    if (t.effective_to && args.date > t.effective_to) return false;
    return args.minuteOfDay >= (t.starts_minute as number) && args.minuteOfDay < (t.ends_minute as number);
  });
  if (!hit) return { state: "ok", value: null };
  return {
    state: "ok",
    value: {
      id: hit.id as string, name: (hit.session_name as string | null) ?? null,
      startsMinute: hit.starts_minute as number, endsMinute: hit.ends_minute as number,
    },
  };
}

/**
 * s11's LADDER, s7.4's CAPACITY, s7.5's WINDOW AND s7.2's CONFIRMATION, IN ONE SERVER-SIDE ANSWER.
 *
 * ⚠ REFUSES (ok:false) FOR EXACTLY TWO THINGS: a read that failed, and a conflict s11 says blocks. A
 * booking that is merely NOT ALLOWED comes back ok:true with allowed:false and its refusals named, so a
 * screen can show why and offer an override. An outage and a policy are different answers.
 */
export async function evaluateBooking(
  admin: any, ctx: WorkspaceContext, req: BookingRequest,
): Promise<EngineResult<RuleDecision>> {
  if (!BOOKING_CHANNEL_CODES.includes(req.channel))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `channel must be one of s7.3's six: ${BOOKING_CHANNEL_CODES.join(", ")}` };
  const startMs = Date.parse(req.scheduledAt);
  if (Number.isNaN(startMs))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "scheduledAt is not a valid timestamp" };

  const { data: ws, error: wsErr } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  if (wsErr) return { ok: false, status: 503, code: "READ_FAILED", message: `the practice timezone could not be read: ${wsErr.message}` };
  const timezone = (ws?.timezone as string) || "UTC";

  const date = new Date(startMs).toLocaleDateString("en-CA", { timeZone: timezone });
  const dayStartMs = Date.parse(zonedDayRange(date, timezone).startIso);
  const minuteOfDay = Math.floor((startMs - dayStartMs) / 60000);
  const locationId = req.locationId ?? null;

  // ══ THE RULES. ⚠ AN UNREADABLE RULE SET IS NOT AN EMPTY ONE. ═══════════════════════════════════
  const { data: ruleRows, error: ruleErr } = await admin.from("practice_booking_rule")
    .select(RULE_COLUMNS).eq("workspace_id", ctx.workspaceId);
  if (ruleErr)
    return {
      ok: false, status: 503, code: "RULES_UNREADABLE",
      message: `this booking was not made because your booking rules could not be read: ${ruleErr.message} — an unread rule is not an absent one`,
    };

  const facts = await readPatientFacts(admin, ctx, req.patientId ?? null, date, req.referred === true);
  if (facts.state !== "ok")
    return { ok: false, status: 503, code: "PATIENT_FACTS_UNREADABLE", message: `this booking was not made because ${facts.reason}` };

  const session = await sessionAt(admin, ctx, { timezone, date, minuteOfDay, locationId });
  if (session.state !== "ok")
    return { ok: false, status: 503, code: "SESSIONS_UNREADABLE", message: `this booking was not made because ${session.reason}` };

  const notes: string[] = [];
  const inForce = ((ruleRows ?? []) as any[])
    .filter(r => RULE_STATUSES_IN_FORCE.includes((r.status as string) ?? "active"));

  const candidates = inForce.filter(r => {
    const s = scopeOf(r);
    if (s.effectiveFrom && date < s.effectiveFrom) return false;
    if (s.effectiveTo && date > s.effectiveTo) return false;
    if (s.locationId && s.locationId !== locationId) return false;
    if (s.appointmentType && s.appointmentType !== req.appointmentType) return false;
    if (s.channel && s.channel !== req.channel) return false;
    if (s.sessionTemplateId && s.sessionTemplateId !== (session.value?.id ?? null)) return false;
    const e = eligibilityMatches(r, facts.value);
    if (e.unknown && !notes.includes(e.unknown)) notes.push(e.unknown);
    return e.matches;
  });

  // ══ s11: MOST SPECIFIC WINS; AT EQUAL SPECIFICITY, PRIORITY; AT BOTH EQUAL, BLOCKED ════════════
  const scored = candidates.map(r => ({ r, spec: specificityOf(scopeOf(r)), pri: (r.priority as number) ?? 0 }));
  const topSpec = scored.reduce((n, c) => Math.max(n, c.spec), -1);
  const atTopSpec = scored.filter(c => c.spec === topSpec);
  const topPri = atTopSpec.reduce((n, c) => Math.max(n, c.pri), -1);
  const winners = atTopSpec.filter(c => c.pri === topPri);

  if (winners.length > 1) {
    const named = winners.map(w => `"${(w.r.name as string | null) ?? "an unnamed rule from before the card model"}"`);
    return {
      ok: false, status: 422, code: "RULE_CONFLICT",
      message: `${named.join(" and ")} are equally specific (${specificityRung(scopeOf(winners[0].r)).toLowerCase()}) and equally important (priority ${topPri}), so nothing can choose between them. This booking is blocked until one of them is given a higher priority, narrowed or paused.`,
    };
  }

  const runnersUp = scored.filter(c => c.r.id !== winners[0]?.r.id).map(c => ({
    id: c.r.id as string, name: (c.r.name as string | null) ?? null,
    specificity: c.spec, priority: c.pri, rung: specificityRung(scopeOf(c.r)),
  })).sort((a, b) => b.specificity - a.specificity || b.priority - a.priority);

  // ══ s11's SIXTH RUNG: NO RULE AT ALL ═══════════════════════════════════════════════════════════
  if (winners.length === 0) {
    return {
      ok: true,
      data: {
        allowed: true, ruleId: null, ruleName: null, ruleVersion: null,
        decidedBy: "platform_default", rung: PLATFORM_DEFAULT_RUNG, specificity: -1,
        why: [
          inForce.length === 0
            ? "You have no booking rule in force, so nothing constrains this booking."
            : "No rule you have written covers this booking, so nothing constrains it.",
        ],
        runnersUp: [], confirmationMode: "instant", initialStatus: "CONFIRMED",
        refusals: [], capacity: null,
        notes: [
          ...notes,
          "This booking was not decided by a rule. It will be recorded as such rather than attributed to one.",
        ],
      },
    };
  }

  const win = winners[0].r;
  const winScope = scopeOf(win);
  const refusals: Refusal[] = [];

  // ── s7.2's BOOKING WINDOW, from the two columns that have held it since migration 230.
  const leadMinutes = (win.lead_time_minutes as number) ?? 0;
  const horizonDays = (win.booking_horizon_days as number | null) ?? null;
  if (leadMinutes > 0 && startMs < Date.now() + leadMinutes * 60000)
    refusals.push({
      code: "LEAD_TIME", overridable: true,
      message: `"${(win.name as string | null) ?? "this rule"}" needs ${leadMinutes} minutes' notice, and that time is sooner than that.`,
    });
  if (horizonDays !== null && startMs > Date.now() + horizonDays * 86400000)
    refusals.push({
      code: "BEYOND_HORIZON", overridable: true,
      message: `"${(win.name as string | null) ?? "this rule"}" opens the diary ${horizonDays} days ahead, and that date is further out.`,
    });

  // ── s7.4's CAPACITY, PER SESSION.
  let capacity: RuleDecision["capacity"] = null;
  const capacityWanted = win.capacity_total !== null || win.capacity_new !== null
    || win.capacity_follow_up !== null || (win.capacity_urgent_reserve ?? 0) > 0;
  if (capacityWanted) {
    const windowStartMin = session.value ? session.value.startsMinute : 0;
    const windowEndMin = session.value ? session.value.endsMinute : 1440;
    const startIso = new Date(dayStartMs + windowStartMin * 60000).toISOString();
    const endIso = new Date(dayStartMs + windowEndMin * 60000).toISOString();

    let q = admin.from("practice_appointment")
      .select("id, appointment_type")
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_BOOKING_STATUSES)
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso);
    if (winScope.locationId) q = q.eq("location_id", winScope.locationId);
    const { data: taken, error: takenErr } = await q;
    // ⚠ A COUNT THAT FAILED IS NOT A COUNT OF NOUGHT. Waving a booking through here would overfill a
    // clinic because the database hiccupped, and the practitioner would find out on the day.
    if (takenErr)
      return {
        ok: false, status: 503, code: "CAPACITY_UNREADABLE",
        message: `this booking was not made because the appointments already in that session could not be counted: ${takenErr.message}`,
      };

    const rows = (taken ?? []) as any[];
    const used = rows.length;
    const usedNew = rows.filter(a => a.appointment_type === "new_consultation").length;
    const usedFollowUp = rows.filter(a => a.appointment_type === "scheduled_followup").length;
    const total = (win.capacity_total as number | null) ?? null;
    const over = (win.overbooking_allowed as number | null) ?? 0;
    const ceiling = total === null ? null : total + over;
    const reserve = (win.capacity_urgent_reserve as number | null) ?? null;

    // s7.4: "Capacity is calculated PER SESSION, not merely per day." The label says which, because a
    // refusal that names the wrong window is a refusal a practitioner cannot check.
    const windowLabel = session.value
      ? `${session.value.name ?? "the session"} on ${date}`
      : `${date} (no session covers that time, so the whole day was counted)`;

    capacity = { windowLabel, used, usedNew, usedFollowUp, total, ceiling, urgentReserve: reserve };

    if (ceiling !== null && used >= ceiling)
      refusals.push({
        code: "CAPACITY_FULL", overridable: true,
        message: `${windowLabel} already holds ${used} of ${ceiling}${over > 0 ? ` (${total} plus ${over} over)` : ""}.`,
      });
    else if (ceiling !== null && reserve !== null && reserve > 0
      && req.appointmentType !== "emergency" && used >= ceiling - reserve)
      refusals.push({
        code: "URGENT_RESERVE", overridable: true,
        message: `the last ${reserve} place${reserve === 1 ? "" : "s"} in ${windowLabel} ${reserve === 1 ? "is" : "are"} held for urgent appointments, and ${used} of ${ceiling} are taken.`,
      });

    const perType: [string, number | null, number][] = [
      ["new_consultation", (win.capacity_new as number | null) ?? null, usedNew],
      ["scheduled_followup", (win.capacity_follow_up as number | null) ?? null, usedFollowUp],
    ];
    for (const [type, cap, usedOfType] of perType) {
      if (req.appointmentType !== type || cap === null) continue;
      if (usedOfType >= cap)
        refusals.push({
          code: "TYPE_CAPACITY_FULL", overridable: true,
          message: `${windowLabel} allows ${cap} ${type.replace(/_/g, " ")} appointment${cap === 1 ? "" : "s"}, and ${usedOfType} ${usedOfType === 1 ? "is" : "are"} already booked.`,
        });
    }
  }

  // ── s7.5 AND AC-08: A FOLLOW-UP MAY ONLY BE OFFERED SESSIONS CONSISTENT WITH ITS DUE WINDOW.
  if (req.followUpId) {
    const { data: fup, error: fupErr } = await admin.from("practice_follow_up")
      .select("id, due_on, status").eq("id", req.followUpId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (fupErr)
      return { ok: false, status: 503, code: "FOLLOW_UP_UNREADABLE", message: `this booking was not made because the follow-up plan could not be read: ${fupErr.message}` };
    if (!fup) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

    const early = (win.follow_up_early_days as number | null) ?? null;
    const late = (win.follow_up_late_days as number | null) ?? null;
    const due = fup.due_on as string;
    if (early === null && late === null) {
      notes.push(`"${(win.name as string | null) ?? "this rule"}" sets no early or late window for follow-ups, so this booking was not checked against the ${due} due date.`);
    } else {
      const earliest = early === null ? null : shiftDate(due, -early);
      const latest = late === null ? null : shiftDate(due, late);
      if (earliest !== null && date < earliest)
        refusals.push({
          code: "FOLLOW_UP_TOO_EARLY", overridable: true,
          message: `this follow-up is due on ${due} and may be booked from ${earliest}. ${date} is earlier than that.`,
        });
      if (latest !== null && date > latest)
        refusals.push({
          code: "FOLLOW_UP_TOO_LATE", overridable: true,
          message: `this follow-up was due on ${due} and may be booked until ${latest}. ${date} is later than that.`,
        });
    }
  } else if (req.channel === "follow_up") {
    refusals.push({
      code: "FOLLOW_UP_PLAN_REQUIRED", overridable: false,
      message: "a follow-up booking has to say which follow-up plan it is for; without one there is no due date to book it against.",
    });
  }

  // ── s7.2's CONFIRMATION.
  const mode = (win.confirmation_mode as string) ?? "instant";
  const initialStatus: "CONFIRMED" | "REQUESTED" =
    mode === "instant" ? "CONFIRMED"
      : mode === "conditional" ? (facts.value.isNew === false ? "CONFIRMED" : "REQUESTED")
        : "REQUESTED";
  if (mode === "conditional" && facts.value.isNew === null)
    notes.push("This rule confirms existing patients immediately, and this booking is not linked to a patient record, so it was made a request rather than assumed to be somebody you have seen.");

  const why = [
    ...specificityReasons(winScope),
    runnersUp.length > 0
      ? `${runnersUp.length} other rule${runnersUp.length === 1 ? "" : "s"} could have applied; this one is more specific or more important.`
      : "No other rule could have applied to this booking.",
  ];
  if (atTopSpec.length > 1)
    why.push(`${atTopSpec.length} rules were equally specific, and this one has the higher priority (${topPri}).`);

  return {
    ok: true,
    data: {
      allowed: refusals.length === 0,
      ruleId: win.id as string,
      ruleName: (win.name as string | null) ?? null,
      ruleVersion: (win.version as number) ?? 1,
      decidedBy: "rule",
      rung: specificityRung(winScope),
      specificity: topSpec,
      why, runnersUp,
      confirmationMode: mode, initialStatus,
      refusals, capacity, notes,
    },
  };
}

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// ── BOOKING (s19's Phase 3 exit condition) ──────────────────────────────────────────────────────────

export type InternalBookingArgs = {
  channel: string;
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
  appointmentType: string;
  scheduledAt: string;
  durationMinutes?: number | null;
  locationId?: string | null;
  reason?: string | null;
  followUpId?: string | null;
  referred?: boolean;
  allowOverlap?: boolean;
  /** s14, AC-14. A reason is not optional and the record is written before the booking. */
  override?: { reason: string } | null;
  actorId: string;
  correlationId: string;
};

export type InternalBookingResult = {
  appointmentId: string;
  status: string;
  appliedRuleId: string | null;
  appliedRuleVersion: number | null;
  decidedBy: "rule" | "platform_default";
  ruleName: string | null;
  rung: string;
  why: string[];
  overridden: string[];
  notes: string[];
};

/**
 * s19's PHASE 3 EXIT CONDITION: "INTERNAL PRACTITIONER/STAFF BOOKING FOLLOWS RULES."
 *
 * ⚠ THE RULE IS EVALUATED HERE, NOT SENT HERE. There is no ruleId, no version and no verdict in the
 * argument list, and adding one later would be adding a way to book past a rule by editing a request.
 *
 * ⚠ applied_rule_id AND applied_rule_version ARE WRITTEN IN THE SAME INSERT AS THE APPOINTMENT. Booking
 * first and stamping second would leave a booking that says it was decided by nothing whenever the
 * second statement failed -- and "decided by nothing" is a claim this schema treats as true.
 */
export async function bookUnderRules(
  admin: any, ctx: WorkspaceContext, args: InternalBookingArgs,
): Promise<EngineResult<InternalBookingResult>> {
  const channel = bookingChannel(args.channel);
  if (!channel)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `channel must be one of s7.3's six: ${BOOKING_CHANNEL_CODES.join(", ")}` };

  // ⚠ A CHANNEL WITH NO DOOR IS REFUSED BY NAME, NOT SILENTLY ACCEPTED. AC-06 needs a rule to be
  // WRITEABLE for all six channels; it does not make a patient booking real because a rule mentions one.
  if (!BOOKING_CHANNELS_WITH_A_DOOR.includes(channel.code))
    return {
      ok: false, status: 422, code: "CHANNEL_NOT_BUILT",
      message: `${channel.label.toLowerCase()} is not built. ${channel.phase} owns it, and a rule may already be written for it — but there is no way for such a booking to arrive, so making one here would invent it.`,
    };

  if (!ctx.capabilities.includes(channel.capability))
    return { ok: false, status: 403, code: "FORBIDDEN", message: `${channel.capability} is required` };

  const decision = await evaluateBooking(admin, ctx, {
    channel: args.channel, appointmentType: args.appointmentType, scheduledAt: args.scheduledAt,
    durationMinutes: args.durationMinutes ?? null, locationId: args.locationId ?? null,
    patientId: args.patientId ?? null, followUpId: args.followUpId ?? null, referred: args.referred === true,
  });
  // A refusal here is an outage or s11's blocked conflict. Both stop the booking.
  if (!decision.ok) return decision;
  const d = decision.data;

  // ══ s14 AND AC-14: AN OVERRIDE NEEDS A PERMISSION, A REASON, AND A RECORD ══════════════════════
  const overridden: string[] = [];
  if (d.refusals.length > 0) {
    if (!args.override)
      return {
        ok: false, status: 422, code: d.refusals[0].code,
        message: d.refusals.map(r => r.message).join(" "),
      };
    const notOverridable = d.refusals.filter(r => !r.overridable);
    if (notOverridable.length > 0)
      return {
        ok: false, status: 422, code: notOverridable[0].code,
        message: `${notOverridable.map(r => r.message).join(" ")} That is not something an override can lift.`,
      };
    // s14: "Override capacity/window -- account owner: YES WITH REASON. Authorised staff: only if
    // permitted AND WITH REASON."
    if (!ctx.capabilities.includes("practice.settings.manage"))
      return { ok: false, status: 403, code: "OVERRIDE_NOT_PERMITTED", message: "practice.settings.manage is required to override a booking rule" };
    const reason = args.override.reason?.trim() ?? "";
    if (reason.length < 3)
      return {
        ok: false, status: 400, code: "OVERRIDE_REASON_REQUIRED",
        message: "an override has to say why. A booking that broke a rule for a reason nobody wrote down cannot be answered for afterwards.",
      };
    overridden.push(...d.refusals.map(r => r.code));

    // ⚠ WRITTEN BEFORE THE BOOKING AND ITS ERROR IS READ. audit() logs and continues when its insert
    // fails, which is right for a log and wrong for this: AC-14 says the override APPEARS IN THE AUDIT
    // TRAIL, so an override that could not be recorded must not become a booking.
    const { error: overrideErr } = await admin.from("practice_audit_event").insert({
      workspace_id: ctx.workspaceId,
      actor_id: args.actorId,
      event_type: "practice.booking_rule_overridden",
      correlation_id: args.correlationId,
      payload: {
        // s12's OverrideRecord: actor, permission, reason, prior decision, new decision.
        permission: "practice.settings.manage",
        reason: reason.slice(0, 500),
        priorDecision: { allowed: false, refusals: d.refusals },
        newDecision: { allowed: true, by: "override" },
        ruleId: d.ruleId, ruleVersion: d.ruleVersion, ruleName: d.ruleName,
        channel: args.channel, scheduledAt: args.scheduledAt, appointmentType: args.appointmentType,
      },
    });
    if (overrideErr)
      return { ok: false, status: 503, code: "OVERRIDE_NOT_RECORDED", message: `this booking was not made because the override could not be recorded: ${overrideErr.message}` };
  } else if (args.override) {
    return {
      ok: false, status: 422, code: "NOTHING_TO_OVERRIDE",
      message: "nothing refused this booking, so there is no override to record. An override with no refusal behind it is an audit record about nothing.",
    };
  }

  // ── The patient, and the name the diary carries.
  let patientName = args.patientName?.trim() || null;
  if (args.patientId) {
    const { data: patient, error } = await admin.from("practice_patient")
      .select("id, display_name, status").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: `the patient record could not be read: ${error.message}` };
    if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (patient.status !== "active")
      return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };
    patientName = patient.display_name as string;
  }
  if (!patientName)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "patientName or patientId is required" };

  const duration = args.durationMinutes ?? await defaultAppointmentMinutes(admin, ctx.workspaceId);
  const startMs = Date.parse(args.scheduledAt);
  const endMs = startMs + duration * 60000;

  // Phase 1 and Phase 2's checks still apply: the location must be this practice's and open, nobody can
  // be in two hospitals at once, and a double-book is deliberate or refused. Shared rather than copied,
  // for the reason checkPlacement's own comment gives.
  const placed = await checkPlacement(admin, {
    workspaceId: ctx.workspaceId, startMs, endMs,
    locationId: args.locationId ?? null, appointmentType: args.appointmentType,
    allowOverlap: args.allowOverlap === true,
  });
  if (!placed.ok) return placed;

  const { data: appt, error } = await admin.from("practice_appointment").insert({
    workspace_id: ctx.workspaceId,
    location_id: args.locationId ?? null,
    patient_id: args.patientId ?? null,
    patient_name: patientName,
    patient_phone: args.patientPhone?.trim() || null,
    appointment_type: args.appointmentType,
    scheduled_at: new Date(startMs).toISOString(),
    duration_minutes: duration,
    status: d.initialStatus,
    reason: args.reason ?? null,
    // ══ AC-13. THE PAIR, IN THIS STATEMENT, OR NEITHER. ═══════════════════════════════════════════
    applied_rule_id: d.ruleId,
    applied_rule_version: d.ruleVersion,
    created_by: args.actorId,
  }).select("id, status").maybeSingle();
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  if (!appt) return { ok: false, status: 500, code: "INSERT_FAILED", message: "the booking was not made" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_made_under_rule",
    payload: {
      appointmentId: appt.id, channel: args.channel,
      appliedRuleId: d.ruleId, appliedRuleVersion: d.ruleVersion, decidedBy: d.decidedBy,
      rung: d.rung, why: d.why, overridden, status: d.initialStatus,
    },
    correlationId: args.correlationId,
  });

  return {
    ok: true,
    data: {
      appointmentId: appt.id as string,
      status: appt.status as string,
      appliedRuleId: d.ruleId,
      appliedRuleVersion: d.ruleVersion,
      decidedBy: d.decidedBy,
      ruleName: d.ruleName,
      rung: d.rung,
      why: d.why,
      overridden,
      notes: d.notes,
    },
  };
}

// ── READING A DECISION BACK, MONTHS LATER (AC-13's whole point) ─────────────────────────────────────

export type AppliedRuleExplanation = {
  appointmentId: string;
  scheduledAt: string;
  /** ⚠ FALSE IS A REAL ANSWER, AND THE SCREEN MUST SAY IT RATHER THAN LEAVE A BLANK. */
  decidedByARule: boolean;
  ruleId: string | null;
  ruleVersion: number | null;
  ruleName: string | null;
  /** The rule AS IT WAS at that version -- not as it is now, which is a different rule with the same id. */
  ruleAsApplied: Record<string, any> | null;
  /** True when the rule has been edited since; the live shape would answer the question wrongly. */
  editedSince: boolean;
  liveVersion: number | null;
  statement: string;
};

export async function explainAppointment(
  admin: any, ctx: WorkspaceContext, appointmentId: string,
): Promise<Reading<AppliedRuleExplanation>> {
  const { data: appt, error } = await admin.from("practice_appointment")
    .select("id, scheduled_at, applied_rule_id, applied_rule_version")
    .eq("id", appointmentId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (error) return { state: "unreadable", reason: `the appointment could not be read: ${error.message}` };
  if (!appt) return { state: "unreadable", reason: "that appointment is not in this practice" };

  const ruleId = (appt.applied_rule_id as string | null) ?? null;
  const version = (appt.applied_rule_version as number | null) ?? null;

  if (ruleId === null || version === null) {
    return {
      state: "ok",
      value: {
        appointmentId: appt.id as string, scheduledAt: appt.scheduled_at as string,
        decidedByARule: false, ruleId: null, ruleVersion: null, ruleName: null,
        ruleAsApplied: null, editedSince: false, liveVersion: null,
        // ⚠ NOT A BLANK WHERE A RULE NAME GOES. Null means this booking was not decided by a rule --
        // which is TRUE of every appointment made before the rules engine existed.
        statement: "This booking was not decided by a booking rule. It was made before the rules engine, or through a door that does not consult one.",
      },
    };
  }

  const { data: live, error: liveErr } = await admin.from("practice_booking_rule")
    .select(RULE_COLUMNS).eq("id", ruleId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (liveErr) return { state: "unreadable", reason: `the rule behind this booking could not be read: ${liveErr.message}` };

  const liveVersion = live ? (live.version as number) : null;
  let asApplied: Record<string, any> | null = null;

  if (live && liveVersion === version) {
    asApplied = {};
    for (const f of VERSIONED_FIELDS) asApplied[f] = (live as any)[f] ?? null;
  } else {
    const { data: snap, error: snapErr } = await admin.from("practice_booking_rule_version")
      .select("payload").eq("rule_id", ruleId).eq("version", version)
      .eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (snapErr) return { state: "unreadable", reason: `the version of the rule that decided this booking could not be read: ${snapErr.message}` };
    asApplied = snap ? ((snap.payload ?? {}) as Record<string, any>) : null;
  }

  const nameThen = (asApplied?.name as string | null) ?? (live?.name as string | null) ?? null;
  return {
    state: "ok",
    value: {
      appointmentId: appt.id as string, scheduledAt: appt.scheduled_at as string,
      decidedByARule: true, ruleId, ruleVersion: version, ruleName: nameThen,
      ruleAsApplied: asApplied, editedSince: liveVersion !== null && liveVersion !== version, liveVersion,
      statement: asApplied === null
        ? `This booking was decided by version ${version} of a rule whose record of that version is missing, so what it said cannot be shown.`
        : liveVersion !== null && liveVersion !== version
          ? `This booking was decided by "${nameThen ?? "an unnamed rule"}" as it stood at version ${version}. That rule has been edited since and is now at version ${liveVersion}; what is shown here is what it said at the time.`
          : `This booking was decided by "${nameThen ?? "an unnamed rule"}" at version ${version}, which is still what the rule says.`,
    },
  };
}

// ── WHAT LAYER 3 DRAWS ──────────────────────────────────────────────────────────────────────────────

export type BookingRulesWorkspace = {
  timezone: string;
  today: string;
  rules: Reading<BookingRuleCard[]>;
  conflicts: Reading<RuleConflict[]>;
  locations: { id: string; name: string; active: boolean }[];
  sessions: {
    id: string; name: string; weekday: number; startsMinute: number; endsMinute: number;
    bookingMode: string; locationId: string | null;
  }[];
  /** Sessions anybody may book that no in-force rule covers. */
  uncovered: Reading<{ id: string; name: string }[]>;
  /** AC-13, counted: bookings carrying a rule, and bookings honestly carrying none. */
  decided: Reading<{ withRule: number; withoutRule: number }>;
  mayAuthor: boolean;
  mayBook: boolean;
  readFailures: string[];
};

export async function bookingRulesWorkspace(admin: any, ctx: WorkspaceContext): Promise<BookingRulesWorkspace> {
  const { data: ws } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const timezone = (ws?.timezone as string) || "UTC";
  const today = practiceToday(timezone);

  const [rules, locs, sess, appts] = await Promise.all([
    listBookingRules(admin, ctx),
    admin.from("practice_location").select("id, name, active").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_availability_template")
      .select("id, session_name, weekday, starts_minute, ends_minute, booking_mode, location_id, status")
      .eq("workspace_id", ctx.workspaceId).eq("status", "active").order("weekday").order("starts_minute"),
    admin.from("practice_appointment")
      .select("id, applied_rule_id, applied_rule_version").eq("workspace_id", ctx.workspaceId),
  ]);

  const sessions = ((sess.data ?? []) as any[]).map(s => ({
    id: s.id as string,
    name: (s.session_name as string | null) ?? `Session on day ${s.weekday}`,
    weekday: s.weekday as number,
    startsMinute: s.starts_minute as number,
    endsMinute: s.ends_minute as number,
    bookingMode: (s.booking_mode as string) ?? "none",
    locationId: (s.location_id as string | null) ?? null,
  }));

  const conflicts: Reading<RuleConflict[]> = rules.state === "ok"
    ? {
      state: "ok",
      value: (() => {
        const byId = new Map(rules.value.map(r => [r.id, r]));
        const seen = new Set<string>();
        const out: RuleConflict[] = [];
        for (const r of rules.value)
          for (const otherId of r.conflictsWith) {
            const key = [r.id, otherId].sort().join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            const o = byId.get(otherId);
            out.push({
              a: { id: r.id, name: r.name }, b: { id: otherId, name: o?.name ?? null },
              specificity: r.specificity, priority: r.priority, rung: r.rung,
              resolution: "Give one of them a higher priority, narrow one of their scopes, or pause one.",
            });
          }
        return out;
      })(),
    }
    : { state: "unreadable", reason: rules.reason };

  const uncovered: Reading<{ id: string; name: string }[]> = rules.state !== "ok"
    ? { state: "unreadable", reason: rules.reason }
    : sess.error
      ? { state: "unreadable", reason: `your sessions could not be read: ${sess.error.message}` }
      : {
        state: "ok",
        value: sessions.filter(s => s.bookingMode !== "none").filter(s => !rules.value.some(r =>
          r.status === "active"
          && (r.sessionTemplateId === null || r.sessionTemplateId === s.id)
          && (r.locationId === null || r.locationId === s.locationId))).map(s => ({ id: s.id, name: s.name })),
      };

  // ⚠ TWO FIGURES, NOT ONE WITH A GAP. "Carries a rule" and "honestly carries none" are both true
  // statements about a diary, and the second is what every appointment made before Phase 3 is.
  const decided: Reading<{ withRule: number; withoutRule: number }> = appts.error
    ? { state: "unreadable", reason: `your appointments could not be read: ${appts.error.message}` }
    : {
      state: "ok",
      value: {
        withRule: ((appts.data ?? []) as any[]).filter(a => a.applied_rule_id !== null).length,
        withoutRule: ((appts.data ?? []) as any[]).filter(a => a.applied_rule_id === null).length,
      },
    };

  return {
    timezone, today,
    rules, conflicts,
    locations: ((locs.data ?? []) as any[]).map(l => ({ id: l.id as string, name: l.name as string, active: l.active === true })),
    sessions,
    uncovered, decided,
    mayAuthor: ctx.capabilities.includes("practice.settings.manage"),
    mayBook: ctx.capabilities.includes("appointment.manage"),
    readFailures: [rules, uncovered, decided]
      .filter(r => r.state === "unreadable").map(r => (r as { reason: string }).reason),
  };
}

/** Re-exported so a screen and the engine agree on the six channels without a second list. */
export { BOOKING_CHANNELS, scopeDimensions };
