import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOne } from "@/lib/hww/patients";
import { cnciTone } from "@/lib/hww/cnci";
import { card, label, titleCase, fmtTime, fmtWhen, AcuityChip, RiskChip, PrioChip, Chip, SectionCard, Empty, ewsColor } from "@/lib/hww/kit";

// Patient Workspace (HWW-ARCH-002 S7) — everything about ONE patient in one
// place: clinical snapshot, CNCI with its drivers, scores + trend, next due,
// the merged operational timeline, assessment histories, medication plan,
// care tasks, patient-context communications and quality events — with deep
// links into every capture module. Access: the assigned nurse or staff tier.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const STAFF = ["assessor", "educator", "lead_educator", "hospital_admin", "super_admin"];
const MED_TONE: Record<string, string> = { due: "bg-blue-100 text-blue-700", overdue: "bg-red-100 text-red-700", delayed: "bg-amber-100 text-amber-700", scheduled: "bg-gray-100 text-gray-500", in_progress: "bg-indigo-100 text-indigo-700", administered: "bg-green-100 text-green-700", escalated: "bg-red-100 text-red-700", cancelled: "bg-gray-100 text-gray-400" };
const TREND = { up: { icon: "↗", cls: "text-red-600" }, down: { icon: "↘", cls: "text-green-600" }, flat: { icon: "→", cls: "text-gray-400" } } as const;

