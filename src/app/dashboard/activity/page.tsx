import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadActivityAnalytics, ACT_CAT } from "@/lib/activity-analytics";
import { cardClass } from "@/components/ui/primitives";

// PW-013 Activity Timeline & Productivity Analytics — unified activity timeline + productivity metrics over the
// user's real audit_log + derived record activity. Server-rendered, read-only. Reports real activity counts and
// a derived productivity score; focus/productive-minute durations (no backing store) are intentionally omitted.
export const dynamic = "force-dynamic";

const CAT_CHIP: Record<string, string> = { "Patient Care": "bg-blue-50 text-blue-700", "Learning & Development": "bg-violet-50 text-violet-700", "Documentation": "bg-amber-50 text-amber-700", "Communication": "bg-sky-50 text-sky-700", "Competency": "bg-emerald-50 text-emerald-700", "Administration": "bg-slate-50 text-slate-600" };
const CAT_ICON: Record<string, string> = { "Patient Care": "👥", "Learning & Development": "📚", "Documentation": "📄", "Communication": "💬", "Competency": "🎯", "Administration": "⚙️" };
const fmtTime = (t: string) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (d: string) => { const t = new Date(d + "T00:00:00"); const today = new Date().toISOString().slice(0, 10); const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10); if (d === today) return "Today"; if (d === yest) return "Yesterday"; return t.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); };

