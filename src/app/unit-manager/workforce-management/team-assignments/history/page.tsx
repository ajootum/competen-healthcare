import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import TeamGovTabs from "../TeamGovTabs";

export const dynamic = "force-dynamic";

// History & Audit (TAG-001 §10) — the immutable decision trail for assignment governance.
// Surfaces assignment changes, deployments, overrides and escalations from audit_log,
// tenant-scoped and append-only. Real. Before/after diff, override register with risk
// acceptance, and formatted report/export need dedicated stores → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";

const ACTIONS: Record<string, { label: string; tone: string; group: string }> = {
  assign_patient: { label: "Patient assigned", tone: "bg-emerald-50 text-emerald-700", group: "Assignment" },
  assign_plan: { label: "Assignment plan", tone: "bg-emerald-50 text-emerald-700", group: "Assignment" },
  deploy_staff: { label: "Staff deployed", tone: "bg-blue-50 text-blue-700", group: "Deployment" },
  command_transfer_initiated: { label: "Command transfer", tone: "bg-violet-50 text-violet-700", group: "Deployment" },
  raise_escalation: { label: "Escalation raised", tone: "bg-amber-50 text-amber-700", group: "Escalation" },
  raise_safety_alert: { label: "Safety alert raised", tone: "bg-rose-50 text-rose-700", group: "Escalation" },
  schedule_break: { label: "Break scheduled", tone: "bg-sky-50 text-sky-700", group: "Breaks" },
};
const ACTION_KEYS = Object.keys(ACTIONS);

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

const weekAgoISO = () => new Date(Date.now() - 7 * 864e5).toISOString();
function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function TeamGovHistory() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const departments = await loadUnitDepartments(admin, hid, isSuper);

  const weekAgo = weekAgoISO();
  let rows: any[] = [];
  let provisioned = true;
  const q = admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").in("action", ACTION_KEYS).order("created_at", { ascending: false }).limit(80);
  const res = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  if (res.error) { provisioned = !/does not exist|schema cache/i.test(res.error.message ?? ""); rows = []; }
  else rows = res.data ?? [];

  const recent = rows.filter(r => r.created_at >= weekAgo);
  const byGroup = (g: string) => recent.filter(r => ACTIONS[r.action]?.group === g).length;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧩</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Team Assignments · History &amp; Audit</h1><p className="text-sm text-gray-500">The immutable decision trail — assignment changes, deployments and escalations.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <TeamGovTabs />
    </>
  );

  return (
    <div className="space-y-4">
      {header}

      {!provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p><p className="text-sm text-amber-800 mt-1">The audit_log table isn&apos;t available yet. Governance history appears once assignment actions are recorded.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Events (7d)" value={recent.length} sub="Governance actions" />
            <Kpi label="Assignment changes" value={byGroup("Assignment")} sub="Assigned / planned" tone="text-emerald-600" />
            <Kpi label="Deployments" value={byGroup("Deployment")} sub="Staff moved" tone="text-blue-600" />
            <Kpi label="Escalations" value={byGroup("Escalation")} sub="Raised in period" tone={byGroup("Escalation") ? "text-amber-600" : undefined} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Ledger */}
            <div className={`${card} p-5 xl:col-span-2`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Governance ledger <span className="text-[10px] text-gray-400 font-normal">latest {rows.length} events · newest first</span></h3>
              {rows.length === 0 ? <p className="text-sm text-gray-400">No assignment governance events recorded yet. Assignments, deployments and escalations appear here as they happen.</p> : (
                <ol className="space-y-0">{rows.map((r, i) => { const a = ACTIONS[r.action] ?? { label: r.action, tone: "bg-gray-100 text-gray-600", group: "" }; return (
                  <li key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.tone}`}>{a.label}</span><span className="text-xs text-gray-700 truncate">{r.entity_name || r.entity_type || "—"}</span></div>
                      <p className="text-[11px] text-gray-400 mt-0.5">{r.actor_name || "System"} · {when(r.created_at)}</p>
                    </div>
                  </li>); })}</ol>
              )}
            </div>

            {/* Override register + reports (honest) */}
            <div className="space-y-4 xl:col-span-1">
              <div className={`${card} p-5`}>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Override register</h3>
                <p className="text-[11px] text-gray-500">Assignment overrides captured today are shown on the <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">Live Overview</Link> (override_reason). A full override register with risk acceptance, approver and expiry needs the override store.</p>
                <span className="mt-2 inline-block text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Next phase</span>
              </div>
              <div className={`${card} p-5`}>
                <h3 className="text-sm font-bold text-gray-900 mb-3">Reports &amp; exports</h3>
                <div className="space-y-2">
                  {["Shift assignment coverage", "Workload balance", "Competency match", "Override governance", "Assignment change audit"].map(rep => (
                    <div key={rep} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5"><p className="text-xs font-semibold text-gray-800">{rep}</p><span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Next phase</span></div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-3">Report generation/export with filters + source-version metadata needs a reporting store — the underlying events are live in audit_log now.</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 pb-4">History &amp; Audit (TAG-001 §10) surfaces the append-only governance trail from audit_log — assignments, deployments, escalations and breaks — tenant-scoped. Before/after change diffs, the override register (risk acceptance + expiry) and formatted report exports are next-phase. Broader unit audit lives in <Link href="/unit-manager/history-audit" className="text-emerald-700 hover:underline">History &amp; Audit</Link>. <Link href="/unit-manager/workforce-management/team-assignments" className="text-emerald-700 hover:underline">← Live Overview</Link></p>
        </>
      )}
    </div>
  );
}
