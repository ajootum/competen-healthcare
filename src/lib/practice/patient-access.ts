import { platformFlag } from "@/lib/practice/provisioning";
import { messagingStatus } from "@/lib/practice/messaging";
import { BOOKING_MODES_LIVE } from "@/lib/practice/practice-session-constants";
import {
  PATIENT_ACCESS_STORES, PATIENT_BOOKING_FLAG, PATIENT_ACCESS_BUILD_BLOCKERS,
  PATIENT_ACCESS_BLOCKING_CODES, patientAccessBlocker,
} from "@/lib/practice/patient-access-constants";
import type { WorkspaceContext } from "@/lib/practice/access";

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

  // 2. THE BUILD. Named second and unconditionally, because it is true regardless of what any read said.
  found.push(blockerFrom("INTAKE_NOT_BUILT"));

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
