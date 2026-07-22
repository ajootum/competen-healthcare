// Global Event Centre (LCP-001 §15) — system-emitted platform telemetry, distinct
// from the actor-attributed plat_audit_events. Emitters fire on provisioning,
// lifecycle transitions, subscription changes, etc.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Severity = "info" | "warning" | "critical";

// Returns true when the event row was actually written (supabase reports DB
// errors in the result, not by throwing — callers that promise a snapshot can
// check this instead of assuming success).
export async function emitPlatformEvent(admin: any, e: {
  event_type: string; tenant_id?: string | null; severity?: Severity; payload?: any;
}): Promise<boolean> {
  try {
    const r = await admin.from("plat_platform_events").insert({
      event_type: e.event_type, tenant_id: e.tenant_id ?? null,
      severity: e.severity ?? "info", payload: e.payload ?? null,
    });
    return !r?.error;
  } catch { return false; /* pre-migration / non-fatal */ }
}

export async function loadEventCentre(admin: any) {
  try {
    const { data, error } = await admin.from("plat_platform_events")
      .select("event_type, tenant_id, severity, payload, created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) return { ready: false, events: [] as any[], byType: [] as { type: string; count: number }[], bySeverity: { info: 0, warning: 0, critical: 0 } };
    const rows = data ?? [];
    const typeMap = new Map<string, number>();
    const sev = { info: 0, warning: 0, critical: 0 } as Record<Severity, number>;
    for (const r of rows) { typeMap.set(r.event_type, (typeMap.get(r.event_type) ?? 0) + 1); sev[r.severity as Severity] = (sev[r.severity as Severity] ?? 0) + 1; }
    const byType = [...typeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 12);
    return { ready: true, events: rows, byType, bySeverity: sev };
  } catch {
    return { ready: false, events: [] as any[], byType: [] as { type: string; count: number }[], bySeverity: { info: 0, warning: 0, critical: 0 } };
  }
}
