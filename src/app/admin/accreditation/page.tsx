import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { qualityReport } from "@/lib/engines/quality";

const STATUS_UI = {
  pass: { icon: "✓", cls: "bg-green-50 text-green-700 border-green-100" },
  warn: { icon: "⚠", cls: "bg-amber-50 text-amber-700 border-amber-100" },
  fail: { icon: "✗", cls: "bg-red-50 text-red-600 border-red-100" },
} as const;

const FLAG_UI: Record<string, { label: string; cls: string }> = {
  consistent: { label: "Consistent", cls: "bg-green-100 text-green-700" },
  lenient:    { label: "Tends lenient", cls: "bg-amber-100 text-amber-700" },
  strict:     { label: "Tends strict", cls: "bg-blue-100 text-blue-700" },
};

export default async function AccreditationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const report = await qualityReport(admin, profile.hospital_id ?? "");
  const scoreColor = report.score >= 85 ? "text-green-600" : report.score >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Accreditation &amp; Quality</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Accreditation readiness checks and assessor consistency monitoring (Book III Ch.5 &amp; 11).
        </p>
      </div>

      {/* Readiness headline */}
      <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 mb-6 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Accreditation Readiness</p>
          <p className={`text-4xl font-bold ${scoreColor}`}>{report.score}%</p>
        </div>
        <div className="text-right text-xs text-gray-400">
          <p>{report.checks.filter(c => c.status === "pass").length} passing</p>
          <p>{report.checks.filter(c => c.status === "warn").length} warnings</p>
          <p>{report.checks.filter(c => c.status === "fail").length} failing</p>
        </div>
      </div>

      {/* Checks */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Readiness Checks</h2>
      <div className="flex flex-col gap-2 mb-8">
        {report.checks.map(c => {
          const ui = STATUS_UI[c.status];
          return (
            <div key={c.label} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${ui.cls}`}>
              <span className="text-lg font-bold w-6 text-center shrink-0">{ui.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold">{c.label}</p>
                <p className="text-xs opacity-80">{c.detail}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Assessor consistency */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
        Assessor Consistency{report.overallAvg != null && <span className="normal-case font-normal"> — hospital mean score {report.overallAvg}</span>}
      </h2>
      {report.assessors.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm">Not enough assessment data yet — assessors appear here once they have 3+ completed scored assessments.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assessor</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assessments</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Avg Score</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">vs Mean</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Pattern</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {report.assessors.map(a => {
                const flag = FLAG_UI[a.flag];
                return (
                  <tr key={a.id} className="hover:bg-gray-50/40">
                    <td className="px-5 py-3 font-medium text-gray-800 text-xs">{a.name}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-600">{a.count}</td>
                    <td className="px-4 py-3 text-center text-sm font-bold text-gray-800">{a.avg}</td>
                    <td className={`px-4 py-3 text-center text-xs font-semibold ${a.delta > 0 ? "text-amber-600" : a.delta < 0 ? "text-blue-600" : "text-gray-400"}`}>
                      {a.delta > 0 ? "+" : ""}{a.delta}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${flag.cls}`}>{flag.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-5 py-3 text-[10px] text-gray-400 border-t border-gray-50">
            Assessors deviating by more than ±0.75 from the hospital mean may benefit from calibration. Use this for assessor development, not performance management.
          </p>
        </div>
      )}
    </div>
  );
}
