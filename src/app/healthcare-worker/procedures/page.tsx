import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyProcedures, type ProcedureRow } from "@/lib/hww/procedures";
import { titleCase, fmtWhen, Chip, StatCard, SectionCard, Empty } from "@/lib/hww/kit";
import RecordProcedure from "./RecordProcedure";

// Clinical Procedures (HWW-UI-005 s1). The module the sidebar used to grey out.
//
// THE POINT OF THE PAGE is that "nothing to do" and "nothing is recorded" look different. A greyed nav row
// said the second while implying the first; this page states whichever is true, and when the store is
// genuinely absent it says so and names the migration instead of showing a reassuring empty list.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  planned: "bg-[var(--cmp-surface-information)] text-blue-700",
  due: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  in_progress: "bg-indigo-100 text-indigo-700",
  completed: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  abandoned: "bg-gray-100 text-gray-500",
};

function Row({ p }: { p: ProcedureRow }) {
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-800">{p.procedure_name}</span>
        <Chip tone={STATUS_TONE[p.status] ?? STATUS_TONE.due}>{titleCase(p.status)}</Chip>
        {p.category === "non_clinical" && <Chip tone="bg-gray-100 text-gray-600">Non-clinical</Chip>}
        {/* Consent and site ride at the top of the row, not in a details drawer: they are the fields a
            second pair of eyes is scanning for. An absent consent record is shown as absent, never as no. */}
        {p.consent_obtained === true && <Chip tone="bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]">Consent recorded</Chip>}
        {p.consent_obtained === false && <Chip tone="bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]">No consent</Chip>}
        {p.consent_obtained === null && p.category === "clinical" && <Chip tone="bg-gray-100 text-gray-500">Consent not recorded</Chip>}
        {p.site && <Chip tone="bg-cyan-100 text-cyan-700">{p.site}{p.laterality && p.laterality !== "not_applicable" ? ` · ${titleCase(p.laterality)}` : ""}</Chip>}
        {p.complications && <Chip tone="bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]">Complication</Chip>}
        <span className="ml-auto text-[11px] text-gray-400">{fmtWhen(p.completed_at ?? p.started_at ?? p.scheduled_for)}</span>
      </div>
      <p className="text-sm text-gray-600 mt-1">
        <span className="text-gray-400">{p.op_patients?.label ?? "Patient"}{p.op_patients?.op_beds?.label ? ` · ${p.op_patients.op_beds.label}` : ""} —</span>{" "}
        {p.outcome ?? p.notes ?? "No outcome recorded yet."}
      </p>
      {p.complications && <p className="text-xs text-[var(--cmp-text-critical)] mt-0.5">Complication: {p.complications}</p>}
      {p.performed_by_name && <p className="text-[11px] text-gray-400 mt-0.5">Performed by {p.performed_by_name}</p>}
    </div>
  );
}

export default async function ProceduresPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();

  const { data: myAsg } = await admin.from("op_patient_assignments")
    .select("patient_id, op_patients!patient_id(id, label)")
    .eq("staff_id", user.id).eq("status", "active").limit(100);
  const patients = ((myAsg ?? []) as any[])
    .map(r => ({ id: r.patient_id as string, label: (r.op_patients?.label as string) ?? "Patient" }))
    .filter(p => p.id);

  const v = await loadMyProcedures(admin, patients.map(p => p.id));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-gray-300 tracking-widest">HWW-UI-005</p>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Procedures</h1>
          <p className="text-sm text-gray-500">Clinical and non-clinical procedures for the patients assigned to you.</p>
        </div>
        {v.ready && patients.length > 0 && <RecordProcedure patients={patients} />}
      </div>

      {!v.ready ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-3xl mb-2">🩹</p>
          <p className="text-sm font-semibold text-gray-900">Procedures — coming soon</p>
          {/* Named, not vague. "Coming soon" with no reason is how a missing migration hides for months. */}
          <p className="text-[12px] text-gray-500 mt-1 max-w-md mx-auto">{v.reason}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon="⏳" title="Due" value={v.stats.due} />
            <StatCard icon="▶️" title="In progress" value={v.stats.inProgress} />
            <StatCard icon="✅" title="Completed today" value={v.stats.completedToday} />
            <StatCard icon="⚠️" title="With complications" value={v.stats.withComplications}
              tone={v.stats.withComplications ? "text-[var(--cmp-text-critical)]" : undefined} />
          </div>

          <SectionCard icon="🩹" title="Due and in progress" count={v.due.length}>
            <div className="divide-y divide-gray-50">
              {v.due.length === 0 && (
                <Empty>
                  No procedures due.{" "}
                  {patients.length === 0
                    ? "You have no patients assigned, so there is nothing to show yet."
                    : "Record one as you perform it — the record is what makes it auditable."}
                </Empty>
              )}
              {v.due.map(p => <Row key={p.id} p={p} />)}
            </div>
          </SectionCard>

          <SectionCard icon="🗂️" title="Recently completed" count={v.recent.length}>
            <div className="divide-y divide-gray-50">
              {v.recent.length === 0 && <Empty>Nothing completed yet for your patients.</Empty>}
              {v.recent.map(p => <Row key={p.id} p={p} />)}
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
