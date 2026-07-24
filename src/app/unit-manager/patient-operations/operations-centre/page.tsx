import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOpsCentre } from "@/lib/operations/pos-operations-centre";
import { templateByKey } from "@/lib/operations/pos-form-templates";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import OpsCentreConsole from "./OpsCentreConsole";
import FormActions from "./FormActions";

export const dynamic = "force-dynamic";

// Patient Operations Centre (POS-106) — the operational data-entry & workflow command surface.
// Replaces the static placeholder with an active surface: live summary widgets (§5), the
// seven-group workflow catalogue with a functional form drawer (§6), and real work queues (§7)
// over the POS-106 form engine (op_form_instances / op_form_events, migration 084) + the shared
// operational model. One entry, distributed everywhere.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const tname = (k: string) => templateByKey(k)?.name ?? k;
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString([], { day: "2-digit", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`; };
const STATE_TONE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", in_progress: "bg-sky-100 text-sky-700", submitted: "bg-indigo-100 text-indigo-700", awaiting_verification: "bg-violet-100 text-violet-700", returned: "bg-amber-100 text-amber-700", verified: "bg-emerald-100 text-emerald-700", finalised: "bg-emerald-100 text-emerald-700" };

export default async function OperationsCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadOpsCentre(admin, profile?.hospital_id ?? null, isSuper, user.id) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Operations Centre</h1><p className="text-sm text-gray-500">Capture an operational event once — it persists, times-stamps, updates state and distributes everywhere.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const w = d.widgets;
  const widgets = [
    { label: "Active patients", value: w.activePatients, href: "/unit-manager/patient-operations/census", icon: "🧑‍🤝‍🧑", tone: "text-gray-900" },
    { label: "Forms awaiting", value: w.formsAwaiting, href: "#my-pending", icon: "📝", tone: w.formsAwaiting ? "text-sky-600" : "text-gray-400" },
    { label: "Overdue actions", value: w.overdueActions, href: "#overdue", icon: "⏰", tone: w.overdueActions ? "text-rose-600" : "text-gray-400" },
    { label: "Active escalations", value: w.activeEscalations, href: "#escalations", icon: "🚨", tone: w.activeEscalations ? "text-rose-600" : "text-gray-400" },
    { label: "Pending transfers", value: w.pendingTransfers, href: "/unit-manager/patient-operations/flow", icon: "🔄", tone: w.pendingTransfers ? "text-amber-600" : "text-gray-400" },
    { label: "Expected discharges", value: w.expectedDischarges, href: "/unit-manager/patient-operations/flow", icon: "🏠", tone: "text-teal-600" },
  ];
  const patients = d.po.active.map((p: any) => ({ id: p.id, label: `${p.bed ? p.bed + " · " : ""}${p.label}`, state: p.state }));
  const q = d.queues;

  return (
    <div className="space-y-4">
      {header}

      {/* Role-context banner (§3) */}
      <div className={`${card} px-4 py-2.5 flex items-center gap-3 flex-wrap text-xs`}>
        <span className="font-semibold text-gray-700">Role: {roles.includes("super_admin") ? "Super Admin" : "Unit Manager"}</span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-500">Oversight &amp; governed initiation — submitted records are amended, never overwritten.</span>
        {!d.provisioned && <span className="ml-auto text-amber-700 bg-amber-50 rounded px-2 py-0.5">Form engine store (migration 084) not provisioned</span>}
      </div>

      {/* Operational summary widgets (§5) — clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {widgets.map(k => (
          <Link key={k.label} href={k.href} className={`${card} p-4 hover:border-emerald-300 transition-colors`}>
            <div className="flex items-start justify-between"><p className="text-xs text-gray-500">{k.label}</p><span className="text-base opacity-40">{k.icon}</span></div>
            <p className={`text-2xl font-bold tabular-nums mt-1 ${k.tone}`}>{k.value}</p>
          </Link>
        ))}
      </div>

      {/* Interactive: quick actions + workflow catalogue + form drawer */}
      <OpsCentreConsole patients={patients} counts={d.countsByTemplate} />

      {/* Work queues (§7) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Queue id="my-pending" title="My pending forms" empty="You have no drafts in progress.">
          {q.myPending.map((i: any) => <Row key={i.id} patient={i.patient} label={tname(i.template_key)} state={i.state} overdue={i.overdue} at={i.updated_at} />)}
        </Queue>
        <Queue id="unit-pending" title="Unit pending forms" empty="No forms in progress on the unit.">
          {q.unitPending.map((i: any) => <Row key={i.id} patient={i.patient} label={`${tname(i.template_key)} · ${i.by}`} state={i.state} overdue={i.overdue} at={i.updated_at} />)}
        </Queue>
        <Queue id="verification" title="Awaiting verification" empty="Nothing awaiting verification.">
          {q.awaitingVerification.map((i: any) => (
            <div key={i.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 text-xs">
              <span className="flex items-center gap-2 min-w-0"><span className="text-gray-700 truncate">{i.patient}</span><span className="text-gray-400 truncate">{tname(i.template_key)} · {i.by}</span></span>
              <FormActions id={i.id} />
            </div>
          ))}
        </Queue>
        <Queue id="overdue" title="Overdue actions" empty="No overdue forms. 🎉">
          {q.overdue.map((i: any) => <Row key={i.id} patient={i.patient} label={tname(i.template_key)} state={i.state} overdue at={i.due_at} />)}
        </Queue>
        <Queue id="escalations" title="Unresolved escalations" empty="No open escalations.">
          {q.escalations.map((e: any) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 text-xs">
              <span className="flex items-center gap-2 min-w-0"><span className="text-gray-700 truncate">{e.patient}</span><span className="text-gray-400">L{e.level}</span></span>
              <span className="flex items-center gap-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${["critical", "high", "emergency"].includes(e.severity) ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{e.severity}</span><Link href="/unit-manager/patient-operations/safety" className="text-emerald-700 hover:underline">Open</Link></span>
            </div>
          ))}
        </Queue>
        <Queue id="recent" title="Recent events" empty="No operational events recorded yet.">
          {q.recentEvents.map((e: any) => (
            <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 text-xs">
              <span className="flex items-center gap-2 min-w-0"><span className="text-gray-700 truncate">{e.op_patients?.label ?? "—"}</span><span className="text-gray-400 truncate">{e.event_type}</span></span>
              <span className="text-gray-400 tabular-nums shrink-0">{fmtDateTime(e.created_at)}</span>
            </div>
          ))}
        </Queue>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Patient Operations Centre (POS-106) over the form engine (op_form_instances / op_form_events, migration 084) + the shared operational model. Real: the seven-group workflow catalogue, functional form drawer (save draft / submit → immutable event + patient timeline + tasks/escalations/notes), lifecycle with verification (§8.2), live summary widgets and work queues. Honest next-phase: full tenant-configurable field templates (POS-112), EMR/bed state-transition enforcement for admission/transfer/discharge completion (BR-002/003/004/005), notification SLAs (§12) and the offline draft queue (§15). Admission is actioned in the operational <Link href="/supervisor/patient-ops-center" className="text-emerald-700 hover:underline">Admissions workflow</Link>.</p>
    </div>
  );
}

function Queue({ id, title, empty, children }: { id: string; title: string; empty: string; children: any }) {
  const items = Array.isArray(children) ? children : [children];
  const has = items.some(Boolean) && items.length > 0 && items.flat().filter(Boolean).length > 0;
  return (
    <div id={id} className={`${card} p-5 scroll-mt-4`}>
      <h3 className="text-sm font-bold text-gray-900 mb-2">{title}</h3>
      {has ? <div>{children}</div> : <p className="text-sm text-gray-400">{empty}</p>}
    </div>
  );
}

function Row({ patient, label, state, overdue, at }: { patient: string; label: string; state: string; overdue?: boolean; at?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-50 text-xs">
      <span className="flex items-center gap-2 min-w-0"><span className="text-gray-700 truncate">{patient}</span><span className="text-gray-400 truncate">{label}</span></span>
      <span className="flex items-center gap-2 shrink-0">
        {at && <span className="text-[10px] text-gray-400 tabular-nums">{fmtDateTime(at)}</span>}
        {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700">overdue</span>}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATE_TONE[state] ?? "bg-gray-100 text-gray-600"}`}>{state.replace(/_/g, " ")}</span>
      </span>
    </div>
  );
}
