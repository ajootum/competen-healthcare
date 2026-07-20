import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, STATE_TONE } from "@/lib/operations/patient-ops";
import FlowBlockersPanel from "./FlowBlockersPanel";

export const dynamic = "force-dynamic";

// Patient Flow (SSW-005 / Patient Operations §Flow) — coordinate admissions,
// transfers, theatre movement and discharges. Shares the one patient/bed/flow
// model in lib/operations/patient-ops. Flow blockers are ONLY those we can
// derive live (po.blockers); predictive congestion forecasting and richer
// blocker tracking are surfaced as honest callouts, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

const ACTIONS: { label: string; href: string }[] = [
  { label: "Allocate Bed", href: "/supervisor/bed-management" },
  { label: "Request Transport", href: "/supervisor/operations?section=ward" },
  { label: "Approve Transfer", href: "/supervisor/operations?section=ward" },
  { label: "Start Discharge Checklist", href: "/supervisor/operations?section=care" },
  { label: "Escalate Delay", href: "/supervisor/operations?section=safety" },
];

export default async function PatientFlow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const po = await loadPatientOps(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Patient Flow</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );

  const { flow, blockers, flowMetrics } = po;
  const flowPatients = po.active.map((p: any) => ({ id: p.id, label: p.label }));

  // B) Flow summary KPIs (each is a live count off the shared flow pipeline).
  const kpis = [
    { label: "Expected admissions", n: flow.expected.length + flow.awaitingBed.length, tone: "text-gray-900" },
    { label: "Awaiting bed", n: flow.awaitingBed.length, tone: flow.awaitingBed.length ? "text-orange-600" : "text-gray-400" },
    { label: "In care", n: flow.inCare.length, tone: "text-teal-700" },
    { label: "Transfer / Theatre", n: flow.transferTheatre.length, tone: flow.transferTheatre.length ? "text-indigo-600" : "text-gray-400" },
    { label: "Discharge ready", n: flow.dischargeReady.length, tone: flow.dischargeReady.length ? "text-teal-600" : "text-gray-400" },
    { label: "Discharged", n: flow.discharged.length, tone: "text-gray-400" },
  ];

  // C) Kanban pipeline columns — Expected → Awaiting Bed → In Care → Transfer/Theatre → Discharge Ready → Discharged.
  const columns: { title: string; list: any[]; dot: string }[] = [
    { title: "Expected", list: flow.expected, dot: "bg-gray-400" },
    { title: "Awaiting Bed", list: flow.awaitingBed, dot: "bg-orange-500" },
    { title: "In Care", list: flow.inCare, dot: "bg-teal-500" },
    { title: "Transfer / Theatre", list: flow.transferTheatre, dot: "bg-indigo-500" },
    { title: "Discharge Ready", list: flow.dischargeReady, dot: "bg-teal-400" },
    { title: "Discharged", list: flow.discharged, dot: "bg-gray-300" },
  ];

  const FlowCard = ({ p }: { p: any }) => (
    <div className="rounded-lg border border-gray-100 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-800 truncate">{p.label}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${STATE_TONE[p.state] ?? "bg-gray-100 text-gray-600"}`}>{p.state}</span>
      </div>
      <p className="text-[11px] text-gray-400 truncate mt-0.5 tabular-nums">{[p.bed ?? "no bed", p.nurse ?? "unassigned"].join(" · ")}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* A) Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Patient Flow</h1>
        <p className="text-sm text-gray-500 mt-1">Track patient movement &amp; flow</p>
      </div>

      {/* B) Flow summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={card + " py-4"}>
            <p className={`text-3xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-xs text-gray-500 mt-1 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* B2) Flow analytics — real metrics from movement events + turnaround */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([["Average LOS", flowMetrics.avgLosDays != null ? `${flowMetrics.avgLosDays} days` : "—"], ["Bed turnaround", flowMetrics.avgTurnaroundH != null ? `${flowMetrics.avgTurnaroundH} hrs` : "—"], ["Delayed discharges", String(flowMetrics.delayedDischarges)], ["Awaiting bed", String(flowMetrics.awaitingBed)]] as [string, string][]).map(([l, v]) => (
          <div key={l} className={card + " py-3"}>
            <p className="text-xl font-bold tabular-nums text-gray-900">{v}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{l}</p>
          </div>
        ))}
      </div>

      {/* C) Kanban pipeline */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Flow pipeline</h2>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map(col => (
            <div key={col.title} className={card + " w-64 shrink-0"}>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />{col.title}
                <span className="text-gray-400 font-normal tabular-nums">({col.list.length})</span>
              </h3>
              <div className="space-y-2 max-h-[30rem] overflow-y-auto">
                {col.list.length === 0 && <p className="text-sm text-gray-400">Empty.</p>}
                {col.list.map((p: any) => <FlowCard key={p.id} p={p} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* D) Flow blockers — logged (resolvable) + auto-detected */}
      <FlowBlockersPanel blockers={po.flowBlockers} auto={blockers} patients={flowPatients} configReady={po.flowBlockersReady} />

      {/* E) Operational queues + actions */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900">Operational queues</h3>
        <p className="text-sm text-gray-500 mt-1">Route each movement to its live operational surface — no action is a dead end.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {ACTIONS.map(a => (
            <Link key={a.label} href={a.href} className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-1.5 transition-colors">
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* F) Honest note */}
      <p className="text-[11px] text-gray-400">Predictive flow &amp; congestion forecasting — anticipated arrivals, projected bed demand and bottleneck warnings — activates with the flow-tracking module. Figures above reflect current live movement only.</p>
    </div>
  );
}
