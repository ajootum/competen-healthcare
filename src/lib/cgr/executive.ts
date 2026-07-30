/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-029 — Competency Governance Strategic Decision Intelligence & Executive Assurance.
// The distinct artifact (§8 Board-Level Reporting): a competency-governance ASSURANCE STATEMENT for the board —
// "can the board be assured our workforce competency system is sound?" HEX owns broad executive intelligence
// (financial/operational/workforce); this is the governance assurance position, which no single surface produces.
// It SYNTHESISES the CGR engines into one board pack from real data:
//   • Assurance position — registry assurance score → an explicit board rating (Assured / Qualified / Limited /
//     Not assured), with the evidence lines behind it.
//   • Strategic risk register (§5.3) — the critical / high governance risks + regulatory exposure.
//   • Governance effectiveness (§7.4) — approval throughput + change control + council coverage.
//   • Investment priorities (§5.4) — the improvement opportunities framed as leadership asks.
// Calls the registry ONCE (the sub-engines each re-run it, so it composes primitives directly instead). No migration.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;
const todayISO = () => new Date().toISOString().slice(0, 10);

const RATINGS = [
  { min: 80, label: "Assured", tone: "emerald", statement: "The competency governance system is operating effectively." },
  { min: 60, label: "Qualified assurance", tone: "amber", statement: "The system is broadly effective with identified gaps requiring action." },
  { min: 40, label: "Limited assurance", tone: "orange", statement: "Significant governance gaps require leadership intervention." },
  { min: 0, label: "Not yet assured", tone: "rose", statement: "The governance system cannot yet evidence competency assurance." },
];

export async function loadExecutiveAssurance(admin: Admin) {
  const reg: any = await loadGovernanceRegistry(admin).catch(() => ({ provisioned: false }));
  if (!reg.provisioned) return { provisioned: false as const };

  const today = todayISO();
  const recs = reg.records;
  const n = recs.length;
  const k = reg.kpis;

  const [accRes, crRes, comRes] = await Promise.all([
    admin.from("cmo_accreditations").select("compliance_status").limit(3000),
    admin.from("change_requests").select("status").limit(2000),
    admin.from("governance_committees").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const acc = (accRes.error ? [] : accRes.data ?? []) as any[];
  const crs = (crRes.error ? [] : crRes.data ?? []) as any[];
  const councils = comRes.error ? 0 : comRes.count ?? 0;

  const reviewOk = recs.filter((r: any) => r.reviewDue && !r.reviewOverdue).length;
  const reviewPct = n ? Math.round((reviewOk / n) * 100) : 0;
  const assurance = k.avgScore;
  const rating = RATINGS.find((r) => assurance >= r.min)!;

  // Strategic risk register — board-level: critical-risk competencies that are ungoverned/unowned/overdue.
  const strategic = recs
    .filter((r: any) => (r.risk === "critical" || r.risk === "high") && (r.state === "at_risk" || r.state === "ungoverned" || r.reviewOverdue))
    .slice(0, 8)
    .map((r: any) => {
      const why: string[] = [];
      if (!r.owner) why.push("no accountable owner");
      if (r.reviewOverdue) why.push("review overdue");
      if (r.standards === 0) why.push("no regulatory mapping");
      if (r.decisions === 0) why.push("no evidence");
      return { name: r.name, domain: r.domain, risk: r.risk, why: why.join(", ") || "governance incomplete" };
    });

  const accCompliant = acc.filter((a) => a.compliance_status === "compliant").length;
  const accReadiness = acc.length ? Math.round((accCompliant / acc.length) * 100) : null;
  const unmappedHighRisk = recs.filter((r: any) => r.standards === 0 && (r.risk === "high" || r.risk === "critical")).length;

  const crOpen = crs.filter((c) => c.status === "open").length;
  const crDone = crs.filter((c) => c.status === "approved" || c.status === "implemented").length;

  // Evidence lines behind the rating — what the board is being asked to rely on.
  const evidence = [
    { line: "Competencies under governance", value: `${n}`, ok: n > 0 },
    { line: "Accountable ownership", value: `${k.ownerPct}%`, ok: k.ownerPct >= 80 },
    { line: "Regulatory alignment", value: `${k.standardsPct}%`, ok: k.standardsPct >= 80 },
    { line: "Review currency", value: `${reviewPct}%`, ok: reviewPct >= 80 },
    { line: "Evidence-backed decisions", value: `${k.evidencePct}%`, ok: k.evidencePct >= 70 },
    { line: "Active governance councils", value: `${councils}`, ok: councils > 0 },
  ];

  // Investment priorities (§5.4) — leadership asks, volume-weighted.
  const invest: any[] = [];
  const unowned = recs.filter((r: any) => !r.owner).length;
  if (unowned) invest.push({ ask: "Assign competency ownership", detail: `${unowned} competencies lack an accountable owner`, lever: "Governance capacity" });
  if (k.overdue) invest.push({ ask: "Clear the review backlog", detail: `${k.overdue} reviews overdue — assessor/educator capacity`, lever: "Workforce investment" });
  if (unmappedHighRisk) invest.push({ ask: "Close regulatory exposure", detail: `${unmappedHighRisk} high-risk competencies unmapped to standards`, lever: "Regulatory risk" });
  const noEvid = recs.filter((r: any) => r.decisions === 0).length;
  if (noEvid) invest.push({ ask: "Strengthen evidence capture", detail: `${noEvid} competencies without supporting decisions`, lever: "Assurance" });

  return {
    provisioned: true as const,
    today,
    rating,
    assurance,
    evidence,
    capability: {
      competencies: n,
      total: reg.total,
      atRisk: reg.states.at_risk + reg.states.ungoverned,
      governed: reg.states.governed,
      highRisk: k.highRisk,
      overdue: k.overdue,
      reviewPct,
    },
    regulatory: { accReadiness, requirements: acc.length, unmappedHighRisk, alignment: k.standardsPct },
    effectiveness: { councils, changeOpen: crOpen, changeDone: crDone, changeTotal: crs.length },
    strategic,
    invest: invest.slice(0, 4),
  };
}
