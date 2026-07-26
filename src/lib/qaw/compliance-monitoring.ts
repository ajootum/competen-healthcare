// QAW-005 Compliance Monitoring Centre — continuous compliance against regulatory / accreditation /
// contractual / internal requirements. Grounded in gov_obligations (the Obligations Register, migration
// 059) + a real 6-month compliance trend from quality_score_snapshots (091). Tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOMAIN_TONE = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];
const STATUS_TONE: Record<string, string> = { compliant: "emerald", at_risk: "amber", non_compliant: "rose", not_assessed: "slate", waived: "gray" };

export async function loadCompliance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const { data: rows, error } = await scope(admin.from("gov_obligations").select("id, title, source_authority, domain, owner_name, review_frequency, effective_date, expiry_date, status, risk_rating, note").limit(5000));
  if (error) return { provisioned: false as const };
  const obs = (rows ?? []) as any[];

  const by = (s: string) => obs.filter(o => o.status === s).length;
  const compliant = by("compliant"), atRisk = by("at_risk"), nonCompliant = by("non_compliant"), notAssessed = by("not_assessed"), waived = by("waived");
  const assessed = obs.length - notAssessed - waived;
  const score = assessed > 0 ? Math.round((compliant / assessed) * 100) : null;
  const overdue = obs.filter(o => o.expiry_date && o.expiry_date < today && o.status !== "compliant");

  // By domain — compliance rate per domain.
  const domMap = new Map<string, { total: number; ok: number }>();
  obs.forEach(o => { const d = domMap.get(o.domain) ?? { total: 0, ok: 0 }; d.total++; if (o.status === "compliant") d.ok++; domMap.set(o.domain, d); });
  const byDomain = [...domMap.entries()].map(([label, v], i) => ({ label: label.replace(/_/g, " "), pct: v.total ? Math.round((v.ok / v.total) * 100) : 0, value: v.total, tone: DOMAIN_TONE[i % DOMAIN_TONE.length] })).sort((a, b) => b.value - a.value);

  const statusBreak = [
    { label: "Compliant", value: compliant, tone: "emerald" },
    { label: "At risk / partial", value: atRisk, tone: "amber" },
    { label: "Non-compliant", value: nonCompliant, tone: "rose" },
    { label: "Not assessed", value: notAssessed, tone: "slate" },
    { label: "Waived", value: waived, tone: "gray" },
  ];

  const topNonCompliant = obs.filter(o => ["non_compliant", "at_risk"].includes(o.status))
    .sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.risk_rating as string] ?? 4) - ({ critical: 0, high: 1, medium: 2, low: 3 }[b.risk_rating as string] ?? 4))
    .slice(0, 6).map(o => ({ title: o.title, domain: (o.domain || "").replace(/_/g, " "), risk: o.risk_rating, status: o.status, authority: o.source_authority }));

  const upcoming = obs.filter(o => o.expiry_date && o.expiry_date >= today).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)).slice(0, 6)
    .map(o => ({ title: o.title, domain: (o.domain || "").replace(/_/g, " "), due: o.expiry_date, freq: o.review_frequency }));

  // 6-month compliance trend from snapshots.
  let trend: { label: string; value: number }[] = [];
  try {
    const { data: snaps } = await scope(admin.from("quality_score_snapshots").select("snapshot_date, compliance_score").order("snapshot_date", { ascending: false }).limit(180));
    const byMonth = new Map<string, number>();
    (snaps ?? []).forEach((s: any) => { const k = String(s.snapshot_date).slice(0, 7); if (!byMonth.has(k) && s.compliance_score != null) byMonth.set(k, Math.round(Number(s.compliance_score))); });
    trend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));
  } catch { /* optional */ }

  return {
    provisioned: true as const,
    kpis: { score, total: obs.length, compliant, atRisk, nonCompliant, overdue: overdue.length },
    byDomain, statusBreak, topNonCompliant, upcoming, trend,
    recent: obs.slice(0, 6).map(o => ({ title: o.title, domain: (o.domain || "").replace(/_/g, " "), status: o.status, owner: o.owner_name, statusTone: STATUS_TONE[o.status] ?? "slate" })),
  };
}