function Kpi({ icon, label, value, sub, tint }: { icon: string; label: string; value: string | number; sub: string; tint: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900 mt-2">{value}</p>
      <p className="text-[11px] font-medium text-gray-700 leading-tight">{label}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}

export default async function ActivityAnalyticsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();

  const d = await loadActivityAnalytics(admin, user.id, profile);

  // Category donut geometry.
  const catTotal = d.byCategory.reduce((s: number, c: any) => s + c.n, 0) || 1; // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = 46, C = 2 * Math.PI * R;
  const catSegs = d.byCategory.map((c: any, i: number) => ({ ...c, len: (c.n / catTotal) * C, offset: d.byCategory.slice(0, i).reduce((s: number, x: any) => s + (x.n / catTotal) * C, 0) })); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Trend polyline.
  const maxN = Math.max(1, ...d.trend.map((t: any) => t.n)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const TW = 280, TH = 70;
  const pts = d.trend.map((t: any, i: number) => `${(i / (d.trend.length - 1)) * TW},${TH - (t.n / maxN) * (TH - 8)}`).join(" "); // eslint-disable-line @typescript-eslint/no-explicit-any

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Activity Timeline &amp; Productivity Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track your activity, time usage and productivity to improve your performance and outcomes.</p>
        </div>
        <span className="text-[12px] font-medium text-gray-500 border border-gray-200 rounded-lg px-3 py-2">Last 30 days</span>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon="📊" label="Total Activities" value={d.kpis.total} sub="Last 30 days" tint="bg-blue-50" />
        <Kpi icon="✅" label="Tasks Completed" value={d.kpis.tasksCompleted} sub="Completed" tint="bg-emerald-50" />
        <Kpi icon="📚" label="Learning Activity" value={d.kpis.learning} sub="Learning events" tint="bg-violet-50" />
        <Kpi icon="📄" label="Documentation" value={d.kpis.documentation} sub="Doc actions" tint="bg-amber-50" />
        <Kpi icon="💬" label="Communication" value={d.kpis.communication} sub="Messages" tint="bg-sky-50" />
        <Kpi icon="⭐" label="Productivity" value={`${d.kpis.productivity}%`} sub={d.kpis.productivity >= 70 ? "Excellent" : "Improving"} tint="bg-cyan-50" />
        <Kpi icon="🔥" label="Active Days" value={d.kpis.activeDays} sub="of 30" tint="bg-rose-50" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        {/* Activity timeline */}
        <div className={cardClass}>
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Activity Timeline</h2>
          {d.timeline.length > 0 ? (
            <div className="space-y-5">
              {d.timeline.map((g: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={g.day}>
                  <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">{dayLabel(g.day)}</p>
                  <div className="space-y-2 border-l-2 border-gray-100 pl-4">
                    {g.evs.map((e: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                      <div key={i} className="relative flex items-start gap-3">
                        <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-white border-2" style={{ borderColor: ACT_CAT[e.category]?.color ?? "#94a3b8" }} />
                        <span className="text-[11px] text-gray-400 w-14 shrink-0 pt-0.5">{fmtTime(e.at)}</span>
                        <span className="text-base shrink-0">{CAT_ICON[e.category] ?? "•"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-800 leading-tight">{e.title}</p>
                          {e.subtitle && <p className="text-[11px] text-gray-500 truncate">{e.subtitle}</p>}
                        </div>
                        <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0 ${CAT_CHIP[e.category] ?? "bg-gray-100 text-gray-500"}`}>{e.category.split(" ")[0]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-16 text-center">No recorded activity in the last 30 days.</p>}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {/* Category donut */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Activity by Category</h3>
            {d.byCategory.length > 0 ? (
              <div className="flex items-center gap-4">
                <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
                  <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
                  {catSegs.map((c: any, i: number) => <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={c.color} strokeWidth="14" strokeDasharray={`${c.len} ${C - c.len}`} strokeDashoffset={-c.offset} transform="rotate(-90 60 60)" />) /* eslint-disable-line @typescript-eslint/no-explicit-any */}
                  <text x="60" y="56" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="18">{d.total}</text>
                  <text x="60" y="72" textAnchor="middle" className="fill-gray-400" fontSize="8">Total</text>
                </svg>
                <div className="space-y-1 text-[11px] flex-1">
                  {d.byCategory.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <div key={c.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-gray-600 truncate flex-1">{c.label}</span><span className="font-semibold text-gray-900">{c.pct}%</span></div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No activity yet.</p>}
          </div>

          {/* Productivity trend */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Activity Trend</h3>
            <p className="text-[10px] text-gray-400 mb-2">Daily activity volume, last 7 days</p>
            <svg width="100%" viewBox={`0 0 ${TW} ${TH + 16}`} className="overflow-visible">
              <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="2" />
              {d.trend.map((t: any, i: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const x = (i / (d.trend.length - 1)) * TW, y = TH - (t.n / maxN) * (TH - 8);
                return <g key={i}><circle cx={x} cy={y} r="2.5" fill="#3b82f6" /><text x={x} y={TH + 12} textAnchor="middle" fontSize="8" className="fill-gray-400">{t.label}</text></g>;
              })}
            </svg>
          </div>

          {/* Goals */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Goals &amp; Targets</h3>
            <div className="space-y-2.5">
              {d.goals.map((g: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={g.label}>
                  <div className="flex items-center justify-between text-[11px] mb-1"><span className="text-gray-600">{g.label}</span><span className="font-semibold text-gray-800">{g.current}/{g.target}</span></div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${g.pct}%` }} /></div>
                </div>
              ))}
            </div>
          </div>

          {/* Achievements */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Achievements</h3>
            {d.achievements.length > 0 ? (
              <div className="space-y-2">
                {d.achievements.map((a: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={i} className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">🏆</span><div><p className="text-[12px] font-medium text-gray-800">{a.label}</p><p className="text-[10px] text-gray-400">{a.at}</p></div></div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 py-3 text-center">Keep going — achievements unlock with activity.</p>}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Activity by Module</h3>
          {d.byModule.length > 0 ? (
            <div className="space-y-2.5">
              {d.byModule.map((m: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={m.label}>
                  <div className="flex items-center justify-between text-[12px] mb-1"><span className="text-gray-600 capitalize">{m.label}</span><span className="font-semibold text-gray-800">{m.n} · {m.pct}%</span></div>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${m.pct}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-4 text-center">No module activity yet.</p>}
        </div>

        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Activities</h3>
          {d.topActivities.length > 0 ? (
            <div className="space-y-2">
              {d.topActivities.map((t: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={t.title} className="flex items-center gap-3"><span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span><span className="flex-1 text-[13px] text-gray-700 capitalize">{t.title}</span><span className="text-[12px] font-semibold text-gray-900">{t.n}×</span></div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 py-4 text-center">No activity yet.</p>}
        </div>

        <div className={cardClass}>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Productivity Insights</h3>
          <div className="space-y-2.5">
            {d.insights.map((ins: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <div key={i} className="flex gap-2 text-[12px] text-gray-600"><span className="text-blue-500 shrink-0">✦</span><span>{ins}</span></div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Timeline aggregates your real audit log + record activity. Productivity score is derived from real task completion + activity consistency; focus/productive-minute durations aren&apos;t tracked and are omitted honestly.</p>
    </div>
  );
}
