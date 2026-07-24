import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime, titleCase, ewsColor, STATE_TONE } from "@/lib/operations/patient-ops";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";

export const dynamic = "force-dynamic";

// Patient Card Workspace (POS-108) — the Unit Manager's entry point to any patient's
// operational card. Real over the shared model (loadPatientOps): summary, operational
// status, assigned nurse, PEWS + trend, risks/flags, observation timing and open alerts.
// The full operational card (devices, tasks, investigations, per-patient timeline,
// communication, audit history) is the shared SSW surface — cross-linked, not duplicated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const firstName = (n: string | null) => (n ? n.split(" ").filter(Boolean)[0] ?? n : null);

export default async function PatientCardWorkspace({ searchParams }: { searchParams: Promise<{ patient?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [po, departments, sp] = await Promise.all([
    loadPatientOps(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
    searchParams,
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Card</h1><p className="text-sm text-gray-500">Operational summary for any patient — select from the register to open the full card.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />
    </>
  );
  if (!po.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">The Clinical Operations Engine isn&apos;t provisioned for this unit yet.</p></div></div>;

  const selected = sp?.patient ? po.patients.find((x: any) => x.id === sp.patient) : null;

  return (
    <div className="space-y-5">
      {header}

      {!selected ? (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Select a patient</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {po.active.map((p: any) => (
              <Link key={p.id} href={`/unit-manager/patient-operations/patient-card?patient=${p.id}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2.5 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors">
                <div className="min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{p.bed ?? "—"} · {p.label}</p><p className="text-[11px] text-gray-400 truncate">{p.nurse ? firstName(p.nurse) : "unassigned"}{p.stage ? ` · ${titleCase(p.stage)}` : ""}</p></div>
                <div className="flex items-center gap-2 shrink-0"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATE_TONE[p.state] ?? "bg-gray-100 text-gray-600"}`}>{p.state}</span><span className={`text-sm font-bold tabular-nums ${ewsColor(p.pews)}`}>{p.pews ?? "—"}</span></div>
              </Link>
            ))}
            {po.active.length === 0 && <p className="text-sm text-gray-400">No active patients on the register.</p>}
          </div>
        </div>
      ) : (
        <>
          {/* Selected patient card */}
          <div className={`${card} p-5`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ${STATE_TONE[selected.state] ?? "bg-gray-100 text-gray-600"}`}>{selected.bed ?? "—"}</div>
                <div><p className="text-lg font-bold text-gray-900">{selected.label}</p><p className="text-xs text-gray-500">{selected.department ?? "Unit"}{selected.age != null ? ` · ${selected.age}y` : ""}{selected.consultant ? ` · ${selected.consultant}` : ""}</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full ${STATE_TONE[selected.state] ?? "bg-gray-100 text-gray-600"}`}>{selected.state}</span>
                <Link href="/unit-manager/patient-operations/patient-card" className="text-[11px] text-gray-400 hover:text-gray-600">← register</Link>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">
              <Field label="PEWS" value={selected.pews ?? "—"} tone={ewsColor(selected.pews)} />
              <Field label="Operational status" value={selected.opStatus ? titleCase(selected.opStatus) : "—"} />
              <Field label="Stage" value={selected.stage ? titleCase(selected.stage) : "—"} />
              <Field label="Assigned nurse" value={selected.nurse ? firstName(selected.nurse) ?? "—" : "Unassigned"} tone={selected.nurse ? "" : "text-rose-600"} />
              <Field label="Last obs" value={fmtTime(selected.lastObs)} />
              <Field label="Next review" value={fmtTime(selected.nextReview)} tone={selected.overdueObs ? "text-rose-600" : ""} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Risks & flags */}
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Risks &amp; safety flags</h3>
              {selected.flags.length === 0 ? <p className="text-sm text-gray-400">No active safety flags.</p> : <div className="flex flex-wrap gap-1.5">{selected.flags.map((f: string, i: number) => <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">{f}</span>)}</div>}
              {selected.isolation && selected.isolation !== "none" && <p className="text-xs text-fuchsia-600 mt-2">🧫 {titleCase(selected.isolation)} isolation</p>}
            </div>

            {/* Open alerts / escalations */}
            <div className={`${card} p-5`}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Open alerts</h3>
              {(selected.alerts.length === 0 && selected.escalations.length === 0) ? <p className="text-sm text-gray-400">No open alerts or escalations.</p> : (
                <div className="space-y-1.5">
                  {selected.alerts.map((a: any) => <div key={a.id} className="flex items-center gap-2 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-gray-700">{titleCase(a.category)}</span><span className="text-gray-400 ml-auto">{a.severity}</span></div>)}
                  {selected.escalations.map((e: any) => <div key={e.id} className="flex items-center gap-2 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /><span className="text-gray-700">Escalation L{e.level}</span><span className="text-gray-400 ml-auto">{e.status}</span></div>)}
                </div>
              )}
            </div>

            {/* Full card cross-link */}
            <div className={`${card} p-5 flex flex-col`}>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Full operational card</h3>
              <p className="text-xs text-gray-500 flex-1">Devices, tasks, investigations, the per-patient timeline, communication and audit history live in the shared operational Patient Card — one record, no duplication (POS-001 §3.1).</p>
              <div className="flex flex-col gap-2 mt-3">
                <Link href={`/supervisor/patient-card/${selected.id}`} className="text-sm rounded-lg bg-emerald-600 text-white px-3.5 py-2 text-center hover:bg-emerald-700 transition-colors">Open full card →</Link>
                <Link href="/unit-manager/patient-operations/timeline" className="text-sm rounded-lg border border-gray-200 text-gray-700 px-3.5 py-2 text-center hover:border-emerald-300 hover:text-emerald-700 transition-colors">Unit timeline</Link>
              </div>
            </div>
          </div>
        </>
      )}

      <p className="text-[11px] text-gray-400 pb-4">Patient Card Workspace (POS-108) over the shared operational model. Real: operational summary, status, assigned nurse, PEWS, risks/flags, observation timing and open alerts/escalations. The full card&apos;s deeper sections (devices, tasks, investigations, per-patient timeline, communication, audit history) are the shared operational surface — cross-linked to preserve a single source of truth rather than maintaining a second record.</p>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div><p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p><p className={`text-sm font-semibold mt-0.5 ${tone || "text-gray-800"}`}>{value}</p></div>;
}
