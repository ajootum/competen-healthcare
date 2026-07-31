import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMyMedications } from "@/lib/hww/medications";
import { card, titleCase, fmtTime, fmtWhen, StatCard, SectionCard, Empty, Chip } from "@/lib/hww/kit";
import AddMedication from "./AddMedication";
import AdministerMed from "./AdministerMed";

// Medication Summary (HWW-MED-001 / HWW-WARD-001 S5) — the nurse's
// operational medication lens: due queue with five-rights administration
// workflow, 24h schedule timeline, administration/delay/omission events, and
// timeliness intelligence. Name / dose-display / route / due time ONLY — not
// an EMR, not prescribing. Server-rendered over migration 154.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-gray-100 text-gray-500", due: "bg-[var(--cmp-surface-information)] text-blue-700",
  in_progress: "bg-indigo-100 text-indigo-700", administered: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]",
  delayed: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", overdue: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  escalated: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", cancelled: "bg-gray-100 text-gray-400",
};
const OUTCOME_TONE: Record<string, string> = {
  administered: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", delayed: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", omitted: "bg-gray-100 text-gray-500",
};

export default async function MedicationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyMedications(admin, user.id);

  // Witness candidates: co-staff on my current active shift.
  const { data: dep } = await admin.from("op_shift_staff")
    .select("shift_id, op_shifts!shift_id(status)").eq("staff_id", user.id).limit(20);
  const activeShiftId = ((dep ?? []) as any[]).find(d => d.op_shifts?.status === "active")?.shift_id ?? null;
  let coStaff: { id: string; name: string }[] = [];
  if (activeShiftId) {
    const { data: staff } = await admin.from("op_shift_staff")
      .select("staff_id, profiles!staff_id(id, full_name)").eq("shift_id", activeShiftId).neq("staff_id", user.id).limit(50);
    coStaff = ((staff ?? []) as any[]).filter(s => s.profiles).map(s => ({ id: s.profiles.id, name: s.profiles.full_name ?? "Colleague" }));
  }

  const upcoming = data.schedule.filter((r: any) => r.effective_status === "scheduled");
  const t = data.timeliness;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Medication Summary</h1>
        <p className="text-sm text-gray-500 mt-1">Operational coordination — name, route and due time with five-rights capture. Prescribing stays in the EMR.</p>
      </div>

      {data.migrationMissing && (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Store not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-[var(--cmp-surface-warning)] px-1.5 py-0.5 rounded font-mono text-xs">154-medication-coordination.sql</code> to enable the medication module.</p>
        </div>
      )}

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard icon="⏰" title="Due Now" value={data.kpis.dueNow} tone={data.kpis.dueNow > 0 ? "text-blue-700" : undefined} sub="within the due window" />
        <StatCard icon="🔴" title="Overdue" value={data.kpis.overdue} tone={data.kpis.overdue > 0 ? "text-[var(--cmp-text-critical)]" : undefined} sub=">30 min past due" />
        <StatCard icon="⚠️" title="Delayed" value={data.kpis.delayed} tone={data.kpis.delayed > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="awaiting administration" />
        <StatCard icon="💊" title="High-Risk Pending" value={data.kpis.highRiskPending} tone={data.kpis.highRiskPending > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="open high-risk doses" />
        <StatCard icon="✅" title="Administered (24h)" value={data.kpis.administered24h}
          sub={t.onTimePct != null ? `${t.onTimePct}% on time · median delay ${t.medianDelay} min` : "no events yet"} />
      </div>

      <AddMedication patients={data.patients} />

      <SectionCard icon="⏰" title="Due Queue" count={data.queue.length}>
        {data.queue.length === 0 ? (
          <Empty>Nothing due or overdue right now. Doses appear here 60 minutes before their scheduled time.</Empty>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.queue.map((r: any) => (
              <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-500 tabular-nums w-12">{fmtTime(r.scheduled_at)}</span>
                  <span className="font-medium text-gray-800">{r.drug_name}</span>
                  {r.dose_display && <span className="text-sm text-gray-500">{r.dose_display}</span>}
                  <Chip tone="bg-gray-100 text-gray-600">{String(r.route).toUpperCase()}</Chip>
                  <span className="text-xs text-gray-400">{r.op_patients?.label}</span>
                  <Chip tone={STATUS_TONE[r.effective_status] ?? STATUS_TONE.scheduled}>{titleCase(r.effective_status)}</Chip>
                  {r.high_risk && <Chip tone="bg-[var(--cmp-surface-warning)] text-orange-700">High-risk</Chip>}
                  {r.requires_double_check && <Chip tone="bg-purple-100 text-purple-700">Double-check</Chip>}
                  <span className="ml-auto" />
                  <AdministerMed scheduleId={r.id} drug={r.drug_name} requiresDoubleCheck={r.requires_double_check} coStaff={coStaff} />
                </div>
                {r.allergy_note && <p className="text-xs text-[var(--cmp-text-critical)] mt-1">⚠ {r.allergy_note}</p>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard icon="📅" title="Upcoming (next 24h)" count={upcoming.length}>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {upcoming.length === 0 && <Empty>No scheduled doses in the next 24 hours for your patients.</Empty>}
            {upcoming.map((r: any) => (
              <div key={r.id} className="py-2 flex items-center gap-2 text-sm">
                <span className="text-gray-500 tabular-nums w-24 shrink-0 text-xs">{fmtWhen(r.scheduled_at)}</span>
                <span className="text-gray-800">{r.drug_name}</span>
                {r.dose_display && <span className="text-gray-500 text-xs">{r.dose_display}</span>}
                <Chip tone="bg-gray-100 text-gray-600">{String(r.route).toUpperCase()}</Chip>
                <span className="text-xs text-gray-400 ml-auto">{r.op_patients?.label}</span>
                {r.high_risk && <Chip tone="bg-[var(--cmp-surface-warning)] text-orange-700">HR</Chip>}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard icon="📝" title="Recent Events (24h)" count={data.events.length}>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {data.events.length === 0 && <Empty>No administration events yet.</Empty>}
            {data.events.map((e: any) => (
              <div key={e.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-gray-500 tabular-nums text-xs w-12">{fmtTime(e.administered_at)}</span>
                  <span className="text-gray-800">{e.op_med_schedule?.drug_name ?? "—"}</span>
                  <Chip tone={OUTCOME_TONE[e.outcome] ?? OUTCOME_TONE.omitted}>{titleCase(e.outcome)}</Chip>
                  {e.delay_minutes > 0 && <span className={`text-xs tabular-nums ${e.delay_minutes > 60 ? "text-[var(--cmp-text-critical)]" : "text-[var(--cmp-text-warning)]"}`}>+{e.delay_minutes} min</span>}
                  {e.witness_name && <span className="text-[10px] text-purple-600">✓ witnessed: {e.witness_name}</span>}
                  {e.escalation_id && <Chip tone="bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]">Escalated</Chip>}
                  <span className="text-xs text-gray-400 ml-auto">{e.op_patients?.label}</span>
                </div>
                {e.reason && <p className="text-xs text-gray-400 mt-0.5 pl-14">{e.reason}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {(t.administered > 0 || t.delayed > 0 || t.omitted > 0) && (
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Timeliness (last 24h)</p>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span>On time (≤15 min): <span className="font-bold tabular-nums">{t.onTimePct ?? "—"}%</span></span>
            <span>Median delay: <span className="font-bold tabular-nums">{t.medianDelay ?? "—"} min</span></span>
            <span>Administered: <span className="font-bold tabular-nums text-[var(--cmp-text-success)]">{t.administered}</span></span>
            <span>Delayed: <span className="font-bold tabular-nums text-[var(--cmp-text-warning)]">{t.delayed}</span></span>
            <span>Omitted: <span className="font-bold tabular-nums text-gray-500">{t.omitted}</span></span>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Delays over 60 min (high-risk) or 120 min (any medication) auto-escalate to your coordinator. Every event is audit-logged and feeds shift quality intelligence.
      </p>
    </div>
  );
}
