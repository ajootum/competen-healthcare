// OGS-010 Office Integration, APIs & Platform Services. Real event backbone over domain_events (102);
// the platform-service catalogue + workspace map are structural (labelled). No fabricated uptime.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/office-governance/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const PLATFORM_SERVICES = ["Identity & Access", "Notification Service", "Document Service", "Workflow Engine", "Analytics Service", "Audit Service", "Search Service", "No-Code Platform", "AI Platform (AIS)"];
export const WORKSPACES = ["Healthcare Worker", "Assessor", "Educator", "Unit Manager", "Shift Supervisor", "HR", "Quality & Accreditation", "Executive", "Competency Office", "Personal", "Organisation Admin"];

export async function loadOgsIntegration(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const totalRes = await scope(admin.from("domain_events").select("id", { count: "exact", head: true }));
  if (totalRes.error) return { provisioned: false as const };
  const totalAll = totalRes.count ?? 0;

  const { data: rows } = await scope(admin.from("domain_events").select("event_type, subject_type, actor_name, occurred_at, status, created_at").order("occurred_at", { ascending: false }).limit(4000));
  const events = (rows ?? []) as any[];
  const by = (s: string) => events.filter(e => e.status === s).length;
  const processed = by("processed"), pending = by("pending"), failed = by("failed") + by("dead_letter");
  const processedToday = events.filter(e => e.status === "processed" && String(e.occurred_at ?? e.created_at ?? "").slice(0, 10) === today).length;
  const successRate = (processed + failed) ? Math.round((processed / (processed + failed)) * 100) : null;

  const typeMap = new Map<string, number>();
  events.forEach(e => typeMap.set(e.event_type, (typeMap.get(e.event_type) ?? 0) + 1));
  const topFlows = [...typeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ label, n }));

  const deliveryDonut = [
    { label: "Processed", value: processed, tone: "emerald" },
    { label: "Pending", value: pending, tone: "amber" },
    { label: "Failed / dead-letter", value: failed, tone: "rose" },
  ].filter(s => s.value > 0);

  // 6-month event volume trend.
  const monthAgg = new Map<string, number>();
  events.forEach(e => { const k = String(e.occurred_at ?? e.created_at ?? "").slice(0, 7); if (k) monthAgg.set(k, (monthAgg.get(k) ?? 0) + 1); });
  const trend = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));

  const stream = events.slice(0, 8).map(e => ({ type: e.event_type, subject: e.subject_type, actor: e.actor_name, when: e.occurred_at ?? e.created_at, status: e.status }));

  // Structural: which workspaces show event flow (derived from event/subject prefixes).
  const route = (label: string) => {
    const re: Record<string, RegExp> = { "Assessor": /assessment/i, "Educator": /learning|education|curriculum/i, "HR": /credential|employment|workforce|position/i, "Quality & Accreditation": /incident|capa|audit|accreditation|quality/i, "Competency Office": /competency|framework|publication|cpu/i, "Unit Manager": /staffing|roster|shift|unit/i, "Shift Supervisor": /escalation|safety|shift/i, "Executive": /governance|decision|office/i };
    const r = re[label]; return r ? events.some(e => r.test(`${e.event_type} ${e.subject_type}`)) : false;
  };
  const workspaceHealth = WORKSPACES.map(w => ({ name: w, live: route(w) }));

  return {
    provisioned: true as const,
    empty: totalAll === 0,
    kpis: { processedToday, successRate, pending, failed, total: totalAll, activeEventTypes: typeMap.size, services: PLATFORM_SERVICES.length },
    topFlows, deliveryDonut, trend, stream, workspaceHealth,
    services: PLATFORM_SERVICES,
  };
}
