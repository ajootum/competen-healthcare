import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { METHOD_LABELS as METHOD_LABELS_T } from "@/lib/ckcm";
const METHOD_LABELS = METHOD_LABELS_T as Record<string, string>;

// My Assessments — upcoming, completed and reassessment dates in one place.

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];

export default async function MyAssessmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [{ data: cycles }, { data: decisions }] = await Promise.all([
    admin.from("competency_cycles").select("id, cycle_type, status").eq("nurse_id", user.id),
    admin.from("competency_decisions")
      .select("competency_id, expiry_date, created_at, framework_competencies(name)")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
  ]);
  const cycleIds = (cycles ?? []).map(c => c.id);

  const { data: assessments } = cycleIds.length
    ? await admin.from("assessments")
        .select("id, cycle_id, method, status, score, notes, assessed_at, created_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name)")
        .in("cycle_id", cycleIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const done = (assessments ?? []).filter(a => a.status === "complete" || a.status === "validated");
  const pending = (assessments ?? []).filter(a => a.status === "pending" || a.status === "in_progress");

  // Upcoming reassessments (latest decision per competency, expiring ≤120d)
  const seen = new Set<string>();
  const upcoming: { name: string; expiry: string; days: number }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    if (!d.expiry_date) continue;
    const days = Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000);
    if (days <= 120) {
      upcoming.push({ name: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "—", expiry: d.expiry_date, days });
    }
  }
  upcoming.sort((a, b) => a.days - b.days);

  const compName = (a: { framework_competencies: unknown }) =>
    (a.framework_competencies as { name: string } | null)?.name ?? "—";
  const assessorName = (a: { profiles: unknown }) =>
    (a.profiles as { full_name: string } | null)?.full_name ?? "—";

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">My Assessments</h1>
        <p className="text-gray-400 text-sm mt-0.5">Formal and workplace-based assessments, and what&apos;s coming up.</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Completed", value: done.length, color: "text-green-600" },
          { label: "Pending", value: pending.length, color: "text-amber-600" },
          { label: "Reassessments ≤120d", value: upcoming.length, color: upcoming.some(u => u.days < 0) ? "text-red-600" : "text-blue-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {upcoming.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Upcoming Reassessments</h2>
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {upcoming.map((u, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <span className="text-sm text-gray-800 flex-1">{u.name}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  u.days < 0 ? "bg-red-50 text-red-600" : u.days <= 60 ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-600"}`}>
                  {u.days < 0 ? `Expired ${-u.days}d ago` : `Due in ${u.days}d`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Awaiting Assessment</h2>
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {pending.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">{compName(a)}</p>
                  <p className="text-[10px] text-gray-400">{METHOD_LABELS[a.method] ?? a.method} · {assessorName(a)}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 capitalize">{a.status.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Assessment History</h2>
      {done.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-4xl mb-3">📝</p>
          <p className="font-semibold text-gray-700">No completed assessments yet</p>
          <p className="text-gray-400 text-sm mt-2">Results appear here as assessors submit their evaluations.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {done.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-5 py-3">
              {a.score != null && (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ backgroundColor: SCORE_COLORS[a.score] ?? "#9ca3af" }}>{a.score}</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{compName(a)}</p>
                <p className="text-[10px] text-gray-400">
                  {METHOD_LABELS[a.method] ?? a.method} · {assessorName(a)}
                  {a.assessed_at ? ` · ${new Date(a.assessed_at).toLocaleDateString()}` : ""}
                </p>
                {a.notes && <p className="text-[11px] text-gray-500 italic mt-1">&ldquo;{a.notes}&rdquo;</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-6">
        Formal outcomes live on your <Link href="/dashboard/passport" className="text-teal-600 hover:underline">Competency Passport</Link>.
      </p>
    </div>
  );
}
