// Task Centre Workflow & Automation (SSW-TSK-001) — task template loader &
// catalogues. Fail-soft: report not-provisioned before migration 070 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export const RECURRENCES = ["none", "hourly", "per_shift", "daily", "weekly"];
export const RECURRENCE_LABEL: Record<string, string> = { none: "One-off", hourly: "Hourly", per_shift: "Per shift", daily: "Daily", weekly: "Weekly" };
export const TRIGGERS = ["manual", "admission", "discharge", "transfer", "pews_high", "ward_round", "incident"];
export const TRIGGER_LABEL: Record<string, string> = { manual: "Manual", admission: "On admission", discharge: "On discharge", transfer: "On transfer", pews_high: "On PEWS ≥ threshold", ward_round: "On ward round", incident: "On incident" };
export const PRIORITIES = ["urgent", "high", "normal", "low"];

export async function loadTaskTemplates(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("op_task_templates").select("id, name, task_type, priority, description, due_offset_min, recurrence, trigger_event, requires_review, active, created_by_name, created_at"))
    .eq("active", true).order("created_at", { ascending: false }).limit(100);
  if (res.error) {
    if (missing(res.error)) return { provisioned: false as const };
    return { provisioned: true as const, error: true, templates: [] };
  }
  const templates = res.data ?? [];
  return {
    provisioned: true as const,
    templates,
    automated: templates.filter((t: any) => t.trigger_event !== "manual").length,
    recurring: templates.filter((t: any) => t.recurrence !== "none").length,
  };
}
