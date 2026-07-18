import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ScheduleForm, { type NurseOpt } from "./ScheduleForm";
import SessionActions from "./SessionActions";

// Assessment Calendar (Assessor Workspace redesign): real scheduled sessions
// from the scheduled_assessments store (migration 030) on a month grid, with
// scheduling and cancel/complete actions. Renders empty until the migration
// is applied.

const METHOD_LABELS: Record<string, string> = {
  direct_observation: "Direct Observation", knowledge: "Knowledge", simulation: "Simulation",
  osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Chart Audit", logbook: "Logbook",
};

export default async function AssessmentCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  // Month window (?month=YYYY-MM, defaults to current)
  const base = /^\d{4}-\d{2}$/.test(month ?? "") ? new Date(`${month}-01T00:00:00`) : new Date();
  base.setDate(1); base.setHours(0, 0, 0, 0);
  const monthKey = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = base.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const prev = new Date(base); prev.setMonth(prev.getMonth() - 1);
  const next = new Date(base); next.setMonth(next.getMonth() + 1);
  const fmtKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthEnd = new Date(base); monthEnd.setMonth(monthEnd.getMonth() + 1);

  const [{ data: sessions }, { data: nurses }] = await Promise.all([
    admin.from("scheduled_assessments")
      .select("id, nurse_id, method, scheduled_for, location, note, status, profiles!nurse_id(full_name)")
      .eq("assessor_id", user.id)
      .gte("scheduled_for", base.toISOString()).lt("scheduled_for", monthEnd.toISOString())
      .order("scheduled_for"),
    admin.from("profiles").select("id, full_name")
      .eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").order("full_name").limit(200),
  ]);

  type Session = { id: string; method: string; scheduled_for: string; location: string | null; note: string | null; status: string; profiles: { full_name: string } | null };
  const rows = ((sessions ?? []) as unknown as Session[]);

  // Month grid (weeks start Monday)
  const firstDow = (base.getDay() + 6) % 7;
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const byDay = new Map<number, Session[]>();
  for (const s of rows) {
    const day = new Date(s.scheduled_for).getDate();
    const list = byDay.get(day) ?? [];
    list.push(s);
    byDay.set(day, list);
  }
  const todayKey = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter(s => s.status === "scheduled" && s.scheduled_for >= new Date().toISOString());

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Assessment Calendar</h1>
        <p className="text-gray-400 text-sm mt-0.5">Sessions you&apos;ve scheduled — nurses are notified automatically.</p>
      </div>

      <ScheduleForm nurses={(nurses ?? []) as NurseOpt[]} />

      {/* Month grid */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <Link href={`/assessor/calendar?month=${fmtKey(prev)}`} className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">‹ {prev.toLocaleDateString(undefined, { month: "short" })}</Link>
          <h2 className="text-sm font-bold text-gray-900">{monthLabel}</h2>
          <Link href={`/assessor/calendar?month=${fmtKey(next)}`} className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors">{next.toLocaleDateString(undefined, { month: "short" })} ›</Link>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center mb-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
            <p key={d} className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{d}</p>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            const dayKey = day ? `${monthKey}-${String(day).padStart(2, "0")}` : null;
            const isToday = dayKey === todayKey;
            const daySessions = day ? (byDay.get(day) ?? []) : [];
            return (
              <div key={i} className={`min-h-[64px] rounded-lg border p-1 ${
                day ? (isToday ? "border-indigo-300 bg-indigo-50/50" : "border-gray-100") : "border-transparent"
              }`}>
                {day && (
                  <>
                    <p className={`text-[10px] font-bold ${isToday ? "text-indigo-700" : "text-gray-400"}`}>{day}</p>
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      {daySessions.slice(0, 2).map(s => (
                        <p key={s.id} title={`${s.profiles?.full_name} · ${METHOD_LABELS[s.method] ?? s.method}`}
                          className={`text-[8px] leading-tight truncate rounded px-1 py-0.5 ${
                            s.status === "cancelled" ? "bg-gray-100 text-gray-400 line-through"
                            : s.status === "completed" ? "bg-green-50 text-green-700"
                            : "bg-indigo-100 text-indigo-700"
                          }`}>
                          {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {s.profiles?.full_name?.split(" ")[0]}
                        </p>
                      ))}
                      {daySessions.length > 2 && <p className="text-[8px] text-gray-400">+{daySessions.length - 2} more</p>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming list */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Upcoming This Month</h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-gray-400">
            Nothing scheduled ahead in {monthLabel}. Use the form above to plan a session.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {upcoming.map(s => (
              <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                <div className="text-center shrink-0 w-12">
                  <p className="text-[10px] font-bold text-indigo-600" suppressHydrationWarning>
                    {new Date(s.scheduled_for).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </p>
                  <p className="text-[9px] text-gray-400" suppressHydrationWarning>
                    {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate"><b>{s.profiles?.full_name ?? "—"}</b> · {METHOD_LABELS[s.method] ?? s.method}</p>
                  <p className="text-[10px] text-gray-400 truncate">{[s.location, s.note].filter(Boolean).join(" · ") || "No details"}</p>
                </div>
                <SessionActions id={s.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