export default async function PatientWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isStaffUser = roles.some(r => STAFF.includes(r));

  const d = await loadPatientOne(admin, user.id, id);
  if (!d.found) {
    return <div className={card}><Empty>Patient not found.</Empty></div>;
  }
  if (!d.assignedToMe && !isStaffUser) {
    return (
      <div className={card}>
        <p className="font-semibold text-gray-800">Not your patient</p>
        <p className="text-sm text-gray-500 mt-1">The patient workspace opens for your own active assignments. <Link href="/healthcare-worker/patients" className="text-emerald-700 hover:underline">Back to My Patients →</Link></p>
      </div>
    );
  }

  const p = d.patient;
  const c = d.ctx;
  const t = c.trend ? TREND[c.trend as keyof typeof TREND] : null;
  const nextObs = c.obsDue[0] ?? null;
  const nextMed = c.medsOpen.filter((m: any) => ["due", "overdue", "delayed"].includes(m.effective_status))[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{p.op_beds?.label ? `${p.op_beds.label} · ` : ""}{p.label}</h1>
            <AcuityChip level={p.acuity_level} />
            <RiskChip level={p.risk_level} />
            {p.isolation_status !== "none" && <Chip tone="bg-purple-100 text-purple-700">{titleCase(p.isolation_status)} isolation</Chip>}
            {p.op_beds?.bed_type === "critical_care" && <Chip tone="bg-sky-100 text-sky-700">ICU</Chip>}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {p.age_years != null ? `${p.age_years} yrs` : "Age not in operational record"}
            {p.diagnosis ? ` · ${p.diagnosis}` : ""}{p.consultant ? ` · ${p.consultant}` : ""}
            {p.departments?.name ? ` · ${p.departments.name}` : ""} · {titleCase(p.operational_status)}
          </p>
          {d.assignments.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">Care team: {d.assignments.map((a: any) => `${a.profiles?.full_name ?? "—"}${a.assignment_type === "primary" ? " (primary)" : ""}`).join(" · ")}</p>
          )}
        </div>
        <Link href="/healthcare-worker/patients" className="text-sm text-emerald-700 hover:underline self-center">← My Patients</Link>
      </div>

      {/* CNCI + scores strip */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className={`${card} text-center`}>
          <p className={label}>CNCI (Priority)</p>
          <p className="text-4xl font-bold tabular-nums mt-1 text-gray-900">{c.cnci.score}</p>
          <span className={`inline-block mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${cnciTone(c.cnci.band)}`}>{titleCase(c.cnci.band)}</span>
          <p className="text-[10px] text-gray-400 mt-2">{c.cnci.drivers.slice(0, 3).join(" · ")}</p>
        </div>
        <div className={card}>
          <p className={label}>Acuity</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{c.acuityLatest ? `${c.acuityLatest.score}/18` : "—"}</p>
          <p className="text-xs text-gray-500">{c.acuityLatest ? `${titleCase(c.acuityLatest.level)} · ${fmtWhen(c.acuityLatest.assessed_at)}` : `operational level: ${titleCase(p.acuity_level)}`}</p>
          {c.reassess.due && <p className="text-[10px] text-orange-600 font-semibold mt-1" title={c.reassess.reason ?? ""}>⚡ Focused reassessment recommended — {c.reassess.reason}</p>}
          <Link href="/healthcare-worker/acuity" className="text-[10px] text-emerald-700 hover:underline">Assess →</Link>
        </div>
        <div className={card}>
          <p className={label}>PEWS</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${ewsColor(c.pews)}`}>{c.pews ?? "—"} {t && <span className={`text-lg ${t.cls}`}>{t.icon}</span>}</p>
          <p className="text-xs text-gray-500">{c.obsDue.length > 0 ? `${c.obsDue.length} observation${c.obsDue.length === 1 ? "" : "s"} due` : "no observations due"}</p>
          <Link href="/healthcare-worker/observations" className="text-[10px] text-emerald-700 hover:underline">Record obs →</Link>
        </div>
        <div className={card}>
          <p className={label}>Next Due</p>
          {nextMed || nextObs ? (
            <div className="mt-1 space-y-1">
              {nextMed && <p className={`text-sm ${nextMed.effective_status === "overdue" ? "text-red-600 font-semibold" : "text-gray-800"}`}>💊 {fmtTime(nextMed.scheduled_at)} — {nextMed.drug_name}{nextMed.high_risk ? " (HR)" : ""}</p>}
              {nextObs && <p className={`text-sm ${nextObs.status === "overdue" ? "text-red-600 font-semibold" : "text-gray-800"}`}>📈 {nextObs.status === "overdue" ? "OVERDUE" : fmtTime(nextObs.due_at)} — {titleCase(nextObs.observation_type)}</p>}
            </div>
          ) : <p className="text-sm text-gray-400 mt-1">Nothing due right now.</p>}
          <p className="text-xs text-gray-500 mt-1">{c.workloadPct != null ? `Workload ${Number(c.workloadPct).toFixed(0)}%` : "No workload assessment yet"} · <Link href="/healthcare-worker/workload" className="text-emerald-700 hover:underline">assess →</Link></p>
        </div>
      </div>

      {/* Timeline + medication plan */}
      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard icon="🕐" title="Operational Timeline" count={d.timeline.length}>
          <div className="space-y-0.5 max-h-[26rem] overflow-y-auto">
            {d.timeline.length === 0 && <Empty>No operational events recorded yet for this patient.</Empty>}
            {d.timeline.map((e: any, i: number) => (
              <div key={i} className="flex items-start gap-2.5 py-1.5">
                <span className="text-[10px] text-gray-400 tabular-nums w-24 shrink-0 mt-0.5">{fmtWhen(e.at)}</span>
                <span className="text-sm w-5 text-center shrink-0">{e.icon}</span>
                <p className={`text-sm leading-tight ${e.tone ?? "text-gray-700"}`}>{e.text}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard icon="💊" title="Medication Plan (48h)" count={c.meds.length}
            right={<Link href="/healthcare-worker/medications" className="text-xs text-emerald-700 hover:underline">Work the queue →</Link>}>
            <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
              {c.meds.length === 0 && <Empty>No schedule entries in the window.</Empty>}
              {c.meds.map((m: any) => (
                <p key={m.id} className="py-1.5 text-xs text-gray-600 flex items-center gap-2">
                  <span className="tabular-nums text-gray-500 w-24 shrink-0">{fmtWhen(m.scheduled_at)}</span>
                  <span className="flex-1 min-w-0 truncate">{m.drug_name}{m.dose_display ? ` ${m.dose_display}` : ""} · {String(m.route).toUpperCase()}</span>
                  <Chip tone={MED_TONE[m.effective_status] ?? MED_TONE.scheduled}>{titleCase(m.effective_status)}</Chip>
                  {m.high_risk && <span className="text-orange-600 text-[9px] font-bold">HR</span>}
                </p>
              ))}
            </div>
          </SectionCard>

          <SectionCard icon="✅" title="Care Tasks (open)" count={c.tasks.length}>
            <div className="divide-y divide-gray-50 max-h-40 overflow-y-auto">
              {c.tasks.length === 0 && <Empty>No open tasks for this patient.</Empty>}
              {c.tasks.map((tk: any) => (
                <p key={tk.id} className="py-1.5 text-xs text-gray-600 flex items-center gap-2">
                  <span className="tabular-nums text-gray-500">{tk.due_at ? fmtTime(tk.due_at) : "--:--"}</span>
                  <span className="flex-1 min-w-0 truncate">{tk.description}</span>
                  <PrioChip p={tk.priority} />
                </p>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Histories + quality + comms */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        <SectionCard icon="🌡️" title="Assessment History">
          {d.acuityHistory.length === 0 && d.workloadHistory.length === 0 ? <Empty>No scored assessments yet.</Empty> : (
            <div className="space-y-1 max-h-48 overflow-y-auto text-xs text-gray-600">
              {d.acuityHistory.slice(0, 8).map((a: any) => (
                <p key={a.id} className="flex items-center gap-2"><span className="tabular-nums text-gray-400 w-24 shrink-0">{fmtWhen(a.assessed_at)}</span>Acuity <span className="font-bold tabular-nums">{a.score}/18</span> {a.level}{a.significant_change ? <Chip tone="bg-orange-100 text-orange-700">significant</Chip> : null}</p>
              ))}
              {d.workloadHistory.slice(0, 8).map((w: any) => (
                <p key={w.id} className="flex items-center gap-2"><span className="tabular-nums text-gray-400 w-24 shrink-0">{fmtWhen(w.assessed_at)}</span>Workload <span className="font-bold tabular-nums">{Number(w.percentage).toFixed(0)}%</span> ({w.framework === "nas" ? "NAS" : "ward"})</p>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard icon="🛡️" title="Quality Events" count={c.alerts.length + c.escalations.length + c.concerns.length}>
          <div className="space-y-1.5 max-h-48 overflow-y-auto text-xs">
            {c.alerts.length + c.escalations.length + c.concerns.length === 0 && <Empty>No active alerts, escalations or concerns.</Empty>}
            {c.alerts.map((a: any) => <p key={a.id} className="text-red-700">⚠ {titleCase(a.category)} ({a.severity}){a.note ? ` — ${a.note}` : ""}</p>)}
            {c.escalations.map((e: any) => <p key={e.id} className="text-orange-700">⬆ L{e.level} {e.summary}</p>)}
            {c.concerns.map((cn: any) => <p key={cn.id} className="text-gray-700">🚩 {titleCase(cn.category)} ({titleCase(cn.priority)}) — {cn.description}</p>)}
          </div>
          <Link href="/healthcare-worker/concerns" className="text-[10px] text-emerald-700 hover:underline">Raise a concern →</Link>
        </SectionCard>

        <SectionCard icon="💬" title="Patient-Context Messages" count={d.messages.length}>
          <div className="space-y-1.5 max-h-48 overflow-y-auto text-xs">
            {d.messages.length === 0 && <Empty>No patient-linked messages.</Empty>}
            {d.messages.slice(0, 8).map((m: any) => (
              <p key={m.id} className="text-gray-600"><span className="font-semibold text-gray-700">{m.author_name ?? "Colleague"}:</span> {m.body} <span className="text-gray-300">· {fmtWhen(m.created_at)}</span></p>
            ))}
          </div>
          <Link href="/healthcare-worker/communication" className="text-[10px] text-emerald-700 hover:underline">Open communications →</Link>
        </SectionCard>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Operational coordination record only — the clinical record (diagnosis detail, orders, documentation) remains in the EMR. CNCI drivers: {c.cnci.drivers.join("; ")}.
      </p>
    </div>
  );
}
