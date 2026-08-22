import { platformFlag } from "@/lib/practice/provisioning";
import { audit } from "@/lib/practice/audit";
import { messagingStatus } from "@/lib/practice/messaging";
import { BOOKING_MODES_LIVE, SESSION_APPOINTMENT_TYPES } from "@/lib/practice/practice-session-constants";
import {
  PATIENT_ACCESS_STORES, PATIENT_BOOKING_FLAG, PATIENT_ACCESS_BUILD_BLOCKERS,
  PATIENT_ACCESS_BLOCKING_CODES, patientAccessBlocker, PATIENT_ACCESS_MODES, BOOKING_FALLBACK_EMAIL,
} from "@/lib/practice/patient-access-constants";
import {
  publishCheck, publishStateLabel, PUBLISH_CHECKS,
  PUBLISH_CHECKS_NOT_CHECKABLE, PUBLISH_CHECKS_DATABASE_OWNED, PUBLISH_MODES_ADMITTING,
  PUBLISH_STATE_CODES, PUBLISH_STATES_LIVE, PUBLISHABLE_CONSTRAINT,
} from "@/lib/practice/publish-constants";
import type { WorkspaceContext } from "@/lib/practice/access";
import { onBookingLinkCreated } from "./activation-hooks";
import { claimedHandlesForWorkspace, handleForWorkspace } from "@/lib/practice/identity-service";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 4 -- PATIENT BOOKING ACCESS. The engine half.
//
// ⚠ THIS FILE'S JOB IS TO KEEP A DOOR SHUT AND TO SAY WHY, IN A WAY THAT SURVIVES THE DOOR BEING BUILT.
//
// Everything patient-facing that is ever added to this product must ask patientAccessGate() first. It is
// deliberately ONE function rather than a condition each new route re-derives, because a guard that is
// re-implemented per route is a guard that is eventually implemented slightly wrong once.
//
// ---- FOUR RULES THIS FILE EXISTS TO ENFORCE -------------------------------------------------------
//
//   1. ⚠ A FAILED READ IS NEVER AN OPEN DOOR. Every read below is error-checked, and an unreadable
//      anything produces READ_FAILED -- a BLOCKER. The alternative is a database blip publishing
//      somebody's diary to the internet, which is the worst possible direction for that failure mode.
//
//   2. ⚠ THE GATE CAN NEVER SAY OPEN IN THIS BUILD, AND NOT BECAUSE IT IS HARD-CODED. `open` is derived
//      from the blockers exactly as it would be in a finished build, and INTAKE_NOT_BUILT is a blocker
//      that no amount of configuration removes. That way the gate is real code being exercised for real
//      -- a hard-coded `return false` would be a guard nobody had ever seen decide anything.
//
//   3. ⚠ MISSING IS NOT UNREADABLE. A table that does not exist answers PGRST205; a table that could not
//      be reached answers something else. Collapsing the two would report a network wobble as "Phase 4
//      is not built", or worse, the reverse.
//
//   4. ⚠ NOTHING HERE EVER RETURNS, LOGS OR RENDERS A CODE, A TOKEN OR A FULL IDENTIFIER. There is no
//      code to return, because nothing here issues one -- but the rule is written down because the
//      obvious way to make an undeliverable OTP "work" during development is to print it, and that is
//      how a development shortcut becomes a production credential leak.
//
// ---- WHAT IS NOT HERE, AND WHY ---------------------------------------------------------------------
//
// No handle resolution, no booking page, no intake, no confirmation, no patient session issue. All four
// need stores this build does not have (PATIENT_ACCESS_STORES names them and why), and this file does
// not write to a table it cannot see. It probes for them so the gate's answer is READ rather than
// remembered, and it stops there.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The three states the rest of this area uses. `ok` with an empty value is not `unreadable`. */
export type Reading<T> =
  | { state: "ok"; value: T }
  | { state: "unreadable"; reason: string };

/** The refusal shape every engine in this area returns. Same as booking-rules.ts's, deliberately. */
export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

// ── DELIVERY: CAN A CODE REACH A PATIENT AT ALL? ─────────────────────────────────────────────────────

export type DeliveryReadiness = {
  /** ⚠ THE ONE FIELD EVERYTHING ELSE TURNS ON. True only if some channel could carry a code today. */
  deliverable: boolean;
  channels: {
    kind: "sms" | "email";
    /** Does this DEPLOYMENT have a gateway? Read from the environment, not from any practice's row. */
    providerConfigured: boolean;
    provider: string | null;
    /** Has this PRACTICE switched it on? Null when asked without a workspace. */
    practiceEnabled: boolean | null;
    /** Both, which is the only combination that sends anything. */
    usable: boolean;
  }[];
  /** Named in the order a person can act on them. Empty only when something could actually send. */
  reasons: string[];
};

/**
 * Whether a one-time code could be delivered.
 *
 * ⚠ TWO INDEPENDENT FACTS, KEPT APART ON PURPOSE. "No gateway is configured for this deployment" and
 * "this practice has not switched sending on" are different problems with different owners, and a single
 * boolean would send a practitioner to look for a setting that would not have helped.
 *
 * `workspaceId` may be null -- the patient-facing surface has no workspace, and the deployment-level
 * half of the answer is enough to shut the door.
 */
export async function deliveryReadiness(
  admin: any, workspaceId: string | null,
): Promise<Reading<DeliveryReadiness>> {
  const env = messagingStatus();

  let rows: any[] | null = null;
  if (workspaceId) {
    const { data, error } = await admin.from("practice_message_channel")
      .select("kind, enabled").eq("workspace_id", workspaceId);
    // ⚠ channelSettings() discards this error and reads the absence as "not enabled". That is the right
    // failure direction for SENDING, and the wrong one for REPORTING: it would tell a practice its
    // channel is off when the truth is that nobody knows.
    if (error) return { state: "unreadable", reason: `this practice's message channels could not be read: ${error.message}` };
    if (data == null) return { state: "unreadable", reason: "this practice's message channels came back as neither rows nor an error" };
    rows = data as any[];
  }

  const channels = (["sms", "email"] as const).map(kind => {
    const providerConfigured = env[kind].configured;
    const practiceEnabled = rows === null ? null : !!rows.find(r => r.kind === kind)?.enabled;
    return {
      kind,
      providerConfigured,
      provider: env[kind].provider,
      practiceEnabled,
      // With no workspace the practice half is unknown, so `usable` cannot be claimed. It reduces to the
      // deployment question, which is the only one the patient-facing surface can ask.
      usable: providerConfigured && (practiceEnabled ?? false),
    };
  });

  const reasons: string[] = [];
  if (!channels.some(c => c.providerConfigured))
    reasons.push("This deployment has no SMS gateway and no mail provider configured, so nothing can send a code.");
  else if (workspaceId && !channels.some(c => c.usable))
    reasons.push("A provider is configured, but this practice has not switched any channel on.");

  const deliverable = workspaceId
    ? channels.some(c => c.usable)
    : channels.some(c => c.providerConfigured);

  return { state: "ok", value: { deliverable, channels, reasons } };
}

// ── STORE PRESENCE: WHAT PHASE 4 NEEDS AND DOES NOT HAVE ─────────────────────────────────────────────

export type StorePresence = { table: string; present: boolean; holds: string; whyItMatters: string };

/**
 * Probe, rather than remember, which of Phase 4's stores exist.
 *
 * ⚠ ONLY THE EXISTENCE QUESTION IS ASKED. No column is named and no row is interpreted, because this
 * build has never seen these tables and guessing their shape is how an engine ends up written against a
 * schema nobody wrote. When the migration lands, this answer changes on its own; the door still does not
 * open, because INTAKE_NOT_BUILT is a fact about the code.
 *
 * ⚠ PGRST205 ("could not find the table") IS ABSENCE. Anything else is a failed read, and the two are
 * returned as different states.
 */
