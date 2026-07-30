import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadConcernQueue, isOverdue } from "@/lib/hww/concerns";
import QueueActions from "./QueueActions";

// Nurse Concerns Queue (HWW-ADD-001 §SSW Integration) — the supervisor's review
// surface: every active bedside concern on the tenant, priority-ranked with
// overdue highlighting, the pre-ward-round list (concerns flagged for the
// doctor's round), per-patient counts, and the review workflow (acknowledge →
// route → ward-round actions → resolve). Resolved concerns leave the queue but
// remain auditable. Server-rendered over the same engine as the nurse's lens.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";
const PRIO_TONE: Record<string, string> = { immediate: "bg-red-100 text-red-700", urgent: "bg-orange-100 text-orange-700", today: "bg-amber-100 text-amber-700", routine: "bg-gray-100 text-gray-500" };
const STATUS_TONE: Record<string, string> = { open: "bg-blue-100 text-blue-700", in_progress: "bg-amber-100 text-amber-700", carried_forward: "bg-purple-100 text-purple-700" };

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={card}>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function ConcernRow({ c }: { c: any }) {
  const overdue = isOverdue(c);
  return (
    <div className={`py-3 ${overdue ? "bg-red-50/40 -mx-2 px-2 rounded-lg" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-800">{c.op_patients?.label ?? "Patient"}</span>
        {c.op_patients?.op_beds?.label && <span className="text-xs text-gray-400">{c.op_patients.op_beds.label}</span>}
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${PRIO_TONE[c.priority] ?? PRIO_TONE.routine}`}>{titleCase(c.priority)}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_TONE[c.status] ?? STATUS_TONE.open}`}>{titleCase(c.status)}</span>
        {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">Overdue</span>}
        {c.ward_round && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Ward round</span>}
        {c.ss_review && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">SS review</span>}
        {c.routed_to && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700">→ {titleCase(c.routed_to)}{c.acknowledged_at ? " ✓" : ""}</span>}
        <span className="ml-auto text-[11px] text-gray-400">{c.raiser?.full_name ?? c.raised_by_name ?? "—"} · {fmtWhen(c.raised_at)}</span>
      </div>
      <p className="text-sm text-gray-600 mt-1"><span className="text-gray-400">{titleCase(c.category)} —</span> {c.description}</p>
      {(c.op_concern_actions ?? []).length > 0 && (
        <div className="mt-1.5 space-y-1">
          {(c.op_concern_actions ?? []).map((a: any) => (
            <p key={a.id} className="text-xs text-gray-500 flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status === "completed" ? "bg-green-500" : a.status === "cancelled" ? "bg-gray-300" : "bg-amber-500"}`} />
              {a.action}
              <span className="text-gray-400">· {a.owner_name ?? "unassigned"}{a.task_id ? " · live task" : ""}</span>
            </p>
          ))}
        </div>
      )}
      <QueueActions id={c.id} acknowledged={!!c.acknowledged_at} routedTo={c.routed_to ?? null} />
    </div>
  );
}

export default async function SupervisorConcernsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isSuperUser = roles.includes("super_admin");

  const data = await loadConcernQueue(admin, profile?.hospital_id ?? null, isSuperUser);
  const wardRound = data.concerns.filter((c: any) => c.ward_round);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Nurse Concerns Queue</h1>
        <p className="text-sm text-gray-500 mt-1">Bedside concerns pushed from the Healthcare Worker Workspace — review before the ward round, route, convert to actions, resolve.</p>
      </div>

      {data.migrationMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">152-nurse-concerns.sql</code> to enable Nurse Concerns.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Active concerns" value={data.kpis.active} />
        <Kpi label="Immediate / urgent" value={data.kpis.immediate + data.kpis.urgent} tone={data.kpis.immediate + data.kpis.urgent > 0 ? "text-red-600" : undefined} />
        <Kpi label="Overdue" value={data.kpis.overdue} tone={data.kpis.overdue > 0 ? "text-red-600" : undefined} />
        <Kpi label="For ward round" value={data.kpis.wardRound} tone={data.kpis.wardRound > 0 ? "text-indigo-600" : undefined} />
        <Kpi label="SS review requested" value={data.kpis.ssReview} tone={data.kpis.ssReview > 0 ? "text-orange-600" : undefined} />
        <Kpi label="Carried forward" value={data.kpis.carried} />
      </div>

      {data.perPatient.length > 0 && (
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Open concerns per patient</p>
          <div className="flex flex-wrap gap-2">
            {data.perPatient.map((p: any) => (
              <span key={p.patient_id} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
                <span className="text-gray-700">{p.label}</span>
                <span className="font-bold text-teal-700 tabular-nums">{p.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {wardRound.length > 0 && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🩺 Pre-Ward-Round Review <span className="text-gray-400 font-normal">({wardRound.length})</span></h3>
          <p className="text-xs text-gray-400 mb-1">Concerns flagged for the doctor&apos;s round — review and convert agreed decisions into structured actions.</p>
          <div className="divide-y divide-gray-100">
            {wardRound.map((c: any) => <ConcernRow key={c.id} c={c} />)}
          </div>
        </div>
      )}

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🚩 Full Active Queue <span className="text-gray-400 font-normal">({data.concerns.length})</span></h3>
        <div className="divide-y divide-gray-100">
          {data.concerns.length === 0 && !data.migrationMissing && <p className="text-sm text-gray-400">No active concerns. Bedside nurses raise them in the Healthcare Worker Workspace; they appear here immediately.</p>}
          {data.concerns.map((c: any) => <ConcernRow key={c.id} c={c} />)}
        </div>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">Resolved concerns leave this queue but remain in the record and the audit log. Priority response windows: immediate 1h · urgent 4h · today 8h · routine 24h.</p>
    </div>
  );
}
