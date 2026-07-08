import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

export default async function CommandCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [
    { count: orgCount }, { count: facilityCount }, { count: workerCount },
    { data: decisions }, { count: pendingApprovals }, { count: activeAuths },
    { data: credentials }, { data: frameworks },
  ] = await Promise.all([
    admin.from("organisations").select("id", { count: "exact", head: true }),
    admin.from("hospitals").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "nurse"),
    admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, critical_failure, created_at").order("created_at", { ascending: false }),
    admin.from("content_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("clinical_authorizations").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("professional_credentials").select("expiry_date, status"),
    admin.from("frameworks").select("id, pub_status").returns<{ id: string; pub_status: string | null }[]>(),
  ]);

  // Latest decision per (nurse, competency)
  const seen = new Set<string>();
  const latest = (decisions ?? []).filter(d => {
    const k = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  const competent = latest.filter(d => OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing).length;
  const readiness = latest.length ? Math.round((competent / latest.length) * 100) : 0;
  const criticalFailures = latest.filter(d => d.critical_failure).length;
  const expired = latest.filter(d => d.expiry_date && new Date(d.expiry_date).getTime() < Date.now()).length;
  const dueSoon = latest.filter(d => {
    if (!d.expiry_date) return false;
    const days = (new Date(d.expiry_date).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 60;
  }).length;

  const credExpiring = (credentials ?? []).filter(c => {
    if (!c.expiry_date) return false;
    const days = (new Date(c.expiry_date).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;
  const credExpired = (credentials ?? []).filter(c => c.status === "expired" || (c.expiry_date && new Date(c.expiry_date).getTime() < Date.now())).length;

  const published = (frameworks ?? []).filter(f => (f.pub_status ?? "published") === "published").length;
  const inReview = (frameworks ?? []).filter(f => f.pub_status === "in_review").length;

  const readinessColor = readiness >= 85 ? "text-green-600" : readiness >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Executive Command Centre</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Enterprise-wide workforce capability, risk and governance at a glance (Book III Ch.9).
        </p>
      </div>

      {/* Enterprise readiness headline */}
      <div className="bg-gradient-to-r from-[#0f1923] to-[#1a2f3a] rounded-2xl p-6 mb-6 text-white flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold text-rose-300/70 uppercase tracking-widest mb-1">Enterprise Clinical Readiness</p>
          <p className={`text-5xl font-bold ${readinessColor.replace("text-", "text-")}`} style={{ color: readiness >= 85 ? "#4ade80" : readiness >= 60 ? "#fbbf24" : "#f87171" }}>{readiness}%</p>
          <p className="text-xs text-slate-400 mt-1">{competent} of {latest.length} competency decisions passing</p>
        </div>
        <div className="grid grid-cols-3 gap-6 text-center">
          <div><p className="text-2xl font-bold">{orgCount ?? 0}</p><p className="text-[10px] text-slate-400">Organisations</p></div>
          <div><p className="text-2xl font-bold">{facilityCount ?? 0}</p><p className="text-[10px] text-slate-400">Facilities</p></div>
          <div><p className="text-2xl font-bold">{workerCount ?? 0}</p><p className="text-[10px] text-slate-400">Workers</p></div>
        </div>
      </div>

      {/* Risk row */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Enterprise Risk</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Critical Failures", value: criticalFailures, color: "text-red-700", bg: "bg-red-50" },
          { label: "Expired Competencies", value: expired, color: "text-orange-600", bg: "bg-orange-50" },
          { label: "Due ≤60d", value: dueSoon, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Credentials Expiring", value: credExpiring, color: "text-amber-700", bg: "bg-amber-50" },
        ].map(c => (
          <div key={c.label} className={`${c.bg} rounded-xl px-4 py-3`}>
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Governance + workforce row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Governance</h3>
          <Row label="Frameworks published" value={published} />
          <Row label="In review" value={inReview} highlight={inReview > 0} />
          <Row label="Content approvals pending" value={pendingApprovals ?? 0} highlight={(pendingApprovals ?? 0) > 0} href="/super-admin/audit" />
          <Row label="Expired credentials" value={credExpired} highlight={credExpired > 0} />
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Workforce Authorization</h3>
          <Row label="Active clinical authorizations" value={activeAuths ?? 0} />
          <Row label="Competent decisions" value={competent} />
          <Row label="Total decisions on record" value={latest.length} />
          <div className="mt-3 pt-3 border-t border-gray-50">
            <Link href="/super-admin/organisations" className="text-xs text-rose-600 font-semibold hover:underline">View organisations →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight, href }: { label: string; value: number; highlight?: boolean; href?: string }) {
  const content = (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-bold ${highlight ? "text-amber-600" : "text-gray-800"}`}>{value}</span>
    </div>
  );
  return href ? <Link href={href} className="block hover:bg-gray-50 -mx-2 px-2 rounded">{content}</Link> : content;
}
