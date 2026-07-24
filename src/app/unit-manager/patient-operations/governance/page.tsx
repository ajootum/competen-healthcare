import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernance } from "@/lib/operations/pos-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import GovernanceConsole from "./GovernanceConsole";

export const dynamic = "force-dynamic";

// Patient Operations Governance (POS-106A §10) — the Unit Manager Governance Mode. NOT a data-entry
// module: a purpose-built oversight surface over the SAME shared POS-106 service and object
// identifiers (op_form_instances) plus the governance stores (op_exceptions / op_amendment_requests,
// migration 087). §10.1 dashboard + §10.2 governance actions (approve exceptions, decide amendments,
// return deficient forms, open evidence). Operational data entry lives in the SSW.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString([], { day: "2-digit", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`; };

export default async function PatientOperationsGovernance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadGovernance(admin, profile?.hospital_id ?? null, isSuper, user.id) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Operations Governance</h1><span className="text-[10px] font-bold uppercase tracking-wide bg-violet-100 text-violet-700 rounded px-1.5 py-0.5">Governance Mode</span></div>
          <p className="text-sm text-gray-500">Oversight, approvals, exceptions, amendments and audit — over the one shared operational record.</p>
        </div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const w = d.widgets;
  const kpis = [
    { label: "Exceptions", value: w.exceptions, href: "#exceptions", tone: w.exceptions ? "text-rose-600" : "text-gray-400" },
    { label: "Amendment requests", value: w.amendmentRequests, href: "#exceptions", tone: w.amendmentRequests ? "text-violet-600" : "text-gray-400" },
    { label: "Returned forms", value: w.returnedForms, href: "#exceptions", tone: w.returnedForms ? "text-amber-600" : "text-gray-400" },
    { label: "Awaiting verification", value: w.awaitingVerification, href: "#exceptions", tone: w.awaitingVerification ? "text-indigo-600" : "text-gray-400" },
    { label: "Escalation oversight", value: w.escalationOversight, href: "/unit-manager/patient-operations/safety", tone: w.escalationOversight ? "text-rose-600" : "text-gray-400" },
    { label: "Overdue actions", value: w.overdueActions, href: "/unit-manager/patient-operations/operations-centre", tone: w.overdueActions ? "text-rose-600" : "text-gray-400" },
    { label: "Transfer delays", value: w.transferDelays, href: "/unit-manager/patient-operations/flow", tone: w.transferDelays ? "text-amber-600" : "text-gray-400" },
    { label: "Discharge barriers", value: w.dischargeBarriers, href: "/unit-manager/patient-operations/flow", tone: "text-teal-600" },
  ];

  return (
    <div className="space-y-4">
      {header}

      {!d.exProvisioned && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800"><b>Governance stores not provisioned.</b> Migration 087 (op_exceptions / op_amendment_requests) isn&apos;t applied yet — exception &amp; amendment queues activate once it&apos;s run.</div>}

      {/* §10.1 governance dashboard KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpis.map(k => (
          <Link key={k.label} href={k.href} className={`${card} p-4 hover:border-emerald-300 transition-colors`}>
            <p className="text-xs text-gray-500 leading-tight">{k.label}</p>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${k.tone}`}>{k.value}</p>
          </Link>
        ))}
      </div>

      {/* §10.2 governance actions */}
      <div id="exceptions" className="scroll-mt-4">
        <GovernanceConsole exceptions={d.exceptions} amendments={d.amendments} returned={d.returned} />
      </div>

      {/* Risk concentration + audit activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Risk concentration</h3>
          {d.riskZones.length === 0 ? <p className="text-sm text-gray-400">No high-acuity clusters.</p> : (
            <div className="space-y-2">{d.riskZones.map((z: any) => (
              <div key={z.name} className="flex items-center justify-between text-xs"><span className="text-gray-700">{z.name}</span><span className="flex items-center gap-2"><span className="text-rose-600 font-medium">{z.highRisk} high-acuity</span><span className="text-gray-400">· {z.staff} nurse{z.staff === 1 ? "" : "s"}{z.ratio != null ? ` · ${z.ratio}:1` : ""}</span></span></div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Audit activity</h3>
          {d.audit.length === 0 ? <p className="text-sm text-gray-400">No recent activity.</p> : (
            <div className="divide-y divide-gray-50">{d.audit.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="min-w-0 truncate"><span className="text-gray-700">{a.action.replace(/_/g, " ")}</span> <span className="text-gray-400">· {a.actor?.full_name ?? "—"}</span></span><span className="text-gray-400 shrink-0 tabular-nums">{fmtDateTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Patient Operations Governance (POS-106A §10) — the Unit Manager Governance Mode over op_form_instances + op_exceptions / op_amendment_requests (migration 087). Real: the §10.1 dashboard, exception approvals, amendment decisions (approve → new linked version, original preserved), returning deficient forms and audit activity — all on the shared record, never a duplicate (§1). Honest next-phase: the full ABAC policy decision point, Intelligence (read-only) Mode, optimistic-concurrency version tokens (§12.1) and notification SLAs. Operational data entry is performed in the <Link href="/supervisor/patient-operations/operations-centre" className="text-emerald-700 hover:underline">SSW Operations Centre</Link>.</p>
    </div>
  );
}
