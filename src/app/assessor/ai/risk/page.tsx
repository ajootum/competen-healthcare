import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, riskBuckets } from "@/lib/analytics";
import { StatTiles, Card } from "../../reports/ui";
import { AiHeader } from "../ui";
import AskAi from "../AskAi";

// Risk Engine — every flag is DERIVED from decision records (critical
// failures, failed/expired competencies, overdue sessions). Deliberately not
// predictive ML; the page says exactly where each flag comes from.

export const dynamic = "force-dynamic";

export default async function RiskEnginePage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));

  const flagged = [...risk.byNurse.entries()]
    .map(([id, level]) => {
      const mine = ctx.latest.filter(d => d.nurse_id === id);
      return {
        id, level,
        name: nameOf.get(id) ?? "—",
        dept: deptOf.get(id) ?? "General",
        critical: mine.filter(d => d.critical).length,
        failed: mine.filter(d => !d.passing).length,
        expired: mine.filter(d => d.expired).length,
      };
    })
    .sort((a, b) => (a.level === "high" ? 0 : 1) - (b.level === "high" ? 0 : 1) || b.critical - a.critical)
    .slice(0, 12);

  const overdue = ctx.sched.filter(s => s.status === "scheduled" && s.scheduled_for < new Date().toISOString()).length;
  const expiredNow = ctx.latest.filter(d => d.expired).length;
  const in30 = new Date(new Date().getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const expiring30 = ctx.latest.filter(d => d.passing && !d.expired && d.expiry_date && d.expiry_date <= in30).length;

  return (
    <div className="max-w-4xl">
      <AiHeader icon="📡" title="Risk Engine" sub="Risk flags derived from decision records — traceable to specific failures and expiries, not predictions." />
      <StatTiles tiles={[
        { label: "High-Risk Learners", value: String(risk.high), sub: "critical failure on record", alert: risk.high > 0 },
        { label: "Medium Risk", value: String(risk.medium), sub: "failed or expired competencies" },
        { label: "Expiring (30d)", value: String(expiring30), alert: expiring30 > 0 },
        { label: "Reassessments Overdue", value: String(overdue + expiredNow), sub: `${expiredNow} expired · ${overdue} past-due sessions`, alert: overdue + expiredNow > 0 },
      ]} />

      <Card title="Flagged Learners" sub="why each flag exists">
        {flagged.length ? (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                <th className="pb-1.5">Learner</th><th className="pb-1.5">Department</th>
                <th className="pb-1.5 text-center">Critical</th><th className="pb-1.5 text-center">Failed</th>
                <th className="pb-1.5 text-center">Expired</th><th className="pb-1.5 text-center">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {flagged.map(f => (
                <tr key={f.id}>
                  <td className="py-1.5 text-gray-800 font-medium">{f.name}</td>
                  <td className="py-1.5 text-gray-500">{f.dept}</td>
                  <td className="py-1.5 text-center">{f.critical ? <span className="font-bold text-red-600">{f.critical}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="py-1.5 text-center text-gray-600">{f.failed}</td>
                  <td className="py-1.5 text-center text-gray-600">{f.expired}</td>
                  <td className="py-1.5 text-center">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${f.level === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{f.level}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-xs text-gray-400">No learners carry risk flags. ✅</p>}
      </Card>

      <div className="mt-4">
        <Card title="AI Risk Commentary" sub="Claude, grounded in the flags above">
          <AskAi endpoint="/api/ai/insights" body={{ scope: "risk" }} label="Analyse risk position" />
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Every flag traces to a real record (critical failure, non-passing decision, expiry, or missed session). Predictive failure modelling would need
        outcome history at scale and is intentionally not simulated. Interventions live in{" "}
        <Link href="/assessor/remediation" className="text-indigo-500 hover:underline">Risk &amp; Remediation</Link>.
      </p>
    </div>
  );
}
