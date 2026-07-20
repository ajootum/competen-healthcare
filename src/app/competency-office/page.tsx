import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyOfficeDashboard } from "@/lib/competency-office-data";

export const dynamic = "force-dynamic";

// Competency Office Dashboard (CPO-001) — enterprise competency governance KPIs.
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

export default async function CompetencyOfficeDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadCompetencyOfficeDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { frameworks: fw, competencyCount, cpus, templates, pendingApprovals, compliance, activeCycles } = d;
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Competency Office</h1>
        <p className="text-sm text-gray-500 mt-1">Enterprise competency governance — frameworks, CPUs, standards and compliance · {profile?.full_name}</p>
      </div>

      {/* Enterprise competency KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi n={fw.total} label="Competency frameworks" sub={`${fw.published} published`} href="/competency-office/frameworks" />
        <Kpi n={competencyCount} label="Governed competencies" href="/competency-office/frameworks" />
        <Kpi n={cpus.total} label="Clinical Practice Units" sub={`${cpus.published} published`} href="/competency-office/cpus" />
        <Kpi n={templates.active} label="Active position templates" sub={`${templates.positions} positions`} href="/competency-office/templates" />
        <Kpi n={`${compliance.coverage}%`} label="Competency compliance" tone={pct(compliance.coverage)} sub={`${compliance.current}/${compliance.total} current`} href="/competency-office/analytics" />
        <Kpi n={pendingApprovals} label="Pending approvals" tone={pendingApprovals ? "text-amber-600" : undefined} href="/competency-office/governance" />
        <Kpi n={activeCycles} label="Assessment cycles active" href="/competency-office/analytics" />
        <Kpi n={fw.inReview + cpus.inReview} label="Content in review" tone={fw.inReview + cpus.inReview ? "text-amber-600" : undefined} href="/competency-office/governance" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Framework status */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Framework status</h3>
          {fw.total === 0 && <p className="text-sm text-gray-400">No frameworks in scope yet.</p>}
          {fw.total > 0 && <Bar segments={[
            { n: fw.published, color: "#22c55e", label: "Published" },
            { n: fw.inReview, color: "#f59e0b", label: "In review" },
            { n: fw.draft, color: "#94a3b8", label: "Draft" },
          ]} />}
          <div className="mt-3 pt-3 border-t flex gap-4 text-xs text-gray-500">
            <span>Core: <b className="text-gray-800">{fw.core}</b></span>
            <span>Specialty: <b className="text-gray-800">{fw.specialty}</b></span>
            <span>Role: <b className="text-gray-800">{fw.role}</b></span>
          </div>
        </div>

        {/* CPU lifecycle */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">CPU lifecycle</h3>
          {cpus.total === 0 && <p className="text-sm text-gray-400">No CPUs in the library yet.</p>}
          {cpus.total > 0 && <Bar segments={[
            { n: cpus.published, color: "#0d9488", label: "Published" },
            { n: cpus.approved, color: "#3b82f6", label: "Approved" },
            { n: cpus.inReview, color: "#f59e0b", label: "In review" },
            { n: cpus.draft, color: "#94a3b8", label: "Draft" },
            { n: cpus.archived, color: "#e5e7eb", label: "Archived" },
          ]} />}
          <p className="text-xs text-gray-400 mt-3"><Link href="/competency-office/cpus" className="text-teal-600 hover:underline">Manage CPU library →</Link></p>
        </div>

        {/* Governance approvals */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Governance</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Pending approvals</span><b className={`tabular-nums ${pendingApprovals ? "text-amber-600" : ""}`}>{pendingApprovals}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Frameworks in review</span><b className="tabular-nums">{fw.inReview}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">CPUs in review</span><b className="tabular-nums">{cpus.inReview}</b></div>
          </div>
          <p className="text-xs text-gray-400 mt-3"><Link href="/competency-office/governance" className="text-teal-600 hover:underline">Open governance queue →</Link></p>
        </div>

        {/* Quick actions */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Quick actions</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[["🗂️ Manage frameworks", "/competency-office/frameworks"], ["🏥 CPU library", "/competency-office/cpus"], ["🧩 Position templates", "/admin/positions"], ["⚖️ Governance queue", "/admin/approvals"], ["🎛️ Competency studio", "/admin/studio"], ["📈 Analytics", "/competency-office/analytics"]].map(([label, href]) => (
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

        {/* AI competency intelligence — later phase */}
        <div className={`${card} border-dashed`}>
          <h3 className="font-semibold text-gray-900 mb-1">AI Competency Intelligence</h3>
          <p className="text-sm text-gray-400">Framework-optimisation, gap-prediction and standards recommendations arrive in a later CPO phase. The governed data it reasons over — frameworks, CPUs, compliance — is already live above.</p>
        </div>
      </div>
    </div>
  );
}
