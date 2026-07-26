// QAW-001 Accreditation Standards Centre — the governed standards library + compliance assessment.
// Grounded in quality_frameworks + quality_standards (019, the catalogue, scoped via quality_objects)
// and gov_standard_assessments (061, INSERT-ONLY assessment history → latest per framework+reference_code).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_TONE: Record<string, string> = { met: "emerald", partially_met: "amber", not_met: "rose", not_assessed: "slate" };

export async function loadStandards(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const { data: fwRows, error } = await admin.from("quality_frameworks").select("id, code, name, framework_type").limit(200);
  if (error) return { provisioned: false as const };
  const frameworks = (fwRows ?? []) as any[];
  const fwById = new Map(frameworks.map(f => [f.id, f]));

  // Catalogue counts (standards per framework), scoped via hospital-owned quality_objects.
  const { data: objs } = await scope(admin.from("quality_objects").select("id").limit(4000));
  const objIds = (objs ?? []).map((o: any) => o.id);
  const stdCountByFw = new Map<string, number>();
  let totalStandards = 0;
  if (objIds.length) {
    let stds: any[] = [];
    for (let i = 0; i < objIds.length; i += 200) {
      const { data } = await admin.from("quality_standards").select("framework_id").in("quality_object_id", objIds.slice(i, i + 200)).limit(20000);
      stds = stds.concat(data ?? []);
    }
    totalStandards = stds.length;
    stds.forEach(s => stdCountByFw.set(s.framework_id, (stdCountByFw.get(s.framework_id) ?? 0) + 1));
  }

  // Assessment history → latest status per (framework, reference_code).
  const { data: asmtRows } = await scope(admin.from("gov_standard_assessments").select("framework_id, reference_code, title, status, gap_note, owner_name, assessed_at").order("assessed_at", { ascending: false }).limit(20000));
  const assessments = (asmtRows ?? []) as any[];
  const latest = new Map<string, any>();
  assessments.forEach(a => { const key = `${a.framework_id}|${a.reference_code}`; if (!latest.has(key)) latest.set(key, a); });
  const latestArr = [...latest.values()];

  const cnt = (s: string) => latestArr.filter(a => a.status === s).length;
  const met = cnt("met"), partial = cnt("partially_met"), notMet = cnt("not_met"), notAssessed = cnt("not_assessed");
  const assessed = met + partial + notMet;
  const overall = assessed > 0 ? Math.round((met / assessed) * 100) : null;

  // Per-framework compliance.
  const fwAgg = new Map<string, { met: number; assessed: number }>();
  latestArr.forEach(a => { const g = fwAgg.get(a.framework_id) ?? { met: 0, assessed: 0 }; if (a.status !== "not_assessed") { g.assessed++; if (a.status === "met") g.met++; } fwAgg.set(a.framework_id, g); });
  const library = frameworks.map(f => {
    const g = fwAgg.get(f.id) ?? { met: 0, assessed: 0 };
    return { id: f.id, name: f.name ?? f.code, type: f.framework_type, standards: stdCountByFw.get(f.id) ?? 0, assessed: g.assessed, compliance: g.assessed ? Math.round((g.met / g.assessed) * 100) : null };
  }).sort((a, b) => (b.standards + b.assessed) - (a.standards + a.assessed));

  const byFramework = library.filter(f => f.compliance != null).map((f, i) => ({ label: f.name, pct: f.compliance!, tone: ["teal", "blue", "indigo", "violet", "amber"][i % 5] }));

  const topGaps = latestArr.filter(a => ["not_met", "partially_met"].includes(a.status))
    .slice(0, 6).map(a => ({ ref: a.reference_code, title: a.title, framework: fwById.get(a.framework_id)?.code ?? "—", status: a.status, gap: a.gap_note }));

  const recent = assessments.slice(0, 6).map(a => ({ ref: a.reference_code, title: a.title, framework: fwById.get(a.framework_id)?.code ?? "—", status: a.status, by: a.owner_name, when: a.assessed_at }));

  // Compliance-over-time trend (% met of assessed, by month of assessment).
  const monthAgg = new Map<string, { met: number; assessed: number }>();
  assessments.forEach(a => { if (a.status === "not_assessed") return; const k = String(a.assessed_at).slice(0, 7); const g = monthAgg.get(k) ?? { met: 0, assessed: 0 }; g.assessed++; if (a.status === "met") g.met++; monthAgg.set(k, g); });
  const trend = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v.assessed ? Math.round((v.met / v.assessed) * 100) : 0 }));

  return {
    provisioned: true as const,
    kpis: { overall, totalStandards, assessed, met, partial, notMet, notAssessed, frameworks: frameworks.length },
    library, byFramework, topGaps, recent, trend,
    statusDonut: [
      { label: "Met", value: met, tone: "emerald" },
      { label: "Partially met", value: partial, tone: "amber" },
      { label: "Not met", value: notMet, tone: "rose" },
      { label: "Not assessed", value: notAssessed, tone: "slate" },
    ],
    statusTone: STATUS_TONE,
  };
}
