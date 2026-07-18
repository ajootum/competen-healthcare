import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// My Analytics (Sidebar Redesign spec §Analytics): the assessor's own real
// numbers — volume, scores, methods, monthly trend and turnaround. Pass rates
// use the Benner threshold (score ≥ 3 = competent). Calibration metrics need
// multi-assessor comparison data that isn't tracked yet — omitted.

const METHOD_LABELS: Record<string, string> = {
  knowledge: "Knowledge", direct_observation: "Direct Observation", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Chart Audit", logbook: "Logbook",
};
const SCORE_LABELS = ["0 · Training", "1 · Novice", "2 · Adv. Beginner", "3 · Competent", "4 · Competent+", "5 · Proficient", "6 · Expert"];

export default async function AssessorAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const { data: mine } = await admin.from("assessments")
    .select("id, status, score, method, assessed_at, created_at")
    .eq("assessor_id", user.id);

  const all = mine ?? [];
  const done = all.filter(a => a.status === "complete");
  const scored = done.filter(a => a.score !== null) as { score: number; method: string; assessed_at: string | null; created_at: string }[];
  const avgScore = scored.length ? scored.reduce((s, a) => s + a.score, 0) / scored.length : null;
  const passRate = scored.length ? Math.round((scored.filter(a => a.score >= 3).length / scored.length) * 100) : null;
  const turnarounds = done
    .filter(a => a.assessed_at && a.created_at)
    .map(a => (new Date(a.assessed_at!).getTime() - new Date(a.created_at).getTime()) / 86400000)
    .filter(d => d >= 0);
  const avgTurnaround = turnarounds.length
    ? Math.round((turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length) * 10) / 10 : null;

  // By method
  const byMethod = new Map<string, number>();
  for (const a of done) byMethod.set(a.method, (byMethod.get(a.method) ?? 0) + 1);
  const methodRows = [...byMethod.entries()].sort((a, b) => b[1] - a[1]);
  const methodMax = Math.max(1, ...methodRows.map(([, n]) => n));

  // Last 6 months
  const months: { key: string; label: string; n: number }[] = [];
  const d = new Date(); d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d); m.setMonth(m.getMonth() - i);
    const key = m.toISOString().slice(0, 7);
    months.push({ key, label: m.toLocaleDateString(undefined, { month: "short" }), n: 0 });
  }
  for (const a of done) {
    const k = a.assessed_at?.slice(0, 7);
    const m = months.find(x => x.key === k);
    if (m) m.n++;
  }
  const monthMax = Math.max(1, ...months.map(m => m.n));

  // Score distribution 0–6
  const dist = Array.from({ length: 7 }, (_, i) => scored.filter(a => a.score === i).length);
  const distMax = Math.max(1, ...dist);

  const KPIS = [
    { label: "Assessments Completed", value: String(done.length), sub: "all time", icon: "✅" },
    { label: "Average Score", value: avgScore !== null ? avgScore.toFixed(1) : "—", sub: "Benner 0–6", icon: "🎯" },
    { label: "Pass Rate", value: passRate !== null ? `${passRate}%` : "—", sub: "score ≥ 3 (Competent)", icon: "📈" },
    { label: "Avg Turnaround", value: avgTurnaround !== null ? `${avgTurnaround}d` : "—", sub: "assignment → scored", icon: "⏱️" },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Analytics</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Your assessment volume, scoring profile and turnaround — computed live from your records.
          </p>
        </div>
        {done.length > 0 && (
          <a href="/api/reports/analytics"
            className="text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">
            ⬇ Export CSV
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {KPIS.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className="text-lg">{k.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 mt-1.5 leading-none">{k.value}</p>
            <p className="text-[11px] font-semibold text-gray-700 mt-1">{k.label}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {done.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-sm font-semibold text-gray-700">No completed assessments yet</p>
          <p className="text-xs text-gray-400 mt-1">Your analytics build up as you score assessments.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Monthly volume */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Completed per Month</h2>
            <div className="flex items-end gap-2 h-32">
              {months.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-gray-600">{m.n || ""}</span>
                  <div className="w-full bg-indigo-500/80 rounded-t-md" style={{ height: `${(m.n / monthMax) * 100}%`, minHeight: m.n ? 4 : 1 }} />
                  <span className="text-[9px] text-gray-400">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Score distribution */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Score Distribution</h2>
            <div className="flex flex-col gap-1.5">
              {dist.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-28 shrink-0">{SCORE_LABELS[i]}</span>
                  <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${i >= 3 ? "bg-teal-500" : "bg-amber-400"}`} style={{ width: `${(n / distMax) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-semibold text-gray-600 w-5 text-right shrink-0">{n || ""}</span>
                </div>
              ))}
            </div>
          </div>

          {/* By method */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Assessments by Method</h2>
            <div className="flex flex-col gap-2">
              {methodRows.map(([method, n]) => (
                <div key={method} className="flex items-center gap-3">
                  <span className="text-[11px] text-gray-500 w-36 shrink-0">{METHOD_LABELS[method] ?? method}</span>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(n / methodMax) * 100}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-gray-700 w-8 text-right shrink-0">{n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-300 mt-5">
        Assessor calibration metrics (agreement with co-assessors) need multi-assessor data that isn&apos;t tracked yet.
      </p>
    </div>
  );
}
