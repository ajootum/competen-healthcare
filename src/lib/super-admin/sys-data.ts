// Data Protection & Recovery (SYS-001.5) loader — the resilience posture. The
// module is deliberately honest: backups are Supabase-managed (not surfaced via
// API) and there is no encryption/key-rotation/secrets store, so those render
// as documented facts, not fabricated metrics. What IS real: the DB liveness
// probe, the documented recovery-event log (sys_recovery_events, migration 063
// — DR tests, restore/privacy requests, backup verifications with RPO/RTO), the
// data-access/export/deletion slice of the audit trail, and the data-privacy /
// documentation compliance obligations. Fail-soft (SYS-002 AC-02).
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadRuntimeStatus } from "@/lib/platform/runtime";

const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };
const byKindLabel = (kind: string) => (({ dr_test: "DR test", restore_request: "restore", backup_verification: "backup verify", privacy_request: "privacy", retention_review: "retention" } as Record<string, string>)[kind] ?? kind);
const DAY = 86400000;
const DATA_RE = /export|download|delete|destroy|purge|restore|backup|retention|privacy|data_/i;

export async function loadDataProtection(admin: any) {
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();

  const [runtime, recRows, auditRows, oblRows] = await Promise.all([
    loadRuntimeStatus(admin),
    admin.from("sys_recovery_events").select("id, kind, title, scope, status, outcome, rpo_target_min, rto_target_min, rpo_actual_min, rto_actual_min, requested_by_name, created_at, completed_at").order("created_at", { ascending: false }).limit(500),
    admin.from("audit_log").select("action, actor_name, entity_name, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("gov_obligations").select("title, domain, status, expiry_date").in("domain", ["data_privacy", "documentation", "cybersecurity"]).limit(1000),
  ]);

  // ── Recovery-event log (migration 063; fail-soft) ───────────────────────────
  const ready = !recRows.error;
  const events = (ready ? recRows.data ?? [] : []) as any[];
  const byKind = bucket(events, "kind");
  const drTests = events.filter(e => e.kind === "dr_test");
  const drCompleted = drTests.filter(e => e.status === "completed");
  const drPassed = drCompleted.filter(e => e.outcome === "passed").length;
  const restoreRequests = events.filter(e => e.kind === "restore_request");
  const openRestores = restoreRequests.filter(e => !["completed", "rejected"].includes(e.status)).length;
  const lastDrTest = drCompleted[0] ?? null;
  const lastBackupVerify = events.filter(e => e.kind === "backup_verification" && e.status === "completed")[0] ?? null;

  // Latest DR test's RPO/RTO actuals vs target (the readiness signal).
  const rpoTarget = lastDrTest?.rpo_target_min ?? null;
  const rtoTarget = lastDrTest?.rto_target_min ?? null;
  const rpoActual = lastDrTest?.rpo_actual_min ?? null;
  const rtoActual = lastDrTest?.rto_actual_min ?? null;
  // DR readiness = share of completed DR tests that passed (honest null if none).
  const drReadiness = drCompleted.length ? Math.round((drPassed / drCompleted.length) * 100) : null;

  const recent = events.slice(0, 8).map(e => ({
    id: e.id, kind: e.kind, title: e.title, scope: e.scope, status: e.status, outcome: e.outcome,
    rto: e.rto_actual_min ?? e.rto_target_min, at: e.created_at,
  }));

  // ── Data-access events from the audit trail ─────────────────────────────────
  const audits = (auditRows.error ? [] : auditRows.data ?? []) as any[];
  const dataEvents = audits.filter(a => DATA_RE.test(a.action ?? ""));
  const dataEvents30 = dataEvents.filter(a => a.created_at >= since30).length;
  const deletions30 = dataEvents.filter(a => a.created_at >= since30 && /delete|destroy|purge/i.test(a.action ?? "")).length;

  // ── Data-privacy / documentation obligations (cross-module) ─────────────────
  const obls = (oblRows.error ? [] : oblRows.data ?? []) as any[];
  const oblByDomain = bucket(obls, "domain");
  const oblNonCompliant = obls.filter(o => ["non_compliant", "at_risk"].includes(o.status)).length;

  // ── Data-protection posture (documented facts — honest, not scored) ─────────
  const posture = [
    { label: "Encryption at rest", value: "Managed (Supabase / Postgres)", on: true },
    { label: "Encryption in transit", value: "TLS (platform-enforced)", on: true },
    { label: "Managed backups", value: "Supabase automated backups", on: true },
    { label: "Key rotation", value: "Provider-managed — not surfaced", on: null },
    { label: "Secrets management", value: "Env-based — no vault surface", on: null },
    { label: "Retention policy", value: "Not configured", on: false },
  ];

  return {
    ready,
    kpis: {
      dbHealthy: runtime.summary.dbOk,
      drReadiness,
      drTests: ready ? drTests.length : null,
      restoreRequests: ready ? restoreRequests.length : null,
      openRestores: ready ? openRestores : null,
      dataEvents30: auditRows.error ? null : dataEvents30,
    },
    byKind,
    drStats: { total: drTests.length, completed: drCompleted.length, passed: drPassed, readiness: drReadiness, last: lastDrTest, lastBackupVerify },
    rpo: { target: rpoTarget, actual: rpoActual },
    rto: { target: rtoTarget, actual: rtoActual },
    recent,
    dataAccess: { events30: dataEvents30, deletions30, recent: dataEvents.slice(0, 6).map(a => ({ action: a.action, actor: a.actor_name, entity: a.entity_name, at: a.created_at })) },
    obligations: { byDomain: oblByDomain, nonCompliant: oblNonCompliant, total: obls.length },
    posture,
    backupWidget: runtime.slices.backup ?? null,
    pickers: {
      openEvents: events
        .filter(e => !["completed", "rejected"].includes(e.status))
        .slice(0, 200)
        .map(e => ({ id: e.id, label: `${e.title} (${(byKindLabel(e.kind))})` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
