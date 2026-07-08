import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { OrgRole } from "@/lib/roles";

type CompetencyRow = {
  user_id: string;
  competency_id: string;
  status: string;
  expiry_date: string | null;
  competencies: { name: string; category: string } | null;
};

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, hospital_id")
    .eq("id", user.id)
    .single();

  const { data: orgProfile, error: orgErr } = await admin
    .from("profiles")
    .select("org_role, organisation_id")
    .eq("id", user.id)
    .returns<{ org_role: string | null; organisation_id: string | null }[]>()
    .maybeSingle();
  const orgRole = (!orgErr && orgProfile ? orgProfile.org_role as OrgRole : null) ?? null;

  // Chief officers and org admins see all facilities in their organisation
  const orgWideRoles: OrgRole[] = ["chief_officer", "org_admin"];
  const isOrgWide = orgRole && orgWideRoles.includes(orgRole) && orgProfile?.organisation_id;

  let nurseHospitalIds: string[] = profile?.hospital_id ? [profile.hospital_id] : [];

  if (isOrgWide) {
    const { data: orgHospitals } = await admin
      .from("hospitals")
      .select("id")
      .eq("organisation_id", orgProfile!.organisation_id!);
    nurseHospitalIds = (orgHospitals ?? []).map(h => h.id);
  }

  if (!nurseHospitalIds.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-5xl mb-4">🏥</p>
        <h1 className="text-lg font-bold text-gray-900 mb-2">No facility assigned</h1>
        <p className="text-sm text-gray-400 max-w-sm">
          Your account hasn&apos;t been linked to a hospital or organisation yet.
          A Super Admin needs to assign you to a facility before data appears here.
        </p>
      </div>
    );
  }

  const { data: nurses } = await admin
    .from("profiles")
    .select("id, full_name, specialization, created_at")
    .in("hospital_id", nurseHospitalIds)
    .eq("role", "nurse")
    .order("full_name", { ascending: true });

  const nurseIds = nurses?.map(n => n.id) ?? [];

  const [{ data: allEnrollments }, { data: rawComps }, { data: allCPD }] = await Promise.all([
    nurseIds.length > 0
      ? admin.from("course_enrollments").select("user_id, progress, completed_at").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; progress: number; completed_at: string | null }[] }),
    nurseIds.length > 0
      ? admin.from("nurse_competencies")
          .select("user_id, competency_id, status, expiry_date, competencies(name, category)")
          .in("user_id", nurseIds)
      : Promise.resolve({ data: [] as CompetencyRow[] }),
    nurseIds.length > 0
      ? admin.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; hours: number }[] }),
  ]);

  const allComps = (rawComps ?? []) as CompetencyRow[];

  // ── Top-level stats
  const totalNurses        = nurses?.length ?? 0;
  const completedCourses   = allEnrollments?.filter(e => e.completed_at).length ?? 0;
  const competentCount     = allComps.filter(c => c.status === "competent").length;
  const totalCPDHours      = allCPD?.reduce((sum, l) => sum + Number(l.hours), 0) ?? 0;
  const expiredCount       = allComps.filter(c => c.status === "expired").length;

  // ── Expiring in next 60 days
  const today      = new Date();
  const in60Days   = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const expiring   = allComps.filter(c => {
    if (!c.expiry_date) return false;
    const exp = new Date(c.expiry_date);
    return exp >= today && exp <= in60Days;
  });

  // ── Skill gaps: competencies with most expired/pending records
  const gapMap: Record<string, { name: string; category: string; expired: number; pending: number }> = {};
  for (const c of allComps) {
    if (!c.competencies?.name) continue;
    const key = c.competency_id;
    if (!gapMap[key]) gapMap[key] = { name: c.competencies.name, category: c.competencies.category, expired: 0, pending: 0 };
    if (c.status === "expired") gapMap[key].expired++;
    if (c.status === "pending") gapMap[key].pending++;
  }
  const topGaps = Object.values(gapMap)
    .filter(g => g.expired + g.pending > 0)
    .sort((a, b) => (b.expired + b.pending) - (a.expired + a.pending))
    .slice(0, 6);

  // ── Ward breakdown: group nurses by specialization
  const wardMap: Record<string, { nurses: typeof nurses; compCount: number; competentCount: number; cpdHours: number }> = {};
  for (const nurse of nurses ?? []) {
    const ward = nurse.specialization ?? "General";
    if (!wardMap[ward]) wardMap[ward] = { nurses: [], compCount: 0, competentCount: 0, cpdHours: 0 };
    wardMap[ward].nurses!.push(nurse);
    const nc = allComps.filter(c => c.user_id === nurse.id);
    wardMap[ward].compCount      += nc.length;
    wardMap[ward].competentCount += nc.filter(c => c.status === "competent").length;
    wardMap[ward].cpdHours       += allCPD?.filter(l => l.user_id === nurse.id).reduce((s, l) => s + Number(l.hours), 0) ?? 0;
  }
  const wards = Object.entries(wardMap).sort((a, b) => b[1].nurses!.length - a[1].nurses!.length);

  // ── CPD compliance (30h annual target)
  const CPD_TARGET = 30;
  const nursesCPD = (nurses ?? []).map(nurse => {
    const hours = allCPD?.filter(l => l.user_id === nurse.id).reduce((s, l) => s + Number(l.hours), 0) ?? 0;
    return { ...nurse, hours };
  }).sort((a, b) => a.hours - b.hours);

  const atRisk = nursesCPD.filter(n => n.hours < 10).length;
  const onTrack = nursesCPD.filter(n => n.hours >= CPD_TARGET).length;

  return (
    <>
          {/* Header */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {orgRole === "chief_officer" ? "Chief Officer Dashboard"
                  : orgRole === "org_admin" ? "Administrator Dashboard"
                  : orgRole === "manager" ? "Manager Dashboard"
                  : "Organisation Dashboard"}
              </h1>
              <p className="text-gray-400 text-sm mt-0.5">
                {isOrgWide
                  ? `Organisation-wide view across ${nurseHospitalIds.length} facilit${nurseHospitalIds.length !== 1 ? "ies" : "y"}.`
                  : "Facility-level compliance and workforce intelligence."}
              </p>
            </div>
            <a href="mailto:gabriel@semacast.com?subject=Export CPD Report"
              className="flex items-center gap-2 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
              ↓ Export Report
            </a>
          </div>

          {/* Top stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {[
              { label: "Total Nurses",      value: totalNurses,                color: "text-teal-600",  icon: "👩‍⚕️", sub: `${wards.length} wards` },
              { label: "Courses Completed", value: completedCourses,           color: "text-blue-600",  icon: "📚", sub: `${allEnrollments?.length ?? 0} enrolled` },
              { label: "Competencies",      value: competentCount,             color: "text-green-600", icon: "✅", sub: `${expiredCount} expired` },
              { label: "Total CPD Hours",   value: totalCPDHours.toFixed(0),   color: "text-amber-500", icon: "⏱️", sub: `${onTrack} at target` },
              { label: "At Risk",           value: atRisk,                     color: "text-red-500",   icon: "⚠️", sub: "<10 CPD hours" },
            ].map(({ label, value, color, icon, sub }) => (
              <div key={label} className="bg-white rounded-xl p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{label}</p>
                  <span className="text-base">{icon}</span>
                </div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>

          {/* Expiring certificates alert */}
          {expiring.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3">
              <span className="text-xl shrink-0">⚠️</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-amber-800">{expiring.length} competenc{expiring.length === 1 ? "y" : "ies"} expiring in the next 60 days</p>
                <p className="text-xs text-amber-600 mt-0.5">Review and renew before expiry to maintain compliance.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Ward compliance breakdown */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-4">Ward Compliance</h2>
              {wards.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No ward data available.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {wards.map(([ward, data]) => {
                    const rate = data.compCount > 0 ? Math.round((data.competentCount / data.compCount) * 100) : 0;
                    const barColor = rate >= 75 ? "bg-green-500" : rate >= 50 ? "bg-amber-400" : "bg-red-400";
                    return (
                      <div key={ward}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-700 font-medium">{ward}</span>
                            <span className="text-gray-400">{data.nurses!.length} nurse{data.nurses!.length !== 1 ? "s" : ""}</span>
                          </div>
                          <span className={`font-bold ${rate >= 75 ? "text-green-600" : rate >= 50 ? "text-amber-600" : "text-red-500"}`}>
                            {rate}%
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${rate}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">{data.cpdHours.toFixed(0)}h CPD logged · {data.competentCount}/{data.compCount} competencies</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Competency status overview */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-4">Competency Status Overview</h2>
              {allComps.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {(["competent", "in_progress", "expired", "pending"] as const).map(status => {
                    const count = allComps.filter(c => c.status === status).length;
                    const pct = Math.round((count / allComps.length) * 100);
                    const colors: Record<string, string> = {
                      competent:   "bg-green-500",
                      in_progress: "bg-blue-500",
                      expired:     "bg-red-500",
                      pending:     "bg-gray-300",
                    };
                    const labels: Record<string, string> = {
                      competent: "Competent", in_progress: "In Progress", expired: "Expired", pending: "Pending",
                    };
                    return (
                      <div key={status}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600 font-medium">{labels[status]}</span>
                          <span className="text-gray-400">{count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${colors[status]}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 text-center py-8">No competency data yet.</p>
              )}
            </div>
          </div>

          {/* Skill gap analysis */}
          {topGaps.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900 text-sm">Skill Gap Analysis</h2>
                <span className="text-xs text-gray-400">Competencies with most gaps across your nurses</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {topGaps.map(gap => (
                  <div key={gap.name} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-sm shrink-0">⚠️</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{gap.name}</p>
                      <p className="text-[10px] text-gray-400">{gap.category}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {gap.expired > 0 && <p className="text-[10px] font-bold text-red-500">{gap.expired} expired</p>}
                      {gap.pending > 0 && <p className="text-[10px] text-gray-400">{gap.pending} pending</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CPD Compliance table */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-sm">CPD Compliance — All Nurses</h2>
              <span className="text-xs text-gray-400">Target: {CPD_TARGET}h/year</span>
            </div>
            {nursesCPD.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <p className="text-2xl mb-2">👩‍⚕️</p>
                <p className="text-sm">No nurses linked to your hospital yet.</p>
                <p className="text-xs mt-1">Nurses must set their hospital in their profile.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400">
                      <th className="text-left pb-2 font-medium">NURSE</th>
                      <th className="text-left pb-2 font-medium">WARD</th>
                      <th className="text-left pb-2 font-medium">CPD HOURS</th>
                      <th className="text-left pb-2 font-medium">PROGRESS</th>
                      <th className="text-left pb-2 font-medium">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {nursesCPD.map(nurse => {
                      const pct = Math.min(Math.round((nurse.hours / CPD_TARGET) * 100), 100);
                      const nurseComps    = allComps.filter(c => c.user_id === nurse.id);
                      const nurseCompetent = nurseComps.filter(c => c.status === "competent").length;
                      const nurseExpiring  = expiring.filter(c => c.user_id === nurse.id).length;
                      const statusLabel = nurse.hours >= CPD_TARGET ? { label: "On Target", cls: "bg-green-100 text-green-700" }
                        : nurse.hours >= 15              ? { label: "In Progress", cls: "bg-blue-100 text-blue-700" }
                        : nurse.hours > 0                ? { label: "Behind", cls: "bg-amber-100 text-amber-700" }
                        : { label: "Not Started", cls: "bg-red-100 text-red-600" };
                      return (
                        <tr key={nurse.id}>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {nurse.full_name[0]}
                              </div>
                              <div>
                                <p className="text-gray-800 font-medium text-sm">{nurse.full_name}</p>
                                {nurseExpiring > 0 && (
                                  <p className="text-[10px] text-amber-600">⚠️ {nurseExpiring} cert{nurseExpiring > 1 ? "s" : ""} expiring</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-xs text-gray-500">{nurse.specialization ?? "General"}</td>
                          <td className="py-3 text-sm font-medium text-gray-700">{nurse.hours.toFixed(0)}h <span className="text-xs text-gray-400">/ {CPD_TARGET}h</span></td>
                          <td className="py-3 w-36">
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-blue-400" : pct > 0 ? "bg-amber-400" : "bg-gray-200"}`}
                                style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">{pct}%</p>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${statusLabel.cls}`}>{statusLabel.label}</span>
                              {nurseCompetent > 0 && (
                                <span className="text-[10px] text-green-600">{nurseCompetent} competent</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Expiring competencies detail */}
          {expiring.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-100 p-5 mb-6">
              <h2 className="font-semibold text-gray-900 text-sm mb-4">
                Expiring Certifications <span className="text-amber-600 font-bold">({expiring.length})</span>
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400">
                      <th className="text-left pb-2 font-medium">NURSE</th>
                      <th className="text-left pb-2 font-medium">COMPETENCY</th>
                      <th className="text-left pb-2 font-medium">CATEGORY</th>
                      <th className="text-left pb-2 font-medium">EXPIRES</th>
                      <th className="text-left pb-2 font-medium">DAYS LEFT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {expiring.map((c, i) => {
                      const nurse = nurses?.find(n => n.id === c.user_id);
                      const daysLeft = Math.ceil((new Date(c.expiry_date!).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      return (
                        <tr key={i}>
                          <td className="py-2.5 text-gray-800 font-medium">{nurse?.full_name ?? "—"}</td>
                          <td className="py-2.5 text-gray-700">{c.competencies?.name ?? "—"}</td>
                          <td className="py-2.5 text-gray-500 text-xs">{c.competencies?.category ?? "—"}</td>
                          <td className="py-2.5 text-gray-500 text-xs">{c.expiry_date}</td>
                          <td className="py-2.5">
                            <span className={`text-xs font-semibold ${daysLeft <= 14 ? "text-red-600" : "text-amber-600"}`}>
                              {daysLeft}d
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Quick actions */}
          {orgRole !== "chief_officer" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ...(["org_admin","manager"].includes(orgRole ?? "") || !orgRole ? [{ label: "Invite Worker", icon: "➕", color: "bg-teal-50 text-teal-700", href: "/admin/invite" }] : []),
                { label: "Export CPD Report", icon: "📊", color: "bg-blue-50 text-blue-700", href: "#" },
                { label: "Competency Matrix", icon: "🪪", color: "bg-purple-50 text-purple-700", href: "/admin/competencies" },
                ...(["org_admin"].includes(orgRole ?? "") || !orgRole ? [{ label: "Settings", icon: "⚙️", color: "bg-gray-50 text-gray-700", href: "/admin/settings" }] : []),
              ].map(({ label, icon, color, href }) => (
                <Link key={label} href={href}
                  className={`flex items-center gap-3 p-4 rounded-xl text-sm font-medium hover:opacity-80 transition-opacity ${color}`}>
                  <span className="text-xl">{icon}</span>
                  {label}
                </Link>
              ))}
            </div>
          )}
    </>
  );
}
