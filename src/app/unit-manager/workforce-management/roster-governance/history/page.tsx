import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// History, Audit & Reports (UMW-WFM-004 §18) — preserves all roster governance events. The
// audit ledger is real over audit_log (roster generate/publish/archive). The report catalogue
// (§18.3) + roster-stability metric (§18.4) + exports need a reporting store and version
// history → honest next-phase; the underlying events are live now.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const NONE = "00000000-0000-0000-0000-000000000000";
const ACT: Record<string, { label: string; tone: string }> = {
  generate_roster: { label: "Roster generated", tone: "bg-blue-50 text-blue-700" },
  publish_roster: { label: "Roster published", tone: "bg-emerald-50 text-emerald-700" },
  archive_roster: { label: "Roster archived", tone: "bg-gray-100 text-gray-600" },
};
const ACT_KEYS = Object.keys(ACT);
const weekAgoISO = () => new Date(Date.now() - 7 * 864e5).toISOString();
function when(iso: string): string { const mins = Math.round((new Date().getTime() - new Date(iso).getTime()) / 60000); if (mins < 60) return `${Math.max(1, mins)}m ago`; const h = Math.round(mins / 60); if (h < 24) return `${h}h ago`; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }

const REPORTS = ["Roster Governance Summary", "Coverage Compliance", "Skill-Mix Compliance", "Supervisor Coverage", "Working-Time & Rest", "Overtime Exposure", "Roster Fairness", "Roster Exceptions", "Exception Override", "Approval Timeliness", "Publication & Acknowledgement", "Roster Amendment", "Planned-vs-Actual", "Roster Cost Variance", "Roster Stability"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function HistoryReports() {
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
  const q = admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ACT_KEYS).order("created_at", { ascending: false }).limit(60);
  const res = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  if (res.error) { provisioned = !/does not exist|schema cache/i.test(res.error.message ?? ""); rows = []; }
  else rows = res.data ?? [];
  const recent = rows.filter(r => r.created_at >= weekAgo);
  const cnt = (a: string) => recent.filter(r => r.action === a).length;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · History &amp; Reports</h1><p className="text-sm text-gray-500">The preserved roster governance trail — versions, validations, approvals, publications.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  return (
    <div className="space-y-4">
      {header}
      {!provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Audit store not provisioned</p></div>
      ) : (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Events (7d)" value={recent.length} />
          <Kpi label="Generations" value={cnt("generate_roster")} tone="text-blue-600" />
          <Kpi label="Publications" value={cnt("publish_roster")} tone="text-emerald-600" />
          <Kpi label="Archives" value={cnt("archive_roster")} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className={`${card} p-5 xl:col-span-2`}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">Governance audit ledger <span className="text-[10px] text-gray-400 font-normal">latest {rows.length}</span></h3>
            {rows.length === 0 ? <p className="text-sm text-gray-400">No roster governance events recorded yet.</p> : <ol className="space-y-0">{rows.map((r, i) => { const a = ACT[r.action] ?? { label: r.action, tone: "bg-gray-100 text-gray-600" }; return (<li key={i} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0"><span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.tone}`}>{a.label}</span><span className="text-xs text-gray-700 truncate">{r.entity_name || "roster"}</span></div><p className="text-[11px] text-gray-400 mt-0.5">{r.actor_name || "System"} · {when(r.created_at)}</p></div></li>); })}</ol>}
          </div>

          <div className="space-y-4 xl:col-span-1">
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Roster stability <span className="text-[10px] text-gray-400 font-normal">§18.4</span></h3>
              <p className="text-3xl font-bold text-gray-300">—</p>
              <p className="text-[11px] text-gray-500 mt-1">% of published assignments unchanged before execution. Needs amendment + actual-attendance history.</p>
              <span className="mt-2 inline-block text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Next phase</span>
            </div>
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Standard reports <span className="text-[10px] text-gray-400 font-normal">§18.3</span></h3>
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">{REPORTS.map(r => (<div key={r} className="flex items-center justify-between rounded-lg border border-gray-100 px-2.5 py-1.5"><span className="text-[11px] text-gray-700">{r}</span><span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Soon</span></div>))}</div>
              <p className="text-[10px] text-gray-400 mt-2">PDF/XLSX/CSV export + scheduled email need a reporting store — the events are live in audit_log.</p>
            </div>
          </div>
        </div>
      </>)}
      <p className="text-[11px] text-gray-400 pb-4">History, Audit &amp; Reports (UMW-WFM-004 §18) surfaces the roster governance trail from audit_log. Version history, before/after diffs and formatted report exports are next-phase. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
