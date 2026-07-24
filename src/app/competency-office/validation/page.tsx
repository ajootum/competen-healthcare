import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadValidationQueue } from "@/lib/validation-queue";
import ValidationTabs from "./ValidationTabs";

export const dynamic = "force-dynamic";

// Validation Queue — Validation Dashboard (CMO-005 §3). The evidence/competency validation command
// centre over the governed validation object (competency_decisions). Real: pending validation,
// near-SLA, rejected, approved-today, the named pending queue and recent validation history. The
// approve/reject workflow lives in the educator/UMW validation surfaces (cross-linked). Honest
// next-phase: committee review, appeals, AI evidence-quality scoring and configurable SLA.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </Link>
  );
}

export default async function ValidationDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadValidationQueue(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const k = d.kpis;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900">Validation Queue</h1><p className="text-sm text-gray-500">Review, validate, approve and govern competency evidence — approval updates readiness immediately.</p></div>
        <Link href="/unit-manager/competency-validations" className="text-xs bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700 transition-colors">Open validation workflow</Link>
      </div>
      <ValidationTabs />
    </>
  );
  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Validation store not provisioned</p><p className="text-sm text-amber-800 mt-1">No competency decisions recorded for this tenant yet.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI widgets (§3) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi icon="📥" tint="bg-sky-50" label="Pending Validation" value={k.pending} tone={k.pending ? "text-sky-600" : "text-gray-400"} sub="awaiting review" href="/competency-office/validation/pending" />
        <Kpi icon="⏰" tint="bg-amber-50" label="Near / Past SLA" value={k.nearSla} tone={k.nearSla ? "text-amber-600" : "text-gray-400"} sub="≥7 days waiting" href="/competency-office/validation/pending" />
        <Kpi icon="❌" tint="bg-rose-50" label="Rejected" value={k.rejected} tone={k.rejected ? "text-rose-600" : "text-gray-400"} sub="failed validation" href="/competency-office/validation/history" />
        <Kpi icon="✅" tint="bg-emerald-50" label="Approved Today" value={k.approvedToday} sub="validated today" href="/competency-office/validation/history" />
        <Kpi icon="👥" tint="bg-violet-50" label="Committee Queue" value="—" tone="text-gray-300" sub="committee store next-phase" href="/competency-office/validation/committee" />
        <Kpi icon="⚖️" tint="bg-orange-50" label="Appeals" value="—" tone="text-gray-300" sub="appeals store next-phase" href="/competency-office/validation/appeals" />
        <Kpi icon="✨" tint="bg-teal-50" label="AI Confidence" value="—" tone="text-gray-300" sub="evidence scoring next-phase" href="/competency-office/validation/ai" />
      </div>

      {/* Pending queue + history */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Pending Validation <span className="text-[10px] font-normal text-gray-400">oldest first</span></h3><Link href="/unit-manager/competency-validations" className="text-[11px] text-teal-600 hover:underline">Review →</Link></div>
          {d.pendingList.length === 0 ? <p className="text-sm text-gray-400">Validation queue clear. 🎉</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Staff</th><th className="py-1.5 font-medium">Competency</th><th className="py-1.5 font-medium">Outcome</th><th className="py-1.5 font-medium text-right">Waiting</th></tr></thead>
              <tbody>{d.pendingList.map((p: any) => (<tr key={p.id} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{p.name}</td><td className="py-1.5 text-gray-600 truncate max-w-[10rem]">{p.competency}</td><td className="py-1.5 text-gray-500">{p.outcome}</td><td className={`py-1.5 text-right tabular-nums font-medium ${p.overdue ? "text-rose-600" : "text-gray-500"}`}>{p.age != null ? `${p.age}d` : "—"}</td></tr>))}</tbody>
            </table></div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Validation History</h3><Link href="/competency-office/validation/history" className="text-[11px] text-teal-600 hover:underline">All →</Link></div>
          {d.history.length === 0 ? <p className="text-sm text-gray-400">No validation decisions yet.</p> : (
            <div className="divide-y divide-gray-50">{d.history.map((h: any) => (<div key={h.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><div className="min-w-0"><span className="text-gray-700">{h.name}</span> <span className="text-gray-400 truncate">{h.competency}</span></div><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${h.decision === "Validated" ? "bg-emerald-50 text-emerald-700" : h.decision === "Rejected" ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-600"}`}>{h.decision}</span></div>))}</div>
          )}
        </div>
      </div>

      {/* AI insights + workflow cross-links */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5 bg-gradient-to-br from-teal-50/40 to-white`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">✨ AI Validation Insights <span className="text-[10px] font-normal text-gray-400">explainable</span></h3>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority validation actions.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 4).map((a: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.priority === "high" ? "bg-rose-50 text-rose-700" : a.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Validation Workflow</h3>
          <p className="text-xs text-gray-500 mb-3">Approve / reject / request-more-evidence against the rubric is actioned in the validation surfaces. A validator cannot approve their own submission (§5), and every decision requires a reason code.</p>
          <div className="grid grid-cols-1 gap-1.5">
            {[["🗂️ Unit validation queue", "/unit-manager/competency-validations"], ["🎓 Educator validations", "/educator/validations"], ["📎 Evidence review", "/educator/evidence"]].map(([label, href]) => (
              <Link key={href} href={href} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors"><span>{label}</span><span className="text-gray-300">→</span></Link>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Validation Queue (CMO-005 §3) over the governed validation object (competency_decisions). Real: pending validation, near/past-SLA (≥7 days), rejected, approved-today, the named pending queue, recent history and rule-based explainable AI insights. The approve/reject/request-evidence workflow (validator cannot approve own submission; reason code required — §5) lives in the <Link href="/unit-manager/competency-validations" className="text-teal-700 hover:underline">validation surfaces</Link>. Honest next-phase: committee review, appeals, AI evidence-quality scoring and configurable SLA — each needs its own store. Source: validation services; calculated {todayLabel()}.</p>
    </div>
  );
}
