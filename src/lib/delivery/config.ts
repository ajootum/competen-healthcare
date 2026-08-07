import { currentTraceId } from "@/lib/trace";
/* eslint-disable @typescript-eslint/no-explicit-any */
// CDP-014 — Learning Governance & Delivery Configuration. The delivery engines have always carried hard-coded
// policy (30-day reminder horizon, always auto-remediate, always orchestrate). This makes that policy DATA the
// governor can set, and — crucially — the engines READ it at runtime, so this is a live control surface, not a
// config table nobody consumes. MVP = one global policy row (cdp_delivery_config 148, hospital_id null);
// per-hospital overrides are additive later. resolveDeliveryConfig is deliberately resilient: if the table is
// missing (pre-148) it returns the code defaults, so the engines never break.

type Admin = any;

export type DeliveryConfig = {
  reminder_horizon_days: number;
  auto_remediation: boolean;
  orchestration_enabled: boolean;
  campaign_default_due_days: number;
};

// The hard-coded behaviour the engines used before CDP-014 — now the fallback, not the ceiling.
export const DELIVERY_DEFAULTS: DeliveryConfig = {
  reminder_horizon_days: 30,
  auto_remediation: true,
  orchestration_enabled: true,
  campaign_default_due_days: 30,
};

function coerce(row: any): DeliveryConfig {
  return {
    reminder_horizon_days: Number.isFinite(row?.reminder_horizon_days) ? Math.max(1, Math.min(365, row.reminder_horizon_days)) : DELIVERY_DEFAULTS.reminder_horizon_days,
    auto_remediation: typeof row?.auto_remediation === "boolean" ? row.auto_remediation : DELIVERY_DEFAULTS.auto_remediation,
    orchestration_enabled: typeof row?.orchestration_enabled === "boolean" ? row.orchestration_enabled : DELIVERY_DEFAULTS.orchestration_enabled,
    campaign_default_due_days: Number.isFinite(row?.campaign_default_due_days) ? Math.max(1, Math.min(365, row.campaign_default_due_days)) : DELIVERY_DEFAULTS.campaign_default_due_days,
  };
}

// What a hospital gets when its OWN override could not be read. Not DELIVERY_DEFAULTS: the defaults have both
// switches ON, so falling back to them answers "run the automation" for a governor who may have switched it OFF
// — and a control surface that fails to the ON position is not a control surface. The booleans therefore go
// dark and the numbers keep their defaults (they bound work rather than authorise it).
//
// The cost of being wrong this way is a skipped cron cycle, which the next run recovers. The cost of the other
// way is an automated remediation or reminder fired at a tenant that opted out, which cannot be un-sent.
const DELIVERY_CONSERVATIVE: DeliveryConfig = {
  ...DELIVERY_DEFAULTS,
  auto_remediation: false,
  orchestration_enabled: false,
};

// Runtime resolver the engines call. hid → hospital override (future), else the global policy, else code defaults.
// Never throws: a missing table (pre-148) resolves to DELIVERY_DEFAULTS so orchestration/reminders/consumer run.
export async function resolveDeliveryConfig(admin: Admin, hid: string | null = null): Promise<DeliveryConfig> {
  try {
    if (hid) {
      const { data, error } = await admin.from("cdp_delivery_config").select("*").eq("hospital_id", hid).maybeSingle();
      // ⚠ AN OVERRIDE WE COULD NOT READ IS NOT AN OVERRIDE THAT IS ABSENT. This line discarded its error and
      // fell through to the global policy, so a hospital that had turned orchestration off silently had it
      // back on. Note the sibling read below ALREADY checked its error — the function disagreed with itself.
      if (error) return { ...DELIVERY_CONSERVATIVE };
      if (data) return coerce(data);
    }
    const { data, error } = await admin.from("cdp_delivery_config").select("*").is("hospital_id", null).maybeSingle();
    if (error) return { ...DELIVERY_DEFAULTS };
    return data ? coerce(data) : { ...DELIVERY_DEFAULTS };
  } catch {
    return { ...DELIVERY_DEFAULTS };
  }
}

// Surface loader: the global policy plus provenance, or provisioned:false when the table is absent.
export async function loadDeliveryConfig(admin: Admin) {
  const probe = await admin.from("cdp_delivery_config").select("*").is("hospital_id", null).maybeSingle();
  if (probe.error) return { provisioned: false as const, config: { ...DELIVERY_DEFAULTS }, updatedBy: null as string | null, updatedAt: null as string | null };
  const row = probe.data;
  return {
    provisioned: true as const,
    config: row ? coerce(row) : { ...DELIVERY_DEFAULTS },
    updatedBy: (row?.updated_by_name ?? null) as string | null,
    updatedAt: (row?.updated_at ?? null) as string | null,
  };
}

// Write the global policy. Explicit find-then-update/insert (the global row keys on a NULL hospital_id, which
// upsert-on-conflict handles poorly). Returns the persisted config.
export async function saveDeliveryConfig(admin: Admin, input: Partial<DeliveryConfig>, actor: { id: string | null; name: string | null }) {
  const next = coerce({ ...DELIVERY_DEFAULTS, ...input });

  // ⚠ THE BRANCH BELOW IS CHOSEN BY THIS READ, so discarding its error picked the wrong one. A failed read left
  // `existing` undefined, which is indistinguishable from "there is no global row yet" — so it took the INSERT
  // branch and wrote a SECOND global row. The blast radius is the whole platform, not this request: with two
  // rows on `hospital_id is null`, resolveDeliveryConfig's .maybeSingle() then errors on every call and every
  // hospital silently reverts to code defaults. One transient blip during one save turns the governor's policy
  // off everywhere, with nothing on screen saying so.
  //
  // This is the recorded upsert trap in its find-then-write form, and the header explains why it is written
  // this way: the global row keys on a NULL hospital_id, which on-conflict handles poorly. Refusing costs the
  // governor a retry.
  const { data: existing, error: findErr } = await admin.from("cdp_delivery_config").select("id").is("hospital_id", null).maybeSingle();
  if (findErr) return { ok: false as const, error: `could not determine whether a policy row exists, so nothing was written: ${findErr.message}` };

  const patch = { ...next, updated_by: actor.id, updated_by_name: actor.name, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await admin.from("cdp_delivery_config").update(patch).eq("id", existing.id);
    if (error) return { ok: false as const, error: error.message };
  } else {
    const { error } = await admin.from("cdp_delivery_config").insert({ hospital_id: null, ...patch });
    if (error) return { ok: false as const, error: error.message };
  }
  await admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: actor.id, actor_name: actor.name, action: "delivery_config_update", entity_type: "cdp_delivery_config", new_value: next });
  return { ok: true as const, config: next };
}
