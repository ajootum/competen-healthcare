import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { OrgRole } from "@/lib/roles";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];
const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

const METHOD_ICONS: Record<string, string> = {
  knowledge: "📝", direct_observation: "👁️", simulation: "🎮",
  osce: "🏥", concurrent_audit: "📋", retrospective_audit: "🗂️", logbook: "📓",
};

export default async function AssessorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!profile || !["assessor","educator","hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const { data: orgProfile, error: orgErr } = await admin
    .from("profiles")
    .select("org_role")
    .eq("id", user.id)
    .returns<{ org_role: string | null }[]>()
    .maybeSingle();
  const orgRole = (!orgErr && orgProfile ? orgProfile.org_role as OrgRole : null) ?? null;

  const [{ data: cycles }, { data: myAssessments }, { data: recentDone }] = await Promise.all([
    admin.from("competency_cycles")
      .select(`id, cycle_type, status, start_date, end_date,
        profiles!nurse_id(id, full_name),
        cycle_frameworks(id, status, frameworks(id, name, library))`)
      .eq("hospital_id", profile.hospital_id ?? "")
      .eq("status", "active")
      .order("start_date"),

    admin.from("assessments")
      .select(`id, method, status, score, assessed_at,
        competency_cycles!cycle_id(id, cycle_type, profiles!nurse_id(full_name)),
        framework_competencies!competency_id(id, name,
          framework_domains!domain_id(name, frameworks!framework_id(name)))`)
      .eq("assessor_id", user.id)
      .in("status", ["pending","in_progress"])
      .order("created_at"),

    admin.from("assessments")
      .select("id, method, score, assessed_at, framework_competencies!competency_id(name)")
      .eq("assessor_id", user.id)
      .eq("status", "complete")
      .order("assessed_at", { ascending: false })
      .limit(5),
  ]);

  // For charge_nurse: fetch nurses in same hospital with their competency cycle status
  let hospitalNurses: { id: string; full_name: string; activeCycles: number }[] = [];
  if (orgRole === "charge_nurse" || orgRole === "shift_supervisor") {
    const { data: nurses } = await admin.from("profiles")
      .select("id, full_name")
      .eq("hospital_id", profile.hospital_id ?? "")
      .eq("role", "nurse")
      .limit(20);

    if (nurses?.length) {
      const nurseIds = nurses.map(n => n.id);
      const { data: nursesCycles } = await admin.from("competency_cycles")
        .select("nurse_id")
        .in("nurse_id", nurseIds)
        .eq("status", "active");

      hospitalNurses = nurses.map(n => ({
        id: n.id,
        full_name: n.full_name,
        activeCycles: nursesCycles?.filter(c => c.nurse_id === n.id).length ?? 0,
      }));
    }
  }

  const orgRoleLabel: Record<string, string> = {
    charge_nurse: "Charge Nurse / In-Charge",
    shift_supervisor: "Shift Supervisor",
    leader: "Team Leader",
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {orgRole && orgRoleLabel[orgRole] ? `${orgRoleLabel[orgRole]} Dashboard` : "Assessor Dashboard"}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Welcome, {profile.full_name} — {(cycles ?? []).length} active cycles in your hospital
          </p>
        </div>
      </div>

      {/* ── Charge Nurse: Unit Overview ── */}
      {orgRole === "charge_nurse" && (
        <div className="mb-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Unit Overview</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "Nurses in Unit",   value: hospitalNurses.length,                                         icon: "👩‍⚕️", color: "text-teal-600" },
              { label: "Active Cycles",    value: (cycles ?? []).length,                                          icon: "🔄",   color: "text-blue-600" },
              { label: "Pending Audits",   value: (myAssessments ?? []).length,                                   icon: "📋",   color: "text-amber-500" },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{s.label}</p>
                  <span>{s.icon}</span>
                </div>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-900">Staff in Unit</h3>
              <Link href="/assessor/assign"
                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700">
                + Assign Assessor
              </Link>
            </div>
            {hospitalNurses.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No nurses linked to your hospital yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {hospitalNurses.map(n => (
                  <div key={n.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">
                        {n.full_name[0]}
                      </div>
                      <p className="text-sm text-gray-800 font-medium">{n.full_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {n.activeCycles > 0 ? (
                        <span className="text-[10px] px-2 py-0.5 bg-teal-50 text-teal-600 rounded font-semibold">{n.activeCycles} active cycle{n.activeCycles > 1 ? "s" : ""}</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-400 rounded">No active cycle</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Shift Supervisor: Readiness Panel ── */}
      {orgRole === "shift_supervisor" && (
        <div className="mb-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Shift Readiness</h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Staff on Unit</p>
              {hospitalNurses.length === 0 ? (
                <p className="text-sm text-gray-400">No nurses linked yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {hospitalNurses.slice(0, 8).map(n => (
                    <div key={n.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-[10px] font-bold">
                          {n.full_name[0]}
                        </div>
                        <span className="text-xs text-gray-700">{n.full_name}</span>
                      </div>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${n.activeCycles > 0 ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-600"}`}>
                        {n.activeCycles > 0 ? "In Assessment" : "Clear"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Competency Alerts</p>
              {(myAssessments ?? []).length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-2xl mb-1">✅</p>
                  <p className="text-xs text-gray-400">No pending alerts</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(myAssessments ?? []).slice(0, 5).map(a => {
                    const comp = a.framework_competencies as unknown as { name: string } | null;
                    return (
                      <div key={a.id} className="flex items-center gap-2">
                        <span className="text-red-500 text-xs">⚠️</span>
                        <p className="text-xs text-gray-700 truncate">{comp?.name}</p>
                      </div>
                    );
                  })}
                  {(myAssessments ?? []).length > 5 && (
                    <p className="text-[10px] text-gray-400">+{(myAssessments ?? []).length - 5} more</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Leader: Team intro ── */}
      {orgRole === "leader" && (
        <div className="mb-8 bg-indigo-50 border border-indigo-100 rounded-xl p-5 flex items-start gap-3">
          <span className="text-2xl">⭐</span>
          <div>
            <p className="font-semibold text-indigo-900 text-sm">Team Leader View</p>
            <p className="text-indigo-600 text-xs mt-0.5">You can assess team members, review competency progress, and coordinate with charge nurses. Use Audit Tools below to begin.</p>
          </div>
        </div>
      )}

      {/* ── Pending Assessments (all sub-roles) ── */}
      {(myAssessments ?? []).length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Your Pending Assessments</h2>
          <div className="flex flex-col gap-2">
            {(myAssessments ?? []).map(a => {
              const cycle = a.competency_cycles as unknown as { id: string; cycle_type: string; profiles: { full_name: string } | null } | null;
              const comp = a.framework_competencies as unknown as { id: string; name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{METHOD_ICONS[a.method] ?? "•"}</span>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{comp?.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {comp?.framework_domains?.frameworks?.name} · {comp?.framework_domains?.name}
                      </p>
                      <p className="text-[10px] text-teal-600 mt-0.5">
                        Nurse: {cycle?.profiles?.full_name ?? "—"} · {cycle?.cycle_type} cycle
                      </p>
                    </div>
                  </div>
                  <Link href={`/assessor/assess/${a.id}`}
                    className="px-4 py-2 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
                    {a.status === "in_progress" ? "Continue →" : "Start →"}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Active Cycles (all sub-roles) ── */}
      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Active Cycles ({(cycles ?? []).length})</h2>
        <div className="flex flex-col gap-3">
          {(cycles ?? []).map(c => {
            const nurse = c.profiles as unknown as { id: string; full_name: string } | null;
            const fws = (c.cycle_frameworks ?? []) as unknown as { id: string; status: string; frameworks: { id: string; name: string; library: string } | null }[];
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center font-bold text-teal-700 text-sm">
                      {nurse?.full_name?.[0] ?? "?"}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{nurse?.full_name}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{c.cycle_type} cycle · started {new Date(c.start_date).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Link href={`/assessor/cycle/${c.id}`}
                    className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50">
                    Assess →
                  </Link>
                </div>
                {fws.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-5 pb-3">
                    {fws.map(f => (
                      <span key={f.id} className={`text-[10px] px-2 py-0.5 rounded ${
                        f.status === "complete" ? "bg-teal-50 text-teal-600" :
                        f.status === "in_progress" ? "bg-blue-50 text-blue-600" :
                        "bg-gray-100 text-gray-500"
                      }`}>{f.frameworks?.name}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!(cycles ?? []).length && (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <p className="text-gray-400 text-sm">No active cycles in your hospital. Hospital admin creates cycles for nurses.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Recently Completed ── */}
      {(recentDone ?? []).length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recently Completed</h2>
          <div className="flex flex-col gap-2">
            {(recentDone ?? []).map(a => {
              const comp = a.framework_competencies as unknown as { name: string } | null;
              const score = a.score ?? 0;
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center gap-4">
                  <span className="text-lg">{METHOD_ICONS[a.method] ?? "•"}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{comp?.name}</p>
                    <p className="text-[10px] text-gray-400">{a.assessed_at ? new Date(a.assessed_at).toLocaleDateString() : "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: SCORE_COLORS[score] ?? "#6b7280" }}>{score}</div>
                    <span className="text-xs text-gray-500">{SCORE_LABELS[score]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
