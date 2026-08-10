// CPR-GROWTH-001 - the activation ledger, the adoption ladder derived from it, and the risk queue.
//
// ⚠ NO CLINICAL CONTENT EVER REACHES THIS TABLE, AND THAT IS THE WHOLE REASON IT IS A SEPARATE ONE.
// Section 7: "commercial telemetry must avoid exposing unnecessary patient clinical content", and
// "customer success users must not receive clinical record access merely because they can view activation
// status". A milestone row records THAT something happened to a practice, never what was wrong with a
// patient. emitActivation refuses metadata keys that name a patient or carry clinical text -- a refusal in
// code, because "we agreed not to" is not a control.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ACTIVATION_EVENT_KEYS, ACTIVATION_DEFINITION, ADOPTION_LADDER, RISK_RULES } from "./adoption-constants";

export const ACTIVATION_TABLE = "practice_activation_event";

export type EmitResult =
  | { ok: true; recorded: boolean }
  | { ok: false; code: string; message: string };

/**
 * ⚠ THE DENYLIST IS DELIBERATE AND IT IS NOT A WHITELIST. A whitelist of permitted metadata keys would be
 * safer in the abstract and unusable in practice -- every new emitter would silently lose its context. This
 * refuses the shapes that would carry a person or a clinical fact, which is what section 7 actually forbids.
 * A key nobody anticipated still gets through, so the harness asserts over the emitters as well.
 */
const FORBIDDEN_METADATA_KEYS = [
  "patient_id", "patient_name", "patient", "patient_phone", "nhs", "mrn",
  "diagnosis", "diagnoses", "medication", "medications", "investigation", "treatment",
  "note", "notes", "reason_for_visit", "symptom", "symptoms", "encounter_note",
];

const offendingKeys = (metadata: Record<string, unknown>): string[] =>
  Object.keys(metadata ?? {}).filter(k => FORBIDDEN_METADATA_KEYS.includes(k.toLowerCase()));

/**
 * Record a milestone. Idempotent by construction: migration 283 puts a unique index on
 * (workspace_id, event_key), so a second emission is a no-op rather than a duplicate.
 *
 * `recorded` distinguishes "this is the first time" from "already known", which is what a caller needs in
 * order to fire a prompt exactly once.
 *
 * ⚠ THE CONFLICT IS NOT SWALLOWED BY AN UPSERT. It is an INSERT whose duplicate-key error is recognised and
 * reported as recorded:false. An upsert against this index would work, but the habit of treating a write
 * that changed nothing as success is how two silent write failures got into this codebase.
 */
export async function emitActivation(admin: any, args: {
  workspaceId: string;
  eventKey: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<EmitResult> {
  if (!ACTIVATION_EVENT_KEYS.includes(args.eventKey))
    return { ok: false, code: "UNKNOWN_EVENT", message: `${args.eventKey} is not a CPR-GROWTH-001 milestone` };

  const metadata = args.metadata ?? {};
  const offending = offendingKeys(metadata);
  if (offending.length)
    // Refused, not stripped. Stripping would let the caller believe the context was recorded.
    return { ok: false, code: "CLINICAL_METADATA_REFUSED", message: `commercial telemetry may not carry ${offending.join(", ")}` };

  const { error } = await admin.from(ACTIVATION_TABLE).insert({
    workspace_id: args.workspaceId,
    event_key: args.eventKey,
    actor_id: args.actorId ?? null,
    metadata,
  });

  if (!error) return { ok: true, recorded: true };
  // 23505 = unique_violation. The milestone already happened, which is a success for the caller.
  if (error.code === "23505") return { ok: true, recorded: false };
  return { ok: false, code: "WRITE_FAILED", message: error.message };
}

export type ActivationLedger =
  | { ok: true; keys: string[]; at: Record<string, string> }
  | { ok: false; message: string };

/** Every milestone a practice has reached. ⚠ A failed read is reported, never rendered as "none reached". */
export async function readActivationLedger(admin: any, workspaceId: string): Promise<ActivationLedger> {
  try {
    const { data, error } = await admin
      .from(ACTIVATION_TABLE).select("event_key, occurred_at").eq("workspace_id", workspaceId).limit(100);
    if (error) return { ok: false, message: error.message };
    const at: Record<string, string> = {};
    for (const r of (data ?? []) as any[]) at[r.event_key] = r.occurred_at;
    return { ok: true, keys: Object.keys(at), at };
  } catch (e: any) {
    return { ok: false, message: e?.message ?? "read threw" };
  }
}

export type LadderRung = {
  stage: number; name: string; perception: string; value: string;
  /** reached | not_reached | no_signal -- three states, because one rung genuinely cannot be evidenced. */
  state: "reached" | "not_reached" | "no_signal";
  at: string | null;
};

/**
 * The adoption ladder, derived.
 *
 * ⚠ THREE STATES, NOT TWO, AND THE THIRD IS THE HONEST ONE. Stages 2 and 3 (calendar organiser, patient
 * register) are named in section 1 with signals -- "recurring calendar use", "repeat patient identified" --
 * that section 2's pipeline does not emit. Rendering them as not-reached would tell a practitioner they
 * have not done something this product has never looked for. `no_signal` says so instead.
 */
export function deriveLadder(ledger: { keys: string[]; at: Record<string, string> }): LadderRung[] {
  return ADOPTION_LADDER.map(rung => ({
    stage: rung.stage, name: rung.name, perception: rung.perception, value: rung.value,
    state: rung.signal === null
      ? "no_signal"
      : ledger.keys.includes(rung.signal) ? "reached" : "not_reached",
    at: rung.signal ? ledger.at[rung.signal] ?? null : null,
  }));
}

/**
 * Section 1's north star. Activated means all four of the defining events, not payment and not a proxy.
 */
export const isActivated = (ledger: { keys: string[] }) =>
  ACTIVATION_DEFINITION.every(k => ledger.keys.includes(k));

export type RiskAssessment = {
  state: "green" | "amber" | "red" | "unknown";
  code: string;
  rule: string;
  action: string;
};

/**
 * Section 4's work queue, evaluated over the ledger.
 *
 * ⚠ AN UNREADABLE LEDGER IS `unknown`, NOT `red`. Red means "setup incomplete, go and help them"; a
 * customer-success user acting on a red that was really a database error would call a practitioner who is
 * doing fine and tell them they had not finished onboarding.
 */
export function assessRisk(ledger: ActivationLedger): RiskAssessment {
  if (!ledger.ok)
    return { state: "unknown", code: "ledger_unreadable", rule: "The activation ledger could not be read", action: "No outreach. Establish why the ledger is unreadable first." };

  const has = (k: string) => ledger.keys.includes(k);
  const pick = (code: string) => RISK_RULES.find(r => r.code === code)!;

  if (has("booking.first_received")) { const r = pick("activated"); return { state: r.state, code: r.code, rule: r.rule, action: r.action }; }
  if (has("booking.link_shared"))    { const r = pick("shared_no_booking"); return { state: r.state, code: r.code, rule: r.rule, action: r.action }; }
  if (has("practice.setup_completed")) { const r = pick("link_not_shared"); return { state: r.state, code: r.code, rule: r.rule, action: r.action }; }
  const r = pick("setup_incomplete");
  return { state: r.state, code: r.code, rule: r.rule, action: r.action };
}
