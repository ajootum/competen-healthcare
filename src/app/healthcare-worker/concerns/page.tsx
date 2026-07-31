import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyConcerns, isOverdue } from "@/lib/hww/concerns";
import { titleCase, fmtWhen, PrioChip, Chip, StatCard, SectionCard, Empty } from "@/lib/hww/kit";
import RaiseConcern from "./RaiseConcern";
import { ConcernRowActions, CompleteAction } from "./ConcernRowActions";

// Nurse Concerns (HWW-ADD-001) — the bedside nurse's structured concern lens:
// raise category+priority concerns on assigned patients, flag them for ward
// round or supervisor review, track them to resolution or carry them across
// handover, and work the ward-round actions assigned back to me. Operational
// records, not medical notes. Server-rendered over migration 152.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  open: "bg-[var(--cmp-surface-information)] text-blue-700", in_progress: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  resolved: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", carried_forward: "bg-purple-100 text-purple-700",
};

function ConcernCard({ c, mine }: { c: any; mine: boolean }) {
  const overdue = isOverdue(c);
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-800">{c.op_patients?.label ?? "Patient"}</span>
        {c.op_patients?.op_beds?.label && <span className="text-xs text-gray-400">{c.op_patients.op_beds.label}</span>}
        <Chip tone={STATUS_TONE[c.status] ?? STATUS_TONE.open}>{titleCase(c.status)}</Chip>
        <PrioChip p={c.priority} />
        {overdue && <Chip tone="bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]">Overdue</Chip>}
        {c.ward_round && <Chip tone="bg-indigo-100 text-indigo-700">Ward round</Chip>}
        {c.ss_review && <Chip tone="bg-[var(--cmp-surface-warning)] text-orange-700">SS review</Chip>}
        {c.routed_to && <Chip tone="bg-cyan-100 text-cyan-700">→ {titleCase(c.routed_to)}{c.acknowledged_at ? " ✓" : ""}</Chip>}
        <span className="ml-auto text-[11px] text-gray-400">{fmtWhen(c.raised_at)}</span>
      </div>
      <p className="text-sm text-gray-600 mt-1"><span className="text-gray-400">{titleCase(c.category)} —</span> {c.description}</p>
      {!mine && c.raised_by_name && <p className="text-[11px] text-gray-400 mt-0.5">Raised by {c.raised_by_name}</p>}
      {c.status === "resolved" && c.resolution_notes && <p className="text-xs text-[var(--cmp-text-success)] mt-1">Resolved: {c.resolution_notes}</p>}
      {(c.op_concern_actions ?? []).length > 0 && (
        <div className="mt-1.5 space-y-1">
          {(c.op_concern_actions ?? []).map((a: any) => (
            <p key={a.id} className="text-xs text-gray-500 flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.status === "completed" ? "bg-[var(--cmp-color-success)]" : a.status === "cancelled" ? "bg-gray-300" : "bg-[var(--cmp-color-warning)]"}`} />
              {a.action}
              <span className="text-gray-400">· {a.owner_name ?? "unassigned"}{a.task_id ? " · task" : ""}{a.due_at ? ` · due ${fmtWhen(a.due_at)}` : ""}</span>
            </p>
          ))}
        </div>
      )}
      <ConcernRowActions id={c.id} status={c.status} />
    </div>
  );
}

export default async function NurseConcernsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();

  const data = await loadMyConcerns(admin, user.id);

  // Patient picker: the nurse's REAL active assignments.
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("op_patients!patient_id(id, label, op_beds!bed_id(label))")
    .eq("staff_id", user.id).eq("status", "active").limit(50);
  const patients = ((asg ?? []) as any[])
    .filter(a => a.op_patients)
    .map(a => ({ id: a.op_patients.id, label: a.op_patients.label, bed: a.op_patients.op_beds?.label ?? null }));

  const active = (s: any[]) => s.filter(c => ["open", "in_progress", "carried_forward"].includes(c.status));
  const myActive = active(data.raised);
  const overdueCount = [...myActive, ...active(data.onMyPatients)].filter(c => isOverdue(c)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Nurse Concerns</h1>
          <p className="text-sm text-gray-500 mt-1">Structured bedside concerns — routed to your supervisor and the ward round, carried across handover until resolved.</p>
        </div>
      </div>

      {data.migrationMissing && (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">152-nurse-concerns.sql</code> to enable the Nurse Concerns module.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🚩" title="My Active Concerns" value={myActive.length}
          sub={`${data.raised.length - myActive.length} resolved`} />
        <StatCard icon="👥" title="On My Patients" value={active(data.onMyPatients).length} sub="raised by colleagues" />
        <StatCard icon="📋" title="Actions For Me" value={data.actionsForMe.length} sub="from ward-round review" />
        <StatCard icon="⏰" title="Overdue" value={overdueCount} tone={overdueCount > 0 ? "text-[var(--cmp-text-critical)]" : undefined}
          sub="beyond priority response window" />
      </div>

      <RaiseConcern patients={patients} />

      {data.actionsForMe.length > 0 && (
        <SectionCard icon="📋" title="Ward Round Actions Assigned To Me" count={data.actionsForMe.length}>
          <div className="divide-y divide-gray-50">
            {data.actionsForMe.map((a: any) => (
              <div key={a.id} className="py-2.5 flex items-start gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800">{a.action}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {a.op_concerns?.op_patients?.label ?? "Patient"} · {titleCase(a.op_concerns?.category)} concern
                    {a.due_at ? ` · due ${fmtWhen(a.due_at)}` : ""}{a.task_id ? " · also in your task list" : ""}
                  </p>
                </div>
                <PrioChip p={a.op_concerns?.priority} />
                <CompleteAction id={a.id} />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard icon="🚩" title="Concerns I Raised" count={data.raised.length}>
          <div className="divide-y divide-gray-100">
            {data.raised.length === 0 && <Empty>No concerns raised yet. Use “Raise a concern” for anything operational the team should know about.</Empty>}
            {data.raised.map((c: any) => <ConcernCard key={c.id} c={c} mine />)}
          </div>
        </SectionCard>

        <SectionCard icon="👥" title="Active On My Patients" count={active(data.onMyPatients).length}>
          <div className="divide-y divide-gray-100">
            {active(data.onMyPatients).length === 0 && <Empty>No active concerns from colleagues on your assigned patients.</Empty>}
            {active(data.onMyPatients).map((c: any) => <ConcernCard key={c.id} c={c} mine={false} />)}
          </div>
        </SectionCard>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Concerns are operational coordination records — medical diagnoses, prescriptions and physician documentation remain in the EMR. Every status change is audit-logged.
      </p>
    </div>
  );
}