export async function storePresence(admin: any): Promise<Reading<StorePresence[]>> {
  const out: StorePresence[] = [];
  for (const s of PATIENT_ACCESS_STORES) {
    const { error } = await admin.from(s.table).select("id").limit(1);
    if (error && error.code !== "PGRST205" && !/could not find the table/i.test(error.message ?? ""))
      return { state: "unreadable", reason: `${s.table} could not be probed: ${error.message}` };
    out.push({ table: s.table, present: !error, holds: s.holds, whyItMatters: s.whyItMatters });
  }
  return { state: "ok", value: out };
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────────────

export type GateBlocker = {
  code: string;
  severity: "blocker" | "warning";
  headline: string;
  detail: string;
  /** Populated only for READ_FAILED, where the underlying message is the useful part. */
  because: string | null;
};

export type PatientAccessGate = {
  /** ⚠ DERIVED, NOT DECLARED. False in this build because a build blocker is always among the blockers. */
  open: boolean;
  blockers: GateBlocker[];
  warnings: GateBlocker[];
  /**
   * ⚠ THE LIMIT AS A PAYLOAD FIELD, NOT AS PAGE TEXT. A screen that types "not available yet" into a
   * paragraph is a screen that keeps saying it after it stops being true.
   */
  buildBlockers: string[];
  delivery: DeliveryReadiness | null;
  stores: StorePresence[];
  /** Whether the launch flag is on. Off by default, because the flag has no row. */
  flagEnabled: boolean;
  flag: string;
  /** Null when the gate was asked without a workspace, which the patient-facing surface always is. */
  workspaceId: string | null;
  checkedAt: string;
};

const blockerFrom = (code: string, because: string | null = null): GateBlocker => {
  const b = patientAccessBlocker(code)!;
  return { code: b.code, severity: b.severity, headline: b.headline, detail: b.detail, because };
};

/**
 * ⚠ THE ONE QUESTION EVERY PATIENT-FACING PATH MUST ASK: may a patient reach this practice?
 *
 * Never throws and never returns a partial answer -- a gate that could fail to produce a verdict is a
 * gate a caller will eventually treat as permission. Every failure mode resolves to a BLOCKER.
 *
 * The order the blockers come back in is the order a person can act on them, and the delivery channel is
 * first because it is the only one nobody using this product can fix.
 */
export async function patientAccessGate(admin: any, args: {
  workspaceId?: string | null;
} = {}): Promise<PatientAccessGate> {
  const workspaceId = args.workspaceId ?? null;
  const found: GateBlocker[] = [];

  // 1. DELIVERY. First, because it outranks everything else: with nothing to send a code with, no other
  //    problem on this list is worth a practitioner's afternoon.
  const delivery = await deliveryReadiness(admin, workspaceId);
  let deliveryValue: DeliveryReadiness | null = null;
  if (delivery.state !== "ok") {
    found.push(blockerFrom("READ_FAILED", delivery.reason));
  } else {
    deliveryValue = delivery.value;
    if (!delivery.value.deliverable)
      found.push(blockerFrom("DELIVERY_CHANNEL_ABSENT", delivery.value.reasons[0] ?? null));
  }

  // 2. ⚠ THE BUILD BLOCKER USED TO BE PUSHED HERE, UNCONDITIONALLY, AND IT IS GONE BECAUSE IT STOPPED
  //    BEING TRUE -- not because it was inconvenient.
  //
  //    It read `found.push(blockerFrom("INTAKE_NOT_BUILT"))` and the comment said it was true regardless
  //    of what any read said. That was correct while there was no intake and no confirmation. Both exist
  //    now (patient-booking.ts), the stores landed with migration 254, and the patient_self channel has
  //    a door guarded by a verified patient session. PATIENT_ACCESS_BUILD_BLOCKERS is empty and this
  //    push is removed together with it, so the two cannot disagree.
  //
  //    ⚠ THE CONSEQUENCE, STATED PLAINLY: THIS GATE CAN NOW REPORT `open: true`. It could not before, by
  //    construction. What keeps it shut in this deployment is DELIVERY_CHANNEL_ABSENT -- no gateway, no
  //    mail provider, so no code can reach anybody -- and that is a configuration somebody can change.

  // 3. THE STORES.
  const stores = await storePresence(admin);
  let storeValues: StorePresence[] = [];
  if (stores.state !== "ok") {
    found.push(blockerFrom("READ_FAILED", stores.reason));
  } else {
    storeValues = stores.value;
    if (!stores.value.find(s => s.table === "practice_booking_access")?.present)
      found.push(blockerFrom("ACCESS_PROFILE_STORE_ABSENT"));
  }

  // 4. THE FLAG. platformFlag() is already loud-and-false on a failed read, and a flag nobody could read
  //    is a flag that is off -- which is the safe direction here and needs no special handling.
  const flagEnabled = await platformFlag(admin, PATIENT_BOOKING_FLAG);
  if (!flagEnabled) found.push(blockerFrom("FLAG_OFF"));

  // 5. THE PRACTICE'S OWN CONFIGURATION, only when there is a practice to ask about.
  if (workspaceId) {
    const { data: sessions, error: sErr } = await admin.from("practice_availability_template")
      .select("id, booking_mode, status").eq("workspace_id", workspaceId).eq("status", "active");
    if (sErr || sessions == null) {
      found.push(blockerFrom("READ_FAILED", sErr?.message ?? "your sessions came back as neither rows nor an error"));
    } else if (!((sessions ?? []) as any[]).some(s => !BOOKING_MODES_LIVE.includes(s.booking_mode))) {
      // ⚠ "PATIENT-BOOKABLE" IS THE COMPLEMENT OF THE MODES PHASE 1 CAN HONOUR, not a hard-coded pair.
      // Written the other way round, adding a fifth mode later would silently make it not count.
      found.push(blockerFrom("NO_BOOKABLE_SESSION"));
    }

    const { data: rules, error: rErr } = await admin.from("practice_booking_rule")
      .select("id, channel, status").eq("workspace_id", workspaceId).eq("channel", "patient_self");
    if (rErr || rules == null) {
      found.push(blockerFrom("READ_FAILED", rErr?.message ?? "your booking rules came back as neither rows nor an error"));
    } else if (((rules ?? []) as any[]).length === 0) {
      found.push(blockerFrom("NO_PATIENT_RULE"));
    }
  }

  const blockers = found.filter(b => PATIENT_ACCESS_BLOCKING_CODES.includes(b.code));
  const warnings = found.filter(b => !PATIENT_ACCESS_BLOCKING_CODES.includes(b.code));

  return {
    open: blockers.length === 0,
    blockers, warnings,
    buildBlockers: [...PATIENT_ACCESS_BUILD_BLOCKERS],
    delivery: deliveryValue,
    stores: storeValues,
    flagEnabled, flag: PATIENT_BOOKING_FLAG,
    workspaceId,
    checkedAt: new Date().toISOString(),
  };
}

// ── WHAT A PRACTITIONER SEES ─────────────────────────────────────────────────────────────────────────

export type PatientAccessReadiness = {
  gate: PatientAccessGate;
  /**
   * ⚠ COUNTS WITH DENOMINATORS, EACH THE LENGTH OF A LIST SOMEBODY CAN OPEN. `null` where the list could
   * not be read -- a failed read is not a nought, and a zero printed next to "sessions you have opened
   * to patients" is a sentence about the practice rather than about the database.
   */
  sessionsOpenedToPatients: number | null;
  sessionsTotal: number | null;
  /** The ids behind the first figure, so it is checkable rather than assertable. */
  sessionsOpenedToPatientsIds: string[];
  rulesNamingPatientSelf: number | null;
  rulesTotal: number | null;
  locationsActive: number | null;
  locationsTotal: number | null;
  /** True when any figure above is null. The screen must say so rather than print a plausible number. */
  incomplete: boolean;
};

/**
 * The practitioner-side read: what is already configured for a patient-facing surface that does not
 * exist yet.
 *
 * ⚠ THE FIGURES ARE WORTH HAVING PRECISELY BECAUSE THE DOOR IS SHUT. A practitioner who has already
 * marked three sessions `link_only` believes those sessions are reachable. They are not, and nothing has
 * ever told them so.
 */
export async function patientAccessReadiness(
  admin: any, ctx: WorkspaceContext,
): Promise<PatientAccessReadiness> {
  const gate = await patientAccessGate(admin, { workspaceId: ctx.workspaceId });

  const [sessions, rules, locations] = await Promise.all([
    admin.from("practice_availability_template")
      .select("id, booking_mode").eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    admin.from("practice_booking_rule").select("id, channel").eq("workspace_id", ctx.workspaceId),
    admin.from("practice_location").select("id, active").eq("workspace_id", ctx.workspaceId),
  ]);

  const sessionRows = sessions.error ? null : ((sessions.data ?? []) as any[]);
  const ruleRows = rules.error ? null : ((rules.data ?? []) as any[]);
  const locationRows = locations.error ? null : ((locations.data ?? []) as any[]);

  const opened = sessionRows === null
    ? null
    : sessionRows.filter(s => !BOOKING_MODES_LIVE.includes(s.booking_mode));

  return {
    gate,
    sessionsOpenedToPatients: opened === null ? null : opened.length,
    sessionsTotal: sessionRows === null ? null : sessionRows.length,
    sessionsOpenedToPatientsIds: (opened ?? []).map(s => s.id as string),
    rulesNamingPatientSelf: ruleRows === null ? null : ruleRows.filter(r => r.channel === "patient_self").length,
    rulesTotal: ruleRows === null ? null : ruleRows.length,
    locationsActive: locationRows === null ? null : locationRows.filter(l => l.active).length,
    locationsTotal: locationRows === null ? null : locationRows.length,
    incomplete: sessionRows === null || ruleRows === null || locationRows === null,
  };
}

// ── WHAT A PATIENT SEES ──────────────────────────────────────────────────────────────────────────────

export type PatientBookingSurface = {
  open: false;
  /**
   * ⚠ ONE HEADLINE, WHICH IS ALWAYS THE DELIVERY CHANNEL WHEN THAT IS THE PROBLEM. A patient who arrives
   * at a booking link deserves to know they are not going to be able to book, in the first sentence.
   */
  headline: string;
  reasons: { headline: string; detail: string }[];
  /** What a patient should do instead. There is exactly one honest answer today. */
  whatToDoInstead: string;
  buildBlockers: string[];
  checkedAt: string;
};

/**
 * The payload the patient-facing page renders.
 *
 * ⚠ IT IS A PLAIN OBJECT AND NOTHING ON IT IS A FUNCTION. A payload carrying a method crosses the
 * server/client boundary as `tsc`-clean, API-clean, harness-clean and dead on the page -- which is
 * exactly how the Follow-ups board was killed this week. Every field here is a string, a boolean or an
 * array of those.
 *
 * ⚠ NO WORKSPACE, NO PRACTICE NAME, NO PRACTITIONER NAME, NO HANDLE. This page is reached by strangers.
 * Naming a practice on it would confirm to anybody who guessed a URL that the practice exists.
 */
export async function patientBookingSurface(admin: any): Promise<PatientBookingSurface> {
  const gate = await patientAccessGate(admin, { workspaceId: null });

  // Deployment-level blockers only. Nothing here is per-practice, because there is no practice in scope.
  const shown = gate.blockers.filter(b => b.code !== "FLAG_OFF");

  return {
    open: false,
    headline: shown.some(b => b.code === "DELIVERY_CHANNEL_ABSENT")
      ? "You cannot book here yet, because there is no way to send you a confirmation code."
      : "You cannot book here yet.",
    reasons: shown.map(b => ({ headline: b.headline, detail: b.detail })),
    whatToDoInstead:
      "Contact the practice the way you normally would. Competen Practice does not text or email patients -- it has no way to -- so nobody will follow this up automatically.",
    buildBlockers: gate.buildBlockers,
    checkedAt: gate.checkedAt,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-V5-007 PHASE 6 -- PUBLISH READINESS (s10.2), AND THE PROFILE IT PUBLISHES
//
// ⚠ THIS IS A CHECKLIST, SO A CHECK NOBODY CAN PERFORM SAYS "NOT CHECKED". Never a green tick, never a
// silent pass. publish-constants.ts carries the reasoning; the consequence in code is that every row has
// THREE states and the two rows s10.2 asks for that no column can answer are always `not_checked` with
// what it would take to answer them.
//
// ⚠ AND THE DATABASE OWNS THREE OF THEM. `practice_booking_access_publishable` refuses a published row
// without a handle, without the one-time code, or in a mode that admits nobody. This engine REPORTS the
// row so a practitioner sees the gap before trying, and when they try it reports the DATABASE'S refusal
// with the constraint named. It does not re-implement the rule: a rule written twice is a rule that will
// one day be written differently in the two places, and the copy that matters is the one nothing can
// bypass.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** The booking-access profile as this build reads it. Every field is JSON-safe. */
export type BookingAccessProfile = {
  id: string;
  handle: string | null;
  mode: string;
  publishState: string;
  otpRequired: boolean;
  otpChannel: string;
  guestBookingAllowed: boolean;
  existingPatientMatching: boolean;
  visibleLocationIds: string[];
  visibleAppointmentTypes: string[];
  brandDisplayName: string | null;
  instructions: string | null;
  /** The way through when the diary cannot help (migration 291). Either, both, or neither. */
  fallbackEmail: string | null;
  fallbackPhone: string | null;
  privacyNotice: string | null;
  consentText: string | null;
  consentRequired: boolean;
  publishedAt: string | null;
  pausedAt: string | null;
  /**
   * ⚠ MIGRATION 272, AND IT IS NOT otp_required.
   *
   * otp_required governs BOOKING and practice_booking_access_publishable still refuses to publish a page
   * without it. This governs whether a practice will accept an unverified REQUEST -- which becomes no
   * appointment, holds no time and is a message somebody has to answer. Two decisions, two columns.
   *
   * ⚠ NULL MEANS THE COLUMN IS NOT THERE YET, WHICH IS NOT A NO AND IS NOT A YES. A screen must draw the
   * absence rather than a false-looking switch nobody can move.
   */
  unverifiedRequestsAllowed: boolean | null;
  unverifiedRequestsAllowedAt: string | null;
};

const profileFrom = (row: any): BookingAccessProfile => ({
  id: row.id as string,
  handle: (row.handle as string | null) ?? null,
  mode: (row.mode as string) ?? "internal_only",
  publishState: (row.publish_state as string) ?? "draft",
  otpRequired: !!row.otp_required,
  otpChannel: (row.otp_channel as string) ?? "any",
  guestBookingAllowed: !!row.guest_booking_allowed,
  existingPatientMatching: !!row.existing_patient_matching,
  visibleLocationIds: ((row.visible_location_ids ?? []) as string[]).map(String),
  visibleAppointmentTypes: ((row.visible_appointment_types ?? []) as string[]).map(String),
  brandDisplayName: (row.brand_display_name as string | null) ?? null,
  instructions: (row.instructions as string | null) ?? null,
  fallbackEmail: (row.fallback_email as string | null) ?? null,
  fallbackPhone: (row.fallback_phone as string | null) ?? null,
  privacyNotice: (row.privacy_notice as string | null) ?? null,
  consentText: (row.consent_text as string | null) ?? null,
  consentRequired: !!row.consent_required,
  publishedAt: (row.published_at as string | null) ?? null,
  pausedAt: (row.paused_at as string | null) ?? null,
  // ⚠ `undefined` FROM THE ROW BECOMES `null` AND NOT `false`. The column is absent until migration 272
  // is applied, and a missing column read as "the practice said no" is a choice nobody made.
  unverifiedRequestsAllowed: row.unverified_requests_allowed === undefined
    ? null : row.unverified_requests_allowed === true,
  unverifiedRequestsAllowedAt: (row.unverified_requests_allowed_at as string | null) ?? null,
});

const PROFILE_COLUMNS =
  "id, handle, mode, publish_state, otp_required, otp_channel, guest_booking_allowed, "
  + "existing_patient_matching, visible_location_ids, visible_appointment_types, brand_display_name, "
  + "instructions, privacy_notice, consent_text, consent_required, published_at, paused_at, "
  + "fallback_email, fallback_phone";

/** Migration 272's two. Read separately so a practice with the migration unapplied still gets its page. */
const PROFILE_COLUMNS_272 =
  `${PROFILE_COLUMNS}, unverified_requests_allowed, unverified_requests_allowed_at`;

/** PostgREST's answer when a column is not there yet. Code and sentence, because both have been seen. */
const isUndefinedColumn = (e: { code?: string | null; message?: string | null } | null | undefined) =>
  !!e && (String(e.code) === "42703" || /column .* does not exist/i.test(String(e.message ?? "")));

/**
 * The practice's booking-access profile, or the honest absence of one.
 *
 * ⚠ THREE ANSWERS, NOT TWO. `ok` with a null value is "this practice has not configured a booking page",
 * which is a real state every practice starts in; `unreadable` is "nobody knows". A screen that drew the
 * second as the first would tell a practice its page was unconfigured when the truth is that the query
 * failed -- and the fix it would then offer is to configure a page that may already exist.
 */
export async function bookingAccessProfile(
  admin: any, workspaceId: string,
): Promise<Reading<BookingAccessProfile | null>> {
  const { data, error } = await admin.from("practice_booking_access")
    .select(PROFILE_COLUMNS_272).eq("workspace_id", workspaceId).maybeSingle();
  // ⚠ A COLUMN THAT IS NOT THERE YET IS NOT AN UNREADABLE PAGE. Migration 272 adds two, and a practice
  // that has not applied it must still be able to see and configure everything it had before -- so the
  // read falls back to the older column list rather than reporting the whole profile unreadable.
  // profileFrom() then reads the two as `null`, which is neither a yes nor a no.
  if (isUndefinedColumn(error)) {
    const older = await admin.from("practice_booking_access")
      .select(PROFILE_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
    if (older.error) return { state: "unreadable", reason: `your booking page could not be read: ${older.error.message}` };
    return { state: "ok", value: older.data ? profileFrom(older.data) : null };
  }
  if (error) return { state: "unreadable", reason: `your booking page could not be read: ${error.message}` };
  return { state: "ok", value: data ? profileFrom(data) : null };
}

// ── ONE ROW OF THE CHECKLIST ─────────────────────────────────────────────────────────────────────────

export type PublishCheckState = "pass" | "fail" | "not_checked";

export type PublishCheckResult = {
  code: string;
  requirement: string;
  severity: "blocker" | "warning" | "advisory";
  authority: "engine" | "database" | "build" | "absent";
  /** ⚠ THREE STATES. `not_checked` is never drawn as a pass and never omitted. */
  state: PublishCheckState;
  detail: string;
  /** The specific reason this row is failing or unanswerable, where there is one. */
  because: string | null;
  /**
   * The figures behind the row, each the length of a list. Null where nothing was counted -- which is
   * every `not_checked` row, and is what stops a nought being printed next to a question nobody asked.
   */
  found: number | null;
  of: number | null;
  /** The ids the figure counted, so the row is checkable rather than assertable. Capped for the payload. */
  ids: string[];
  wouldNeed: string | null;
};

export type PublishReadiness = {
  checks: PublishCheckResult[];
  /**
   * ⚠ FOUR VERDICTS, AND `cannot_say` IS A REAL ONE.
   *
   *   not_ready    at least one blocker failed.
   *   cannot_say   nothing failed, and at least one BLOCKER could not be checked. Never "ready".
   *   ready_with_warnings  every blocker passed; a warning or advisory did not.
   *   ready        every blocker passed and nothing else is outstanding.
   *
   * A build in which two of s10.2's rows can never be checked can never honestly report `ready` for a
   * page those rows are about -- but neither of them is a blocker, so they land in the warning tally
   * rather than making the verdict permanently `cannot_say`. The distinction is the point: a check that
   * cannot be performed still has a severity, and the severity decides how loudly it counts.
   */
  verdict: "ready" | "ready_with_warnings" | "not_ready" | "cannot_say";
  /** The rows behind the verdict, as codes, so a screen never re-derives the arithmetic. */
  blockersFailing: string[];
  blockersNotChecked: string[];
  warningsFailing: string[];
  notChecked: string[];
  profile: BookingAccessProfile | null;
  profileUnreadable: string | null;
  publishStateLabel: string;
  checkedAt: string;
};

/** How many ids are worth carrying to a screen. Enough to name, few enough not to be a second query. */
const EVIDENCE_LIMIT = 25;

const checkRow = (
  code: string,
  state: PublishCheckState,
  extra: { because?: string | null; found?: number | null; of?: number | null; ids?: string[] } = {},
): PublishCheckResult => {
  const d = publishCheck(code)!;
  return {
    code: d.code, requirement: d.requirement, severity: d.severity, authority: d.authority,
    state, detail: d.detail,
    because: extra.because ?? null,
    found: extra.found ?? null, of: extra.of ?? null,
    ids: (extra.ids ?? []).slice(0, EVIDENCE_LIMIT),
    wouldNeed: d.wouldNeed,
  };
};

/**
 * s10.2's publish validation, run against this practice.
 *
 * ⚠ A FAILED READ IS `not_checked`, NEVER A PASS AND NEVER A FAIL. A pass would publish a page over a
 * question nobody answered; a fail would send a practitioner to fix something that may be perfectly
 * fine. Both are wrong, and the third state is what stops having to choose between them.
 */
export async function publishReadiness(
  admin: any, ctx: WorkspaceContext,
): Promise<PublishReadiness> {
  const checks: PublishCheckResult[] = [];

  const profileReading = await bookingAccessProfile(admin, ctx.workspaceId);
  const profile = profileReading.state === "ok" ? profileReading.value : null;
  const profileUnreadable = profileReading.state === "unreadable" ? profileReading.reason : null;

  // ── 1. LOCATIONS ────────────────────────────────────────────────────────────────────────────────
  const locs = await admin.from("practice_location")
    .select("id, name, active").eq("workspace_id", ctx.workspaceId);
  if (locs.error || locs.data == null) {
    checks.push(checkRow("LOCATION_ACTIVE", "not_checked", { because: `your locations could not be read: ${locs.error?.message ?? "neither rows nor an error"}` }));
  } else {
    const active = (locs.data as any[]).filter(l => l.active);
    checks.push(checkRow("LOCATION_ACTIVE", active.length > 0 ? "pass" : "fail", {
      found: active.length, of: (locs.data as any[]).length, ids: active.map(l => l.id as string),
    }));
  }

  // ── 2 & 3. SESSIONS AND THE TYPES THEY OFFER ────────────────────────────────────────────────────
  const sess = await admin.from("practice_availability_template")
    .select("id, session_name, booking_mode").eq("workspace_id", ctx.workspaceId).eq("status", "active");
  let bookableIds: string[] = [];
  if (sess.error || sess.data == null) {
    const because = `your sessions could not be read: ${sess.error?.message ?? "neither rows nor an error"}`;
    checks.push(checkRow("SESSION_BOOKABLE", "not_checked", { because }));
    checks.push(checkRow("APPOINTMENT_TYPE_LINKED", "not_checked", { because }));
  } else {
    // ⚠ "PATIENT-BOOKABLE" IS THE COMPLEMENT OF THE MODES PHASE 1 CAN HONOUR, exactly as the gate
    // derives it. Written the other way round, a fifth mode added later would silently stop counting.
    const bookable = (sess.data as any[]).filter(s => !BOOKING_MODES_LIVE.includes(s.booking_mode));
    bookableIds = bookable.map(s => s.id as string);
    checks.push(checkRow("SESSION_BOOKABLE", bookable.length > 0 ? "pass" : "fail", {
      found: bookable.length, of: (sess.data as any[]).length, ids: bookableIds,
    }));

    if (bookable.length === 0) {
      // Nothing is bookable, so there is no session whose types could be checked. Reported as a
      // consequence rather than as a second failure a practitioner would go chasing separately.
      checks.push(checkRow("APPOINTMENT_TYPE_LINKED", "not_checked", {
        because: "no session is open to patients yet, so there is no session whose appointment types could be checked.",
      }));
    } else {
      const links = await admin.from("practice_session_appointment_type")
        .select("template_id, appointment_type").eq("workspace_id", ctx.workspaceId)
        .in("template_id", bookableIds);
      if (links.error || links.data == null) {
        checks.push(checkRow("APPOINTMENT_TYPE_LINKED", "not_checked", { because: `the appointment types your sessions offer could not be read: ${links.error?.message ?? "neither rows nor an error"}` }));
      } else {
        const covered = new Set((links.data as any[]).map(l => l.template_id as string));
        const withTypes = bookableIds.filter(id => covered.has(id));
        checks.push(checkRow("APPOINTMENT_TYPE_LINKED", withTypes.length > 0 ? "pass" : "fail", {
          found: withTypes.length, of: bookableIds.length, ids: withTypes,
          because: withTypes.length === 0
            ? "every session you have opened to patients offers zero appointment types, and s4.3 says zero means not patient-bookable."
            : null,
        }));
      }
    }
  }

  // ── 4 & 8. RULE COVER AND RULE CONFLICTS ────────────────────────────────────────────────────────
  //
  // ⚠ THE SAME COMPUTATION LAYER 3 ALREADY DRAWS, not a second opinion. Imported dynamically so the
  // patient-facing page -- which imports this module for the gate -- does not pull the whole rules
  // engine into its own graph. follow-ups.ts takes the same measure for the same kind of reason.
  const { bookingRulesWorkspace } = await import("@/lib/practice/booking-rules");
  const rw = await bookingRulesWorkspace(admin, ctx);
  if (rw.uncovered.state !== "ok") {
    checks.push(checkRow("EFFECTIVE_BOOKING_CONSTRAINTS_SATISFIED", "not_checked", { because: rw.uncovered.reason }));
  } else {
    const uncovered = rw.uncovered.value;
    // ⚠⚠ COVERAGE IS NECESSARY AND NOT SUFFICIENT -- CPR-BOOK-READY-001 s3.
    //
    // This check used to pass the moment every session had a rule ROW pointing at it. That is how a
    // practice reached a green readiness screen while its only rule set no horizon, no capacity and a
    // visibility of internal. s3: do not pass because a rule row merely exists; resolve values through
    // the same authoritative configuration path production booking uses.
    //
    // Coverage still runs -- an uncovered session has nothing to resolve -- and then the EFFECTIVE
    // values are resolved through resolveBookingRule, the function bookableTimes itself calls, and
    // judged by publicBookingReadiness, the predicate the engine itself enforces. One semantics, two
    // callers, so the screen and the slot machine cannot drift.
    //
    // ⚠ RESOLVED PER LOCATION WITH NO APPOINTMENT TYPE. A type-specific rule is not evaluated here:
    // this check asks whether the SESSION has resolvable baseline constraints, and the engine still
    // applies the per-type rule when a slot is actually offered. Saying so because a reader would
    // otherwise assume this covers every rule that could apply.
    const { resolveBookingRule } = await import("@/lib/practice/availability-config");
    const { publicBookingReadiness } = await import("@/lib/practice/patient-booking");
    const unresolved: { name: string; why: string }[] = [];
    for (const sess of rw.sessions) {
      const rule = await resolveBookingRule(admin, ctx.workspaceId, sess.locationId ?? null, "");
      // s2's fourth invariant. The session carries capacity; the rule does not.
      //
      // ⚠ NO `as any` AND NO ?? CHAIN. Both were here, and both were how this stayed broken: the
      // session object genuinely had no capacity field, the cast silenced the compiler, the chain
      // silenced the undefined, and the invariant quietly passed every session ever put through it.
      // Typed straight off the object, a field that goes missing is a build error instead.
      const sessionCapacity = sess.capacity;
      // A read failure is NOT a missing constraint. The coverage arm above already reports an
      // unreadable rule table, and recycling it here would turn a database wobble into a
      // configuration verdict against the practice.
      if (rule.readFailed) continue;
      const verdict = publicBookingReadiness({ ...rule, sessionCapacity });
      if (!verdict.ready) unresolved.push({ name: sess.name, why: verdict.reason });
    }
    const REASON_WORDS: Record<string, string> = {
      horizon_missing: "has no booking horizon set, so how far ahead it may be booked is unresolved",
      horizon_invalid: "has a booking horizon that is not a positive whole number of days",
      visibility_not_public: "is set to internal, so it is not offered to patients",
      visibility_unknown: "has no visibility set, so which channels may book it is unresolved",
    };
    const constraintsFail = uncovered.length > 0 || unresolved.length > 0;
    checks.push(checkRow("EFFECTIVE_BOOKING_CONSTRAINTS_SATISFIED", constraintsFail ? "fail" : "pass", {
      found: uncovered.length + unresolved.length, of: bookableIds.length || null,
      ids: uncovered.map(u => u.id),
      because: constraintsFail
        ? [
            uncovered.length > 0
              ? `${uncovered.map(u => u.name).join(", ")} ${uncovered.length === 1 ? "is" : "are"} covered by no rule in force.`
              : null,
            ...unresolved.map(u => `${u.name} ${REASON_WORDS[u.why] ?? u.why}.`),
          ].filter(Boolean).join(" ")
        : null,
    }));
  }
  if (rw.conflicts.state !== "ok") {
    checks.push(checkRow("RULE_CONFLICTS_RESOLVED", "not_checked", { because: rw.conflicts.reason }));
  } else {
    const c = rw.conflicts.value;
    checks.push(checkRow("RULE_CONFLICTS_RESOLVED", c.length === 0 ? "pass" : "fail", {
      found: c.length, of: null, ids: c.map(x => x.a.id),
      because: c.length > 0
        ? c.map(x => `"${x.a.name ?? "unnamed"}" and "${x.b.name ?? "unnamed"}" tie`).join("; ")
        : null,
    }));
  }

  // ── 5. AN ACCESS MODE HAS BEEN CHOSEN ───────────────────────────────────────────────────────────
  if (profileUnreadable) {
    checks.push(checkRow("ACCESS_MODE_SELECTED", "not_checked", { because: profileUnreadable }));
  } else {
    checks.push(checkRow("ACCESS_MODE_SELECTED", profile ? "pass" : "fail", {
      because: profile ? null : "this practice has no booking-access profile, so no mode has been chosen. That is not the same as having chosen internal-only.",
    }));
  }

  // ── 6. THE REGISTRATION FORM CAN ACTUALLY BE FILLED IN ──────────────────────────────────────────
  const tpl = await admin.from("practice_registration_template")
    .select("id, name, status, is_default").eq("workspace_id", ctx.workspaceId).eq("status", "published");
  if (tpl.error || tpl.data == null) {
    checks.push(checkRow("REGISTRATION_FIELDS_VALID", "not_checked", { because: `your registration templates could not be read: ${tpl.error?.message ?? "neither rows nor an error"}` }));
  } else if ((tpl.data as any[]).length === 0) {
    checks.push(checkRow("REGISTRATION_FIELDS_VALID", "fail", {
      found: 0, of: 0,
      because: "no registration template is published, so a patient booking would have no form to complete.",
    }));
  } else {
    const templateIds = (tpl.data as any[]).map(t => t.id as string);
    const fields = await admin.from("practice_registration_field")
      .select("id, template_id, field_key, label, field_type, required, visible, options")
      .eq("workspace_id", ctx.workspaceId).in("template_id", templateIds);
    if (fields.error || fields.data == null) {
      checks.push(checkRow("REGISTRATION_FIELDS_VALID", "not_checked", { because: `your registration fields could not be read: ${fields.error?.message ?? "neither rows nor an error"}` }));
    } else {
      const rows = fields.data as any[];
      // ⚠ TWO WAYS A REQUIRED FIELD IS UNANSWERABLE, and both are real forms somebody could build.
      const broken = rows.filter(f => f.required && (
        !f.visible
        || (["select", "multi_select"].includes(f.field_type) && ((f.options ?? []) as any[]).length === 0)
      ));
      checks.push(checkRow("REGISTRATION_FIELDS_VALID", broken.length === 0 ? "pass" : "fail", {
        found: rows.length - broken.length, of: rows.length, ids: broken.map(f => f.id as string),
        because: broken.length > 0
          ? `${broken.map(f => f.label ?? f.field_key).join(", ")} ${broken.length === 1 ? "is" : "are"} required and cannot be answered -- hidden, or a choice with no options.`
          : null,
      }));
    }
  }

  // ── 7. RESERVED CAPACITY WITHIN TOTAL (s7.4) ────────────────────────────────────────────────────
  const caps = await admin.from("practice_booking_rule")
    .select("id, name, status, capacity_total, capacity_new, capacity_follow_up, capacity_urgent_reserve")
    .eq("workspace_id", ctx.workspaceId).eq("status", "active");
  if (caps.error || caps.data == null) {
    checks.push(checkRow("RESERVED_WITHIN_CAPACITY", "not_checked", { because: `your booking rules could not be read: ${caps.error?.message ?? "neither rows nor an error"}` }));
  } else {
    const rules = caps.data as any[];
    // The same sum setBookingRuleCard validates on write. Recomputed rather than trusted, because a row
    // can be written straight into the table without passing through that path.
    const over = rules.filter(r => r.capacity_total != null
      && ((r.capacity_new ?? 0) + (r.capacity_follow_up ?? 0) + (r.capacity_urgent_reserve ?? 0)) > r.capacity_total);
    checks.push(checkRow("RESERVED_WITHIN_CAPACITY", over.length === 0 ? "pass" : "fail", {
      found: rules.length - over.length, of: rules.length, ids: over.map(r => r.id as string),
      because: over.length > 0
        ? `${over.map(r => `"${r.name ?? "unnamed"}"`).join(", ")} reserve${over.length === 1 ? "s" : ""} more places than the rule's own total.`
        : null,
    }));
  }

  // ── 9. A CHANNEL THAT COULD CARRY A CODE ────────────────────────────────────────────────────────
  const delivery = await deliveryReadiness(admin, ctx.workspaceId);
  if (delivery.state !== "ok") {
    checks.push(checkRow("NOTIFICATION_CHANNEL", "not_checked", { because: delivery.reason }));
  } else {
    const usable = delivery.value.channels.filter(c => c.usable);
    checks.push(checkRow("NOTIFICATION_CHANNEL", delivery.value.deliverable ? "pass" : "fail", {
      found: usable.length, of: delivery.value.channels.length,
      because: delivery.value.reasons[0] ?? null,
    }));
  }

  // ── 10 & 11. THE TWO s10.2 ROWS NOTHING IN THIS SCHEMA CAN ANSWER ───────────────────────────────
  //
  // ⚠ ALWAYS `not_checked`, NEVER OMITTED AND NEVER A TICK. A checklist that quietly dropped the rows it
  // could not perform would report a shorter, cleaner, wronger list -- and the practitioner would have
  // no way of knowing which questions had gone unasked.
  for (const code of PUBLISH_CHECKS_NOT_CHECKABLE)
    checks.push(checkRow(code, "not_checked", { because: publishCheck(code)!.detail }));

  // ── 12-14. THE THREE THE DATABASE OWNS ──────────────────────────────────────────────────────────
  if (profileUnreadable || !profile) {
    const because = profileUnreadable
      ?? "there is no booking-access profile yet, so there is no row for the database to judge.";
    for (const code of PUBLISH_CHECKS_DATABASE_OWNED)
      checks.push(checkRow(code, "not_checked", { because }));
  } else {
    // ⚠ THIS READ IS THE DIFFERENCE BETWEEN A TRUE SENTENCE AND A FALSE ONE, and it was reported as a
    // defect by somebody looking at their own screen: Practice Setup showed "Your booking address .
    // @elisham1" in its header while this check, two clicks away, said no handle had been claimed. Both
    // read a column called `handle`; they were different columns. The identity's is the claim, the
    // page's is the FK that carries it to patients, and only the second was ever null.
    let handleBecause: string | null = null;
    if (!profile.handle) {
      const claimed = await claimedHandlesForWorkspace(admin, ctx.workspaceId);
      handleBecause = claimed.length === 0
        ? "no handle has been claimed, so there is no address a patient could be given."
        : claimed.length === 1
          ? `@${claimed[0]} is claimed, but this booking page does not carry it yet.`
          : "more than one practitioner here has claimed a handle, and which one this page answers on is a choice nobody has made.";
    }
    checks.push(checkRow("HANDLE_CLAIMED", profile.handle ? "pass" : "fail", { because: handleBecause }));
    checks.push(checkRow("OTP_REQUIRED", profile.otpRequired ? "pass" : "fail", {
      because: profile.otpRequired ? null : "the one-time code is switched off on this profile.",
    }));
    checks.push(checkRow("MODE_ADMITS_PATIENTS", PUBLISH_MODES_ADMITTING.includes(profile.mode) ? "pass" : "fail", {
      because: PUBLISH_MODES_ADMITTING.includes(profile.mode)
        ? null : `the mode is ${profile.mode.replace(/_/g, " ")}, which admits no patient.`,
    }));
  }

  // ── 15. THE BUILD ───────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ THIS WAS AN UNCONDITIONAL `fail` AND IS NOW AN UNCONDITIONAL `pass`, because the thing it asserts
  // changed. The intake and the confirmation exist (patient-booking.ts), so a published page no longer
  // has nothing behind its first screen. Both versions are honest about their own day; what would not
  // have been honest is leaving it failing so that a familiar number stayed familiar.
  //
  // It stays on the checklist rather than being deleted: it is one of s10.2's questions, and a check
  // that has started passing is worth showing as passing.
  checks.push(checkRow("INTAKE_BUILT", "pass", {
    because: null,
  }));

  // ⚠ THE CONSTANTS DECLARE THE ORDER, AND THE ENGINE OBEYS IT. This function builds the rows in the
  // order the READS are cheapest to batch -- rule cover and rule conflicts come out of one call, so they
  // are pushed together -- and PUBLISH_CHECKS declares the order somebody can ACT on them. Those are
  // different orders for good reasons, and letting the assembly order leak out made the screen's list
  // disagree with the list the constants document. Sorted once, here, so there is one answer.
  const declaredOrder = new Map(PUBLISH_CHECKS.map((c, i) => [c.code, i]));
  checks.sort((a, b) => (declaredOrder.get(a.code) ?? 0) - (declaredOrder.get(b.code) ?? 0));

  const blockersFailing = checks.filter(c => c.severity === "blocker" && c.state === "fail").map(c => c.code);
  const blockersNotChecked = checks.filter(c => c.severity === "blocker" && c.state === "not_checked").map(c => c.code);
  const warningsFailing = checks.filter(c => c.severity !== "blocker" && c.state === "fail").map(c => c.code);
  const notChecked = checks.filter(c => c.state === "not_checked").map(c => c.code);

  const verdict: PublishReadiness["verdict"] =
    blockersFailing.length > 0 ? "not_ready"
      : blockersNotChecked.length > 0 ? "cannot_say"
        : warningsFailing.length > 0 || notChecked.length > 0 ? "ready_with_warnings"
          : "ready";

  return {
    checks, verdict, blockersFailing, blockersNotChecked, warningsFailing, notChecked,
    profile, profileUnreadable,
    publishStateLabel: publishStateLabel(profile?.publishState ?? null),
    checkedAt: new Date().toISOString(),
  };
}

// ── WRITING THE PROFILE ──────────────────────────────────────────────────────────────────────────────

export type BookingAccessSave = {
  mode?: string;
  otpRequired?: boolean;
  otpChannel?: string;
  guestBookingAllowed?: boolean;
  existingPatientMatching?: boolean;
  visibleLocationIds?: string[];
  visibleAppointmentTypes?: string[];
  brandDisplayName?: string | null;
  instructions?: string | null;
  fallbackEmail?: string | null;
  fallbackPhone?: string | null;
  privacyNotice?: string | null;
  consentText?: string | null;
  consentRequired?: boolean;
  /**
   * ⚠ MIGRATION 272. TURNING THIS ON CHANGES WHO MAY WRITE A ROW AT THIS PRACTICE.
   *
   * With it on, somebody who has proved nothing at all may leave a booking request. It books nothing and
   * holds no time, and it is still a stranger's name, telephone number and stated reason for a visit
   * arriving in this practice's queue. It is off until somebody sets it, and the moment they do is
   * recorded beside it.
   */
  unverifiedRequestsAllowed?: boolean;
};

/**
 * Create or amend the booking-access profile.
 *
 * ⚠ EVERY LOCATION ID IS VERIFIED AGAINST THIS WORKSPACE BEFORE IT IS WRITTEN. migration 254 says why in
 * its own words: Postgres will not point an array at a table, so `visible_location_ids` is a uuid[] with
 * NO foreign key, and nothing in the database stops another practice's location id being written into
 * it. That is the same cross-tenant hole checkPlacement's comment describes for
 * practice_appointment.location_id, and here the array is what a PATIENT-FACING page would render.
 *
 * ⚠ IT NEVER TOUCHES publish_state, AND IT NEVER MOVES A HANDLE. Publishing is a separate, deliberate
 * act (setPublishState) and the handle is claimed in Practice Setup, atomically at the index. Letting a
 * settings save move either of them would make configuring a page an act of publishing one, which is
 * the exact collapse migration 254 kept `mode` and `publish_state` apart to avoid.
 *
 * THE ONE EXCEPTION, AND WHY IT IS NOT THAT: creating a page for the first time seeds `handle` from the
 * practice's own already-claimed identity. That is not a settings save moving a handle -- there is no
 * handle to move, publish_state is still `draft` and `mode` is untouched, so nothing about it publishes
 * anything. It exists because claimHandle performs the same write from the other side, onto a page it
 * finds; without this the two orders of the same two acts would disagree, and the practitioner who
 * claimed their handle before building their page would be the one left with the null. The UPDATE
 * branch above still never touches the column, so the rule holds everywhere it was written for.
 */
export async function saveBookingAccess(admin: any, ctx: WorkspaceContext, args: BookingAccessSave & {
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; created: boolean }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  if (args.mode !== undefined && !PATIENT_ACCESS_MODES.some(m => m.code === args.mode))
    return {
      ok: false, status: 400, code: "UNKNOWN_MODE",
      message: `a mode must be one of: ${PATIENT_ACCESS_MODES.map(m => m.code).join(", ")}`,
    };
  if (args.otpChannel !== undefined && !["sms", "email", "any"].includes(args.otpChannel))
    return { ok: false, status: 400, code: "UNKNOWN_CHANNEL", message: "a code channel must be sms, email or any" };

  // ⚠ THE CROSS-TENANT CHECK. Read the ids that ARE this practice's, and refuse on the difference --
  // rather than asking "does this id exist", which a foreign one also answers yes to.
  if (args.visibleLocationIds !== undefined) {
    const wanted = [...new Set(args.visibleLocationIds.map(String))];
    if (wanted.length > 0) {
      const { data: mine, error } = await admin.from("practice_location")
        .select("id").eq("workspace_id", ctx.workspaceId).in("id", wanted);
      // A failed read REFUSES. Writing the array on a query that failed is how a foreign id gets in.
      if (error || mine == null)
        return { ok: false, status: 503, code: "READ_FAILED", message: `your locations could not be checked, so nothing was written: ${error?.message ?? "neither rows nor an error"}` };
      const ours = new Set((mine as any[]).map(l => l.id as string));
      const foreign = wanted.filter(id => !ours.has(id));
      if (foreign.length > 0)
        return {
          ok: false, status: 422, code: "LOCATION_NOT_YOURS",
          message: `${foreign.length} of those location${foreign.length === 1 ? "" : "s"} ${foreign.length === 1 ? "does" : "do"} not belong to this practice, so nothing was written`,
        };
    }
  }

  // The appointment types are also checked here, even though migration 254 constrains them. A refusal
  // with a sentence beats a constraint violation, and the answer is the same either way.
  if (args.visibleAppointmentTypes !== undefined) {
    const known = SESSION_APPOINTMENT_TYPES.map(([code]) => code as string);
    const unknown = [...new Set(args.visibleAppointmentTypes.map(String))].filter(t => !known.includes(t));
    if (unknown.length > 0)
      return {
        ok: false, status: 422, code: "UNKNOWN_APPOINTMENT_TYPE",
        message: `no appointment may be made with: ${unknown.join(", ")}`,
      };
  }

  const existing = await bookingAccessProfile(admin, ctx.workspaceId);
  if (existing.state !== "ok")
    return { ok: false, status: 503, code: "READ_FAILED", message: existing.reason };

  const text = (v: string | null | undefined) =>
    v === undefined ? undefined : (v === null ? null : (v.trim() || null));

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: args.actorId };
  if (args.mode !== undefined) patch.mode = args.mode;
  if (args.otpRequired !== undefined) patch.otp_required = args.otpRequired;
  if (args.otpChannel !== undefined) patch.otp_channel = args.otpChannel;
  if (args.guestBookingAllowed !== undefined) patch.guest_booking_allowed = args.guestBookingAllowed;
  if (args.existingPatientMatching !== undefined) patch.existing_patient_matching = args.existingPatientMatching;
  if (args.visibleLocationIds !== undefined) patch.visible_location_ids = [...new Set(args.visibleLocationIds.map(String))];
  if (args.visibleAppointmentTypes !== undefined) patch.visible_appointment_types = [...new Set(args.visibleAppointmentTypes.map(String))];
  if (args.brandDisplayName !== undefined) patch.brand_display_name = text(args.brandDisplayName);
  if (args.instructions !== undefined) patch.instructions = text(args.instructions);
  // Either, both or neither -- see migration 291. text() turns a blank into null, so clearing a field
  // in the form genuinely unsets it rather than storing an empty string the screen would render.
  if (args.fallbackEmail !== undefined) patch.fallback_email = text(args.fallbackEmail);
  if (args.fallbackPhone !== undefined) patch.fallback_phone = text(args.fallbackPhone);
  if (args.privacyNotice !== undefined) patch.privacy_notice = text(args.privacyNotice);
  if (args.consentText !== undefined) patch.consent_text = text(args.consentText);
  if (args.consentRequired !== undefined) patch.consent_required = args.consentRequired;

  // ⚠ MIGRATION 272. THE TIMESTAMP MOVES ONLY WHEN THE DOOR IS OPENED, so "when did this practice start
  // taking unverified requests" has one answer and it is the day somebody decided, not the day somebody
  // last saved this form. Turning it off clears both, because a practice that has closed the door has no
  // date on which it is open.
  if (args.unverifiedRequestsAllowed !== undefined) {
    patch.unverified_requests_allowed = args.unverifiedRequestsAllowed;
    if (args.unverifiedRequestsAllowed) {
      if (existing.value?.unverifiedRequestsAllowed !== true) {
        patch.unverified_requests_allowed_at = new Date().toISOString();
        patch.unverified_requests_allowed_by = args.actorId;
      }
    } else {
      patch.unverified_requests_allowed_at = null;
      patch.unverified_requests_allowed_by = null;
    }
  }

  if (existing.value) {
    const { data, error } = await admin.from("practice_booking_access")
      .update(patch).eq("workspace_id", ctx.workspaceId).eq("id", existing.value.id).select("id").maybeSingle();
    if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
    // ⚠ AN UPDATE THAT MATCHED NOTHING IS NOT A SUCCESS. This codebase has shipped two silent write
    // failures by treating one as one.
    if (!data) return { ok: false, status: 409, code: "NOT_WRITTEN", message: "the profile changed underneath you; reload and retry" };
    return { ok: true, data: { id: data.id as string, created: false } };
  }

  // ⚠ A NEW PAGE STARTS WITH A WAY THROUGH, not with the gap migration 291 exists to close.
  //
  // 291 backfilled every page that already existed, and the harness immediately created one that did
  // not get it -- which is the shape of the bug: a default applied once, in a migration, is a default
  // that stops applying the next day. The practice can clear or change it in Practice Setup, and the
  // onboarding step asks them to. This only fills a field the caller left unset.
  const seeded = patch.fallback_email === undefined && patch.fallback_phone === undefined
    ? { fallback_email: BOOKING_FALLBACK_EMAIL }
    : {};

  // The page's handle, when the practitioner claimed one before the page existed. claimHandle writes
  // onto a page it finds; this is the same write from the other side, so that the two orders of the
  // same two acts land in the same place. Null when nobody has claimed one yet, and null when more
  // than one identity points here -- see handleForWorkspace for why that is deliberate.
  const adopted = await handleForWorkspace(admin, ctx.workspaceId);

  const { data, error } = await admin.from("practice_booking_access")
    .insert({
      workspace_id: ctx.workspaceId, created_by: args.actorId,
      ...(adopted ? { handle: adopted } : {}),
      ...seeded, ...patch,
    })
    .select("id").maybeSingle();
  if (error) {
    if (error.code === "23505")
      return { ok: false, status: 409, code: "ALREADY_EXISTS", message: "this practice already has a booking page; reload and retry" };
    return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  }
  if (!data) return { ok: false, status: 500, code: "NOT_WRITTEN", message: "the booking page was not created and the database reported no error" };
  return { ok: true, data: { id: data.id as string, created: true } };
}

/**
 * Move the booking page's publish state.
 *
 * ⚠ THE ENGINE CHECKS WHAT ONLY AN ENGINE CAN SEE, AND THE DATABASE CHECKS THE ROW.
 *
 * s10.2's blockers are mostly facts about OTHER tables -- locations, sessions, rules, registration
 * fields -- and no constraint on practice_booking_access can see them, so this refuses on those before
 * writing. The three that are facts about the row itself belong to
 * `practice_booking_access_publishable`, and they are NOT repeated here: the write is attempted and the
 * database's refusal is reported with the constraint named. Repeating them would give this product two
 * copies of one rule, and only one of them is the one nothing can bypass.
 */
export async function setPublishState(admin: any, ctx: WorkspaceContext, args: {
  to: string; acceptWarnings?: boolean; actorId: string; correlationId: string;
}): Promise<EngineResult<{ publishState: string; acceptedWarnings: string[] }>> {
  if (!ctx.capabilities.includes("practice.settings.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "practice.settings.manage is required" };

  if (!PUBLISH_STATE_CODES.includes(args.to))
    return {
      ok: false, status: 400, code: "UNKNOWN_PUBLISH_STATE",
      message: `a publish state must be one of: ${PUBLISH_STATE_CODES.join(", ")}`,
    };

  const existing = await bookingAccessProfile(admin, ctx.workspaceId);
  if (existing.state !== "ok")
    return { ok: false, status: 503, code: "READ_FAILED", message: existing.reason };
  if (!existing.value)
    return {
      ok: false, status: 409, code: "NO_PROFILE",
      message: "there is no booking page to publish. Configure the access mode first.",
    };

  const goingLive = PUBLISH_STATES_LIVE.includes(args.to);
  let acceptedWarnings: string[] = [];

  if (goingLive) {
    const readiness = await publishReadiness(admin, ctx);

    // ⚠ THE ENGINE'S OWN BLOCKERS, NAMED. Including the ones it could not CHECK: publishing over a
    // question nobody answered is the failure this whole checklist exists to prevent.
    const engineOwned = (codes: string[]) =>
      codes.filter(c => publishCheck(c)?.authority !== "database");
    const failing = engineOwned(readiness.blockersFailing);
    const unchecked = engineOwned(readiness.blockersNotChecked);
    if (failing.length > 0 || unchecked.length > 0)
      return {
        ok: false, status: 409, code: "NOT_READY",
        message: [
          failing.length > 0 ? `not ready: ${failing.join(", ")}` : null,
          unchecked.length > 0 ? `could not be checked, so publishing is refused rather than guessed at: ${unchecked.join(", ")}` : null,
        ].filter(Boolean).join("; "),
      };

    // s8.1's "Published with warnings" is a real state, and it is the ONLY way a warning is passed:
    // somebody says so. A screen that quietly picked it would publish over a warning nobody read.
    const outstanding = [...readiness.warningsFailing, ...readiness.notChecked]
      .filter(c => publishCheck(c)?.severity !== "blocker");
    if (outstanding.length > 0) {
      if (args.to === "published" && !args.acceptWarnings)
        return {
          ok: false, status: 409, code: "WARNINGS_OUTSTANDING",
          message: `${outstanding.length} check${outstanding.length === 1 ? "" : "s"} did not pass and ${outstanding.length === 1 ? "was" : "were"} not accepted: ${outstanding.join(", ")}`,
        };
      acceptedWarnings = outstanding;
    }
  }

  const patch: Record<string, unknown> = {
    publish_state: goingLive && acceptedWarnings.length > 0 ? "published_with_warnings" : args.to,
    updated_at: new Date().toISOString(), updated_by: args.actorId,
  };
  if (goingLive) { patch.published_at = new Date().toISOString(); patch.published_by = args.actorId; }
  if (args.to === "paused") patch.paused_at = new Date().toISOString();

  const { data, error } = await admin.from("practice_booking_access")
    .update(patch).eq("id", existing.value.id).select("publish_state").maybeSingle();

  if (error) {
    // ⚠ THE DATABASE'S REFUSAL, REPORTED AS THE DATABASE'S. 23514 is a check violation; when it names
    // practice_booking_access_publishable it is one of the three row-level rules, and the message says
    // which three they are rather than pretending this code worked them out.
    if (error.code === "23514" && String(error.message ?? "").includes(PUBLISHABLE_CONSTRAINT))
      return {
        ok: false, status: 409, code: "REFUSED_BY_CONSTRAINT",
        message: `the database refused this (${PUBLISHABLE_CONSTRAINT}): a published booking page needs a claimed handle, the one-time code switched on, and a mode that admits patients. Nothing was written.`,
      };
    if (error.code === "23503")
      return {
        ok: false, status: 409, code: "HANDLE_NOT_ISSUED",
        message: "the database refused this: the handle on this profile is not one any identity holds. Nothing was written.",
      };
    return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };
  }
  if (!data) return { ok: false, status: 409, code: "NOT_WRITTEN", message: "the profile changed underneath you; reload and retry" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.booking_page_state_changed",
    payload: { from: existing.value.publishState, to: data.publish_state, acceptedWarnings },
    correlationId: args.correlationId,
  });

  // CPR-GROWTH-001 s2 "booking link generated". ⚠ ON GOING LIVE, NOT ON HAVING A HANDLE. A handle is
  // claimed at provisioning and a hidden page's URL answers "this page does not exist", so emitting any
  // earlier would credit a practice with a distribution asset it cannot hand to anybody. Non-blocking.
  if (goingLive) await onBookingLinkCreated(admin, ctx.workspaceId, args.actorId);

  return { ok: true, data: { publishState: data.publish_state as string, acceptedWarnings } };
}
