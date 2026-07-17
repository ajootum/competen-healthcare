import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CPDClient from "./CPDClient";

// CPD Log — professional development portfolio (Volume 3 CPD spec).
// Every figure derives from the real cpd_logs record and CPD credentials.
// No invented annual target, streaks, badges or AI predictions — those need
// stores (cpd_targets, cpd_badges…) that don't exist yet.

const CATEGORY_UI: Record<string, { label: string; icon: string }> = {
  course: { label: "Formal Courses", icon: "🎓" },
  workshop: { label: "Workshops", icon: "🔧" },
  conference: { label: "Conferences", icon: "🎤" },
  self_study: { label: "Self Learning", icon: "📖" },
  simulation: { label: "Simulation", icon: "🏥" },
  osce: { label: "OSCE", icon: "📋" },
  teaching: { label: "Teaching", icon: "🧑‍🏫" },
  research: { label: "Research", icon: "🔬" },
};

export default async function CPDPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: logs }, { data: cpdCerts }, { data: enrollments }] = await Promise.all([
    admin.from("cpd_logs").select("*").eq("user_id", user.id).order("activity_date", { ascending: false }),
    admin.from("professional_credentials").select("id").eq("nurse_id", user.id).eq("credential_type", "cpd_certificate"),
    admin.from("course_enrollments").select("completed_at").eq("user_id", user.id).not("completed_at", "is", null),
  ]);

  const all = logs ?? [];
  const year = new Date().getFullYear();
  const thisYear = all.filter(l => l.activity_date?.startsWith(String(year)));
  const thisMonth = all.filter(l => l.activity_date?.slice(0, 7) === new Date().toISOString().slice(0, 7));
  const sum = (rows: typeof all) => Math.round(rows.reduce((s, l) => s + Number(l.hours), 0) * 10) / 10;

  const totalYear = sum(thisYear);
  const lifetime = sum(all);
  const verifiedHours = sum(thisYear.filter(l => l.verified));
  const pendingHours = Math.round((totalYear - verifiedHours) * 10) / 10;
  const points = all.reduce((s, l) => s + (l.cpd_points ?? 0), 0);

  // Category breakdown (this year)
  const byCat = new Map<string, number>();
  for (const l of thisYear) byCat.set(l.activity_type, (byCat.get(l.activity_type) ?? 0) + Number(l.hours));
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

  // Hours by month (last 6 months with data)
  const byMonth = new Map<string, number>();
  for (const l of all) if (l.activity_date) byMonth.set(l.activity_date.slice(0, 7), (byMonth.get(l.activity_date.slice(0, 7)) ?? 0) + Number(l.hours));
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
  const maxMonth = Math.max(...months.map(m => m[1]), 1);
  const monthsActive = byMonth.size;
  const avgPerMonth = monthsActive ? Math.round((lifetime / monthsActive) * 10) / 10 : 0;

  const card = "bg-white rounded-xl border border-gray-100";

  const KPI = [
    { label: "Hours This Year", value: totalYear, sub: `${lifetime} lifetime`, color: "text-gray-900" },
    { label: "Verified Hours", value: verifiedHours, sub: "confirmed by your organisation", color: "text-green-600" },
    { label: "Pending Verification", value: pendingHours, sub: "awaiting review", color: pendingHours ? "text-amber-600" : "text-gray-400" },
    { label: "CPD Points", value: points, sub: "from logged activities", color: "text-violet-600" },
    { label: "Certificates", value: (cpdCerts ?? []).length + (enrollments ?? []).length, sub: "CPD certificates & courses", color: "text-blue-600" },
    { label: "This Month", value: thisMonth.length, sub: `activit${thisMonth.length === 1 ? "y" : "ies"} · avg ${avgPerMonth}h/mo`, color: "text-teal-700" },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">CPD Log</h1>
        <p className="text-gray-400 text-sm mt-0.5">Continuing Professional Development — track, manage and grow your learning journey.</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        {/* Hours by month */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Hours by Month</h2>
          <p className="text-[10px] text-gray-400 mb-3">Your logged CPD over time.</p>
          {months.length ? (
            <div className="flex items-end gap-2 h-28">
              {months.map(([m, v]) => (
                <div key={m} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500 font-bold">{Math.round(v * 10) / 10}h</span>
                  <div className="w-full bg-teal-500 rounded-t" style={{ height: `${Math.max((v / maxMonth) * 80, 4)}px` }} />
                  <span className="text-[8px] text-gray-400">{m.slice(5)}/{m.slice(2, 4)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-8">Log your first activity to start the chart. 📊</p>}
        </div>

        {/* Categories */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Activity Categories</h2>
          <p className="text-[10px] text-gray-400 mb-3">Where your hours went this year.</p>
          {cats.length ? (
            <div className="flex flex-col gap-2">
              {cats.map(([type, hrs]) => {
                const ui = CATEGORY_UI[type] ?? { label: type, icon: "📘" };
                const pct = totalYear ? Math.round((hrs / totalYear) * 100) : 0;
                return (
                  <div key={type} className="flex items-center gap-2.5">
                    <span className="text-sm w-5">{ui.icon}</span>
                    <span className="text-[11px] text-gray-700 w-28 truncate">{ui.label}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-gray-600 w-14 text-right">{Math.round(hrs * 10) / 10}h · {pct}%</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-gray-400 text-center py-8">Categories appear as you log activities. 🎓</p>}
        </div>
      </div>

      {/* Log form + activity list (existing working client) */}
      <CPDClient initialLogs={all} totalHours={lifetime} />

      <div className="mt-5 grid md:grid-cols-2 gap-4">
        <div className="bg-teal-50 border border-teal-100 rounded-xl px-5 py-4 flex items-center gap-3">
          <span className="text-xl">🎓</span>
          <p className="text-[12px] text-teal-900 flex-1">
            Completing <Link href="/dashboard/courses" className="font-semibold hover:underline">CPD Academy courses</Link> earns
            credits automatically — log external activities here.
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl px-5 py-4 flex items-center gap-3">
          <span className="text-xl">🛡️</span>
          <p className="text-[12px] text-gray-600 flex-1">
            Verified hours are confirmed by your organisation and appear on your{" "}
            <Link href="/dashboard/passport" className="font-semibold text-teal-700 hover:underline">Competency Passport</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
