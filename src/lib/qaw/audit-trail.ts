// QAW-014 Quality Audit Trail, Assurance & Regulatory Reporting.
// Grounded in audit_log (040, the immutable enterprise trail) + domain_events (102). Assurance score is
// a transparent composite of the latest quality_score_snapshots; compliance issues / open actions reuse
// gov_obligations + capa_actions. Regulatory submissions, assurance reviews, evidence chain-of-custody
// and digital signatures have no store yet → reported honestly as next-phase. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const num = (v: any) => (v == null ? null : Number(v));
function actionCategory(a: string): string {
  const s = (a || "").toLowerCase();
  if (/(create|insert|add|new|report)/.test(s)) return "Create";
  if (/(update|edit|change|modif|assess|review|approve)/.test(s)) return "Update";
  if (/(delete|remove|revoke|archive)/.test(s)) return "Delete";
  if (/(login|logout|auth|sign)/.test(s)) return "Auth";
  if (/(export|download|generate)/.test(s)) return "Export";
  return "Other";
}
const CAT_TONE: Record<string, string> = { Create: "emerald", Update: "blue", Delete: "rose", Auth: "violet", Export: "amber", Other: "slate" };

export async function loadAuditTrail(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Total (head count) + a recent window for the activity profile.
  const totalRes = await scope(admin.from("audit_log").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const totalEvents = totalRes.count ?? 0;

  const { data: logRows } = await scope(admin.from("audit_log").select("actor_name, action, entity_type, entity_id, entity_name, created_at").order("created_at", { ascending: false }).limit(4000));
  const logs = (logRows ?? []) as any[];

  // By action category (recent profile).
  const catMap = new Map<string, number>();
  logs.forEach(l => { const c = actionCategory(l.action); catMap.set(c, (catMap.get(c) ?? 0) + 1); });
  const byAction = ["Create", "Update", "Delete", "Auth", "Export", "Other"].map(c => ({ label: c, value: catMap.get(c) ?? 0, tone: CAT_TONE[c] })).filter(x => x.value > 0);

  // By module (entity_type).
  const modMap = new Map<string, number>();
  logs.forEach(l => { const m = l.entity_type || "other"; modMap.set(m, (modMap.get(m) ?? 0) + 1); });
  const TONE7 = ["blue", "emerald", "amber", "violet", "rose", "indigo", "teal", "slate"];
  const byModule = [...modMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, tone: TONE7[i % TONE7.length] }));

  // Daily trend over the recent window (last 14 active days).
  const dayMap = new Map<string, number>();
  logs.forEach(l => { const d = String(l.created_at).slice(0, 10); dayMap.set(d, (dayMap.get(d) ?? 0) + 1); });
  const trend = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([k, v]) => ({ label: k.slice(5), value: v }));

  // Domain events captured (optional).
  let domainEvents = 0;
  try { const r = await scope(admin.from("domain_events").select("id", { count: "exact", head: true })); domainEvents = r.count ?? 0; } catch { /* optional */ }

  // Assurance composite from the latest snapshot.
  let assurance: number | null = null; let assuranceParts: { label: string; pct: number; tone: string }[] = [];
  try {
    const { data } = await scope(admin.from("quality_score_snapshots").select("quality_score, compliance_score, safety_index, health_score, snapshot_date").order("snapshot_date", { ascending: false }).limit(1));
    const s = (data ?? [])[0];
    if (s) {
      const parts = [
        { label: "Quality", pct: num(s.quality_score) ?? 0, tone: "teal" },
        { label: "Compliance", pct: num(s.compliance_score) ?? 0, tone: "blue" },
        { label: "Safety", pct: num(s.safety_index) ?? 0, tone: "violet" },
        { label: "Health", pct: num(s.health_score) ?? 0, tone: "emerald" },
      ].filter(p => p.pct > 0);
      assuranceParts = parts;
      assurance = parts.length ? Math.round(parts.reduce((a, p) => a + p.pct, 0) / parts.length) : null;
    }
  } catch { /* optional */ }

  // Reused signals.
  let complianceIssues = 0, openActions = 0;
  try { const { data } = await scope(admin.from("gov_obligations").select("status").eq("status", "non_compliant").limit(3000)); complianceIssues = (data ?? []).length; } catch { /* optional */ }
  try { const { data } = await scope(admin.from("capa_actions").select("status").limit(4000)); openActions = (data ?? []).filter((c: any) => !["completed", "verified", "closed"].includes(c.status)).length; } catch { /* optional */ }

  return {
    provisioned: true as const,
    kpis: { totalEvents, domainEvents, assurance, complianceIssues, openActions, recentWindow: logs.length },
    byAction, byModule, trend, assuranceParts,
    recent: logs.slice(0, 10).map(l => ({ when: l.created_at, actor: l.actor_name, action: l.action, module: (l.entity_type || "").replace(/_/g, " "), entity: l.entity_name })),
  };
}
