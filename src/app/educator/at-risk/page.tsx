import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, riskBuckets } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// At-Risk Learners — classification derived from decision records with the
// reason for every flag and a rule-derived recommended action. Levels:
// Critical (critical failure), High (multiple fails/expiries), Moderate
// (single fail or expiry), Low (clear). No predictive scoring.

export const dynamic = "force-dynamic";

export default async function AtRiskLearnersPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));

  const rows = [...risk.byNurse.keys()].map(id => {
    const mine = ctx.latest.filter(d => d.nurse_id === id);
    const critical = mine.filter(d => d.critical).length;
    const failed = mine.filter(d => !d.passing && !d.critical).length;
    const expired = mine.filter(d => d.expired).length;
    const issues = critical + failed + expired;
    const level = critical > 0 ? "critical" : issues >= 3 ? "high" : issues >= 2 ? "high" : issues === 1 ? "moderate" : "low";
    const reasons = [
      critical ? `${critical} critical failure${critical === 1 ? "" : "s"}` : null,
      failed ? `${failed} failed competenc${failed === 1 ? "y" : "ies"}` : null,
      expired ? `${expired} expired` : null,
    ].filter(Boolean).join(" · ");
    const action = critical
      ? { label: "Review profile & plan remediation", href: `/educator/profiles?n=${id}` }
      : expired && !failed
        ? { label: "Schedule reassessment", href: "/assessor/calendar" }
        : { label: "Generate AI learning plan", href: `/educator/profiles?n=${id}` };
    return { id, name: nameOf.get(id) ?? "—", dept: deptOf.get(id) ?? "General", level, reasons, action, issues };
  }).sort((a, b) => b.issues - a.issues);

  const LEVEL_CLS: Record<string, string> = {
    critical: "bg-red-600 text-white", high: "bg-red-100 text-red-700",
    moderate: "bg-amber-100 text-amber-700", low: "bg-green-100 text-green-700",
  };

  return (
    <div className="max-w-4xl">
      <EduHeader icon="⚠️" title="At-Risk Learners" sub="Risk classification from decision records — every flag names its reason and a recommended action." />
      <StatTiles tiles={[
        { label: "Critical", value: String(rows.filter(r => r.level === "critical").length), alert: rows.some(r => r.level === "critical") },
        { label: "High", value: String(rows.filter(r => r.level === "high").length) },
        { label: "Moderate", value: String(rows.filter(r => r.level === "moderate").length) },
        { label: "Clear", value: String(risk.low), sub: `of ${ctx.nurses.length} learners` },
      ]} />

      <Card title="Flagged Learners" sub="most issues first">
        {rows.length ? (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${LEVEL_CLS[r.level]}`}>{r.level}</span>
                  <Link href={`/educator/profiles?n=${r.id}`} className="text-xs font-semibold text-gray-800 hover:text-purple-700">{r.name}</Link>
                  <span className="text-[10px] text-gray-400">{r.dept}</span>
                  <span className="flex-1" />
                  <Link href={r.action.href} className="text-[10px] font-semibold text-purple-600 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 transition-colors">
                    {r.action.label} →
                  </Link>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Why: {r.reasons}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No learners carry risk flags. ✅</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Classification rules: Critical = any critical failure on record; High = 2+ open issues; Moderate = 1 issue; issues = failed, expired or
        critical latest decisions. Recommended actions are rule-derived, not predictions.
      </p>
    </div>
  );
}
