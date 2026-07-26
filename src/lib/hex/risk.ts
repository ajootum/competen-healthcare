// HEX-008 Enterprise Risk Management (executive lens) — composes the real risk register loader
// (loadRiskCentre → gov_risks + gov_controls) and adds executive aggregates: a weighted enterprise risk
// score, mitigation-action status (from capa_actions), and emerging (recently-added) risks. Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRiskCentre } from "@/lib/qaw/risk-centre";

const NONE = "00000000-0000-0000-0000-000000000000";
const bandTone = (s: number) => (s >= 70 ? "rose" : s >= 40 ? "amber" : "emerald");

export async function loadExecRisk(admin: any, hid: string | null, isSuper: boolean) {
  const r = await loadRiskCentre(admin, hid, isSuper);
  if (!r.provisioned) return { provisioned: false as const };
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  // Weighted enterprise risk score (0-100, higher = more exposure).
  const bandMap: Record<string, number> = Object.fromEntries(r.bandLegend.map((x: any) => [x.label, x.value]));
  const total = r.kpis.total || 1;
  const score = Math.round((((bandMap.Extreme ?? 0) * 100 + (bandMap.High ?? 0) * 70 + (bandMap.Medium ?? 0) * 40 + (bandMap.Low ?? 0) * 15)) / total);
  const scoreBand = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";

  // Mitigation actions (corrective/mitigating actions tracked in capa_actions).
  const { data: capaRows } = await scope(admin.from("capa_actions").select("status, due_date").limit(5000));
  const capa = (capaRows ?? []) as any[];
  const open = capa.filter(c => !["completed", "verified", "closed"].includes(c.status));
  const overdueMit = open.filter(c => c.due_date && c.due_date < today).length;
  const mitigation = {
    total: capa.length, overdue: overdueMit,
    donut: [
      { label: "On track", value: open.filter(c => c.status === "in_progress" && !(c.due_date && c.due_date < today)).length, tone: "emerald" },
      { label: "At risk", value: open.filter(c => c.status === "open" && !(c.due_date && c.due_date < today)).length, tone: "amber" },
      { label: "Overdue", value: overdueMit, tone: "rose" },
      { label: "Completed", value: capa.filter(c => ["completed", "verified", "closed"].includes(c.status)).length, tone: "blue" },
    ],
  };

  // Emerging risks — recently added (last 60 days).
  let emerging: any[] = [];
  try {
    const { data } = await scope(admin.from("gov_risks").select("title, category, likelihood, impact, created_at").order("created_at", { ascending: false }).limit(40));
    const cutoff = Date.now() - 60 * 86400000;
    emerging = ((data ?? []) as any[]).filter(x => Date.parse(x.created_at) >= cutoff).slice(0, 5).map(x => ({ title: x.title, category: (x.category || "").replace(/_/g, " "), score: Number(x.likelihood) * Number(x.impact), when: String(x.created_at).slice(0, 10) }));
  } catch { /* optional */ }

  return {
    provisioned: true as const, r, score, scoreBand, scoreTone: bandTone(score),
    mitigation, emerging,
    appetite: r.kpis.extreme + r.kpis.high, // risks above a conservative appetite (high/extreme)
  };
}
