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

// Runtime resolver the engines call. hid → hospital override (future), else the global policy, else code defaults.
// Never throws: a missing table (pre-148) resolves to DELIVERY_DEFAULTS so orchestration/reminders/consumer run.
export async function resolveDeliveryConfig(admin: Admin, hid: string | null = null): Promise<DeliveryConfig> {
  try {
    if (hid) {
      const { data } = await admin.from("cdp_delivery_config").select("*").eq("hospital_id", hid).maybeSingle();
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
  const { data: existing } = await admin.from("cdp_delivery_config").select("id").is("hospital_id", null).maybeSingle();
  const patch = { ...next, updated_by: actor.id, updated_by_name: actor.name, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await admin.from("cdp_delivery_config").update(patch).eq("id", existing.id);
    if (error) return { ok: false as const, error: error.message };
  } else {
    const { error } = await admin.from("cdp_delivery_config").insert({ hospital_id: null, ...patch });
    if (error) return { ok: false as const, error: error.message };
  }
  await admin.from("audit_log").insert({ actor_id: actor.id, actor_name: actor.name, action: "delivery_config_update", entity_type: "cdp_delivery_config", new_value: next });
  return { ok: true as const, config: next };
}
