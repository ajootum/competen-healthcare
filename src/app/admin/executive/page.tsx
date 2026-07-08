import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { workforceReport } from "@/lib/engines/workforce";
import { qualityReport } from "@/lib/engines/quality";
import { indicatorStatus } from "@/lib/ckcm";

// Executive Command Center — the spec's "Enterprise Nursing Intelligence Center":
// one Nursing Capability Index built from four domains, each traceable to the
// governed data underneath it.

function band(v: number) {
  return v >= 85 ? { cls: "text-green-600", bar: "bg-green-500" }
       : v >= 60 ? { cls: "text-amber-600", bar: "bg-amber-500" }
       : { cls: "text-red-600", bar: "bg-red-500" };
}

export default async function ExecutivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");
  const hospitalId = profile.hospital_id ?? "";

  const [wf, qr, { data: workers }, { data: credentials }, { data: recognitions }, { data: qIndicators }, { data: qMeas }, { data: improvements }] =
    await Promise.all([
      workforceReport(admin, hospitalId),
      qualityReport(admin, hospitalId),
      admin.from("profiles").select("id").eq("hospital_id", hospitalId).eq("role", "nurse"),
      admin.from("professional_credentials").select("verified, status").eq("hospital_id", hospitalId),
      admin.from("professional_recognitions").select("recognition_type").eq("hospital_id", hospitalId),
      admin.from("quality_indicators").select("id, direction, target_value, escalation_value").eq("is_active", true),
      admin.from("indicator_measurements").select("indicator_id, value, period").order("period", { ascending: false }),
      admin.from("improvement_objects").select("status"),
    ]);

  // ── Domain 1: Workforce Capability ──
  const workerCount = (workers ?? []).length;
  const totalDecisions = wf.totalDecisions;
  const overallReadiness = wf.deptReadiness.length
    ? Math.round(wf.deptReadiness.reduce((s, d) => s + d.readiness * d.workers, 0) / Math.max(wf.deptReadiness.reduce((s, d) => s + d.workers, 0), 1))
    : 0;
  const workforceScore = overallReadiness;

  // ── Domain 2: Clinical Practice (assessment currency) ──
  const riskCount = wf.risk.expired + wf.risk.criticalFailures + wf.risk.notYetCompetent + wf.risk.remediation;
  const practiceScore = totalDecisions
    ? Math.max(0, Math.round(100 - (riskCount / totalDecisions) * 100 - (wf.risk.dueSoon / Math.max(totalDecisions, 1)) * 20))
    : 0;

  // ── Domain 3: Quality & Safety ──
  const latestVal = new Map<string, number>();
  for (const m of qMeas ?? []) if (!latestVal.has(m.indicator_id)) latestVal.set(m.indicator_id, Number(m.value));
  const indStatuses = (qIndicators ?? []).filter(i => i.target_value != null).map(i =>
    indicatorStatus(latestVal.get(i.id) ?? null, Number(i.target_value),
      i.escalation_value == null ? null : Number(i.escalation_value), i.direction));
  const indicatorScore = indStatuses.length
    ? Math.round((indStatuses.filter(s => s === "on_target").length / indStatuses.length) * 100)
    : null;
  const qualityScore = indicatorScore != null ? Math.round((qr.score + indicatorScore) / 2) : qr.score;

  // ── Domain 4: Leadership & Sustainability ──
  const creds = credentials ?? [];
  const credScore = creds.length ? Math.round((creds.filter(c => c.verified && c.status === "active").length / creds.length) * 100) : 0;
  const preceptors = (recognitions ?? []).filter(r => ["preceptor", "mentor"].includes(r.recognition_type)).length;
  const preceptorScore = workerCount ? Math.min(Math.round((preceptors / Math.max(workerCount * 0.2, 1)) * 100), 100) : 0;
  const activeImprovements = (improvements ?? []).filter(i => ["active", "measuring", "planning"].includes(i.status)).length;
  const sustainScore = Math.round(credScore * 0.6 + preceptorScore * 0.2 + Math.min(activeImprovements * 20, 100) * 0.2);

  const domains = [
    { name: "Workforce Capability", score: workforceScore, detail: `${overallReadiness}% competency readiness across ${wf.deptReadiness.length} department${wf.deptReadiness.length !== 1 ? "s" : ""}`, href: "/admin/workforce" },
    { name: "Clinical Practice", score: practiceScore, detail: `${totalDecisions} decisions · ${riskCount} at risk · ${wf.risk.dueSoon} due ≤60d`, href: "/admin/intelligence" },
    { name: "Quality & Safety", score: qualityScore, detail: `Accreditation ${qr.score}%${indicatorScore != null ? ` · indicators ${indicatorScore}% on target` : ""}`, href: "/admin/quality" },
    { name: "Leadership & Sustainability", score: sustainScore, detail: `${credScore}% credentials current · ${preceptors} preceptor${preceptors !== 1 ? "s" : ""}/mentor${preceptors !== 1 ? "s" : ""} · ${activeImprovements} active improvement${activeImprovements !== 1 ? "s" : ""}`, href: "/admin/accreditation" },
  ];
  const nci = Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length);
  const nciBand = band(nci);

  // Alerts — what needs executive attention now
  const alerts: { icon: string; text: string; href: string }[] = [];
  if (wf.risk.expired > 0) alerts.push({ icon: "🔴", text: `${wf.risk.expired} expired competency decision${wf.risk.expired !== 1 ? "s" : ""} awaiting reassessment`, href: "/admin/workforce" });
  if (wf.risk.criticalFailures > 0) alerts.push({ icon: "⛔", text: `${wf.risk.criticalFailures} critical failure${wf.risk.criticalFailures !== 1 ? "s" : ""} recorded`, href: "/admin/workforce" });
  if (indStatuses.some(s => s === "breach")) alerts.push({ icon: "🚨", text: "Quality indicator breaching escalation threshold", href: "/admin/quality" });
  if (wf.forecast.d30 > 0) alerts.push({ icon: "⏰", text: `${wf.forecast.d30} reassessment${wf.forecast.d30 !== 1 ? "s" : ""} due within 30 days`, href: "/admin/intelligence" });
  for (const c of qr.checks.filter(c => c.status === "fail").slice(0, 3)) {
    alerts.push({ icon: "⚠️", text: `${c.label}: ${c.detail}`, href: "/admin/accreditation" });
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Executive Command Center</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          One evidence-based view of nursing service health — readable in under 30 seconds.
        </p>
      </div>

      {/* Nursing Capability Index */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-6">
          <div className="text-center shrink-0">
            <p className={`text-5xl font-bold ${nciBand.cls}`}>{nci}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Nursing Capability<br />Index</p>
          </div>
          <div className="flex-1 flex flex-col gap-3">
            {domains.map(d => {
              const b = band(d.score);
              return (
                <Link key={d.name} href={d.href} className="group">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-700 w-56 shrink-0 group-hover:text-teal-700">{d.name}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${b.bar}`} style={{ width: `${Math.max(d.score, 2)}%` }} />
                    </div>
                    <span className={`text-sm font-bold w-10 text-right ${b.cls}`}>{d.score}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 ml-0 mt-0.5">{d.detail}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Executive alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Needs Executive Attention</h2>
          {alerts.length === 0 ? (
            <div className="bg-white rounded-xl border border-green-100 p-6 text-sm text-green-700">
              ✅ No high-priority alerts — all governed indicators within tolerance.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
              {alerts.map((a, i) => (
                <Link key={i} href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/50 transition-colors">
                  <span>{a.icon}</span>
                  <span className="text-sm text-gray-700 flex-1">{a.text}</span>
                  <span className="text-gray-300">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Department Readiness</h2>
          {wf.deptReadiness.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-gray-400">No departments with assessed workers yet.</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
              {wf.deptReadiness.map(d => {
                const b = band(d.readiness);
                return (
                  <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-sm text-gray-700 flex-1">{d.name}</span>
                    <span className="text-[10px] text-gray-400">{d.workers} worker{d.workers !== 1 ? "s" : ""}</span>
                    <span className={`text-sm font-bold ${b.cls}`}>{d.readiness}%</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "≤30 days", value: wf.forecast.d30 },
              { label: "31–60 days", value: wf.forecast.d60 },
              { label: "61–90 days", value: wf.forecast.d90 },
            ].map(f => (
              <div key={f.label} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                <p className="text-lg font-bold text-gray-800">{f.value}</p>
                <p className="text-[10px] text-gray-400">reassessments {f.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-6">
        Every number traces to governed records — click a domain to drill into the underlying data.
      </p>
    </div>
  );
}
