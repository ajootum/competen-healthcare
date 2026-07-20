import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHrDashboard } from "@/lib/hr-data";

export const dynamic = "force-dynamic";

// Human Resources Dashboard (HRM-001).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const pct = (n: number) => (n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");

function Kpi({ n, label, tone, sub, href }: { n: any; label: string; tone?: string; sub?: string; href?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Bar({ segments }: { segments: { n: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, x) => s + x.n, 0) || 1;
  return (
    <>
      <div className="flex h-5 rounded-md overflow-hidden border border-gray-200 mb-2">
        {segments.map((s, i) => s.n ? <div key={i} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} /> : null)}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        {segments.map((s, i) => <span key={i}><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: s.color }} />{s.label}: <b className="text-gray-800">{s.n}</b></span>)}
      </div>
    </>
  );
}

export default async function HrDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadHrDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { headcount, employment, positions, competency, learning } = d;
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);
  const fillRate = positions.establishment ? Math.round((positions.filled / positions.establishment) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Human Resources</h1>
        <p className="text-sm text-gray-500 mt-1">Workforce administration — headcount, positions, onboarding &amp; compliance · {profile?.full_name}</p>
      </div>

      {/* HR KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi n={headcount.total} label="Total workforce" sub={`${headcount.nurse} clinical`} href="/human-resources/staff" />
        <Kpi n={positions.establishment} label="Established positions" sub={`${fillRate}% filled`} href="/human-resources/planning" />
        <Kpi n={positions.vacant} label="Vacancies" tone={positions.vacant ? "text-amber-600" : undefined} href="/human-resources/recruitment" />
        <Kpi n={employment.newStarters} label="New starters (30d)" tone={employment.newStarters ? "text-teal-700" : undefined} href="/human-resources/staff" />
        <Kpi n={employment.orientation + employment.probation} label="In onboarding" sub={`${employment.orientation} orientation · ${employment.probation} probation`} href="/human-resources/staff" />
        <Kpi n={`${competency.coverage}%`} label="Competency currency" tone={pct(competency.coverage)} sub={`${competency.current}/${competency.total} assessed current`} href="/human-resources/staff" />
        <Kpi n={`${learning.compliance}%`} label="Mandatory learning" tone={pct(learning.compliance)} sub={`${learning.completed}/${learning.total} items`} href="/human-resources/learning" />
        <Kpi n={positions.recentAssignments} label="Assignments (30d)" href="/human-resources/planning" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Headcount by role */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Headcount by role</h3>
          {headcount.total === 0 && <p className="text-sm text-gray-400">No staff records yet.</p>}
          {headcount.total > 0 && <Bar segments={[
            { n: headcount.nurse, color: "#0d9488", label: "Healthcare worker" },
            { n: headcount.assessor, color: "#3b82f6", label: "Assessor" },
            { n: headcount.educator, color: "#8b5cf6", label: "Educator" },
            { n: headcount.admin, color: "#94a3b8", label: "Admin" },
            { n: headcount.other, color: "#cbd5e1", label: "Other" },
          ]} />}
        </div>

        {/* Establishment & vacancy */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Establishment &amp; vacancy</h3>
          {positions.establishment === 0 && <p className="text-sm text-gray-400">No positions established yet — set them up in Position Management.</p>}
          {positions.establishment > 0 && <Bar segments={[
            { n: positions.filled, color: "#22c55e", label: "Filled" },
            { n: positions.vacant, color: "#f59e0b", label: "Vacant" },
          ]} />}
          <p className="text-xs text-gray-400 mt-3">{fillRate}% of {positions.establishment} positions filled. <Link href="/human-resources/positions" className="text-teal-600 hover:underline">Manage positions →</Link></p>
        </div>

        {/* Onboarding */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">New starters &amp; onboarding</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">New starters (30d)</span><b className="tabular-nums text-teal-700">{employment.newStarters}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">In orientation</span><b className="tabular-nums">{employment.orientation}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">In probation</span><b className="tabular-nums">{employment.probation}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Confirmed</span><b className="tabular-nums">{employment.confirmed}</b></div>
          </div>
        </div>

        {/* Competency + learning compliance */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Compliance</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">Competency currency <span className="text-gray-400">(of assessed)</span></span><span className={`font-medium ${pct(competency.coverage)}`}>{competency.coverage}%</span></div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${competency.coverage >= 85 ? "bg-green-500" : competency.coverage >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${competency.coverage}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">Mandatory learning</span><span className={`font-medium ${pct(learning.compliance)}`}>{learning.compliance}%</span></div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${learning.compliance >= 85 ? "bg-green-500" : learning.compliance >= 60 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${learning.compliance}%` }} /></div>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Quick actions</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[["👥 Staff records", "/human-resources/staff"], ["🗺️ Workforce planning", "/human-resources/planning"], ["🧩 Assign a position", "/admin/positions"], ["➕ Invite workers", "/admin/invite"], ["🎖️ Credentials", "/admin/credentials"], ["📈 HR analytics", "/admin/executive"]].map(([label, href]) => (
              <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors">{label}</Link>
            ))}
          </div>
        </div>

        {/* Notifications */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Notifications</h3>
          {(notifs ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing new.</p>}
          <div className="space-y-1.5">
            {(notifs ?? []).map((n: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm"><span className="text-gray-800 truncate">{n.title}</span><span className="ml-auto text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString()}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Workforce Advisor — later phase */}
      <div className={`${card} border-dashed`}>
        <h3 className="font-semibold text-gray-900 mb-1">AI Workforce Advisor</h3>
        <p className="text-sm text-gray-400">Workforce-planning, succession and retention-risk AI arrives in a later HRM phase. The headcount, vacancy, onboarding and compliance data it reasons over is already live above.</p>
      </div>
    </div>
  );
}
