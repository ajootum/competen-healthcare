import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import StaffEngineTabs from "../StaffEngineTabs";

export const dynamic = "force-dynamic";

// History & Reports (WSE-STAFF-001 §11) — the traceability layer. Every staffing decision the
// engine orchestrates (deploy, open shift, roster generate/publish, config publish, break,
// escalation, safety alert) is recorded in audit_log; this surfaces that decision history and
// summarises it. Real over audit_log. Formatted report generation / export (safe-staffing
// compliance, deployment log, coverage history) needs a reporting store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";

// Staffing-relevant audit actions the engine orchestrates
const ACTIONS: Record<string, { label: string; tone: string; group: string }> = {
  deploy_staff: { label: "Staff deployed", tone: "bg-emerald-50 text-emerald-700", group: "Deployment" },
  open_shift: { label: "Shift opened", tone: "bg-emerald-50 text-emerald-700", group: "Deployment" },
  generate_roster: { label: "Roster generated", tone: "bg-blue-50 text-blue-700", group: "Roster" },
  publish_roster: { label: "Roster published", tone: "bg-blue-50 text-blue-700", group: "Roster" },
  archive_roster: { label: "Roster archived", tone: "bg-gray-100 text-gray-600", group: "Roster" },
  publish_planning_config: { label: "Planning config published", tone: "bg-violet-50 text-violet-700", group: "Config" },
  compute_shift_metrics: { label: "Shift metrics computed", tone: "bg-gray-100 text-gray-600", group: "Metrics" },
  schedule_break: { label: "Break scheduled", tone: "bg-sky-50 text-sky-700", group: "Breaks" },
  raise_escalation: { label: "Escalation raised", tone: "bg-amber-50 text-amber-700", group: "Escalation" },
  raise_safety_alert: { label: "Safety alert raised", tone: "bg-rose-50 text-rose-700", group: "Escalation" },
  command_transfer_initiated: { label: "Command transfer", tone: "bg-amber-50 text-amber-700", group: "Escalation" },
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

export default async function StaffingHistory() {
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

  // Real over audit_log — staffing decisions only, tenant-scoped, fail-soft.
  const weekAgo = weekAgoISO();
  let rows: any[] = [];
  let provisioned = true;
  const q = admin.from("audit_log").select("actor_name, action, entity_type, entity_name, created_at").in("action", ACTION_KEYS).order("created_at", { ascending: false }).limit(80);
  const res = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  if (res.error) { provisioned = !/does not exist|schema cache/i.test(res.error.message ?? ""); rows = []; }
  else rows = res.data ?? [];

  const recent = rows.filter(r => r.created_at >= weekAgo);
  const byGroup = (g: string) => recent.filter(r => ACTIONS[r.action]?.group === g).length;
  const deployments = byGroup("Deployment");
  const rosterOps = byGroup("Roster");
  const configChanges = byGroup("Config");
  const escalations = byGroup("Escalation");

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🧑‍⚕️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staffing Engine · History &amp; Reports</h1><p className="text-sm text-gray-500">Every staffing decision the engine orchestrated — traceable, timestamped, attributed.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <StaffEngineTabs />
    </>
  );

  return (
    <div className="space-y-4">
      {header}

      {!provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p><p className="text-sm text-amber-800 mt-1">The audit_log table isn&apos;t available yet. Decision history appears once staffing actions are recorded.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            <Kpi label="Decisions (7d)" value={recent.length} sub="Staffing actions" />
            <Kpi label="Deployments" value={deployments} sub="Staff & shifts" tone="text-emerald-600" />
            <Kpi label="Roster ops" value={rosterOps} sub="Generated / published" tone="text-blue-600" />
            <Kpi label="Config changes" value={configChanges} sub="Planning model" tone="text-violet-600" />
            <Kpi label="Escalations" value={escalations} sub="Raised in period" tone={escalations ? "text-amber-600" : undefined} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Decision timeline */}
            <div className={`${card} p-5 xl:col-span-2`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Decision history <span className="text-[10px] text-gray-400 font-normal">latest {rows.length} staffing actions</span></h3>
              {rows.length === 0 ? <p className="text-sm text-gray-400">No staffing decisions recorded yet. Deployments, roster publishes and config changes appear here as they happen.</p> : (
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

            {/* Standard reports (honest next-phase) */}
            <div className="space-y-4 xl:col-span-1">
              <div className={`${card} p-5`}>
                <h3 className="text-sm font-bold text-gray-900 mb-3">Standard reports</h3>
                <div className="space-y-2">
                  {[
                    { name: "Safe-staffing compliance", desc: "Coverage vs required, per shift" },
                    { name: "Deployment log", desc: "Who was deployed where, when" },
                    { name: "Coverage history", desc: "SAFE / WATCH / CRITICAL over time" },
                    { name: "Escalation register", desc: "Gaps raised & resolution" },
                  ].map(rep => (
                    <div key={rep.name} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5">
                      <div><p className="text-xs font-semibold text-gray-800">{rep.name}</p><p className="text-[11px] text-gray-400">{rep.desc}</p></div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Next phase</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-3">Formatted report generation &amp; export need a reporting/export store — the decision data itself is live in audit_log now.</p>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 pb-4">History &amp; Reports (WSE-STAFF-001 §11) surfaces the engine&apos;s decision trail from audit_log — deployments, roster generate/publish, planning-config publishes, breaks and escalations, tenant-scoped. Roster history also lives in <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>; live state in <Link href="/unit-manager/workforce-management/staffing-engine/coverage" className="text-emerald-700 hover:underline">Real-Time Coverage</Link>. <Link href="/unit-manager/workforce-management/staffing-engine" className="text-emerald-700 hover:underline">← Overview</Link></p>
        </>
      )}
    </div>
  );
}
