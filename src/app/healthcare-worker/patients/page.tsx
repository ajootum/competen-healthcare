import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMyPatientWorkspace } from "@/lib/hww/patients";
import { cnciTone, CNCI_BANDS } from "@/lib/hww/cnci";
import { card, titleCase, fmtTime, fmtWhen, AcuityChip, RiskChip, PrioChip, Chip, Empty, ewsColor } from "@/lib/hww/kit";

// My Patient Assignment / Patient Summary (HWW-WARD-001 S4.2/S4.3/S5) — the
// full patient workspace per assigned patient: operational context, clinical
// priority banner, current acuity + workload scores, observation schedule,
// medication schedule (name/route/due only), open tasks, safety alerts,
// escalations, nurse concerns and operational notes. Every panel is a real
// store; fields the operational schema does not hold (sex, service line) are
// stated as such, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const MED_TONE: Record<string, string> = {
  due: "bg-blue-100 text-blue-700", overdue: "bg-red-100 text-red-700",
  delayed: "bg-amber-100 text-amber-700", scheduled: "bg-gray-100 text-gray-500", in_progress: "bg-indigo-100 text-indigo-700",
};

function PatientCard({ a, ctx }: { a: any; ctx: any }) {
  const p = a.op_patients;
  const latestEws = (() => {
    const w = (ctx.observations ?? []).filter((o: any) => o.ews_score != null);
    if (!w.length) return null;
    return w.sort((x: any, y: any) => +new Date(y.recorded_at ?? y.created_at ?? 0) - +new Date(x.recorded_at ?? x.created_at ?? 0))[0].ews_score as number;
  })();
  const banner = p.acuity_level === "critical" || (ctx.escalations ?? []).some((e: any) => e.level >= 4)
    ? { cls: "bg-red-50 border-red-200 text-red-800", text: "Critical priority — active high-level clinical attention" }
    : p.acuity_level === "high" || (ctx.alerts ?? []).length > 0
      ? { cls: "bg-orange-50 border-orange-200 text-orange-800", text: "Elevated priority — monitor closely" }
      : null;

  return (
    <div className={card}>
      {/* Context header */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/healthcare-worker/patients/${p.id}`} className="font-bold text-gray-900 text-lg hover:text-emerald-700">{p.label}</Link>
        {p.op_beds?.label && <span className="text-sm text-gray-500">{p.op_beds.label}</span>}
        {a.assignment_type === "primary" && <span className="text-[9px] text-emerald-600 uppercase font-semibold">primary</span>}
        {ctx.cnci && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${cnciTone(ctx.cnci.band)}`}>
            {ctx.cnci.score}<span className="font-normal">{titleCase(ctx.cnci.band)}</span>
          </span>
        )}
        <AcuityChip level={p.acuity_level} />
        <RiskChip level={p.risk_level} />
        {p.isolation_status !== "none" && <Chip tone="bg-purple-100 text-purple-700">{titleCase(p.isolation_status)} isolation</Chip>}
        {p.op_beds?.bed_type === "critical_care" && <Chip tone="bg-sky-100 text-sky-700">ICU</Chip>}
        {ctx.reassess?.due && <Chip tone="bg-orange-100 text-orange-700">Reassess</Chip>}
        <span className="ml-auto text-xs text-gray-400">{titleCase(p.operational_status)}</span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {p.age_years != null ? `${p.age_years} yrs` : "Age not in operational record"}
        {p.diagnosis ? ` · ${p.diagnosis}` : ""}
        {p.consultant ? ` · ${p.consultant}` : ""}
        {p.departments?.name ? ` · ${p.departments.name}` : ""}
      </p>

      {banner && <div className={`mt-2 border rounded-lg px-3 py-2 text-sm ${banner.cls}`}>{banner.text}</div>}

      {/* Score strip */}
      <div className="grid grid-cols-3 gap-3 mt-3">
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Acuity score</p>
          <p className="text-lg font-bold tabular-nums text-gray-900">{ctx.acuityLatest ? `${ctx.acuityLatest.score}/18` : "—"}</p>
          {ctx.acuityLatest?.significant_change && <p className="text-[9px] text-orange-600 font-semibold">significant change</p>}
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Workload</p>
          <p className="text-lg font-bold tabular-nums text-gray-900">{ctx.workloadLatest ? `${Number(ctx.workloadLatest.percentage).toFixed(0)}%` : "—"}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">PEWS</p>
          <p className={`text-lg font-bold tabular-nums ${ewsColor(latestEws)}`}>{latestEws ?? "—"}</p>
        </div>
      </div>

      {/* Panels */}
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 mt-4 text-sm">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Observations {ctx.obsDue.length > 0 && <span className="text-orange-600">({ctx.obsDue.length} due)</span>}</p>
          {ctx.obsDue.length === 0 ? <p className="text-xs text-gray-400">Nothing due.</p> : ctx.obsDue.slice(0, 4).map((o: any) => (
            <p key={o.id} className="text-xs text-gray-600 flex gap-2">
              <span className={o.status === "overdue" ? "text-red-600 font-medium" : "text-gray-500"}>{o.status === "overdue" ? "OVERDUE" : fmtTime(o.due_at)}</span>
              {titleCase(o.observation_type)}
            </p>
          ))}
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Medications (next/open)</p>
          {ctx.medsOpen.length === 0 ? <p className="text-xs text-gray-400">None open in the 24h window.</p> : ctx.medsOpen.slice(0, 4).map((m: any) => (
            <p key={m.id} className="text-xs text-gray-600 flex items-center gap-2">
              <span className="text-gray-500 tabular-nums">{fmtTime(m.scheduled_at)}</span>
              {m.drug_name}{m.dose_display ? ` ${m.dose_display}` : ""} · {String(m.route).toUpperCase()}
              <Chip tone={MED_TONE[m.effective_status] ?? MED_TONE.scheduled}>{titleCase(m.effective_status)}</Chip>
              {m.high_risk && <span className="text-orange-600 text-[10px]">HR</span>}
            </p>
          ))}
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Open tasks ({ctx.tasks.length})</p>
          {ctx.tasks.length === 0 ? <p className="text-xs text-gray-400">None.</p> : ctx.tasks.slice(0, 4).map((t: any) => (
            <p key={t.id} className="text-xs text-gray-600 flex items-center gap-2">
              <span className="text-gray-500 tabular-nums">{t.due_at ? fmtTime(t.due_at) : "--:--"}</span>
              <span className="flex-1 min-w-0 truncate">{t.description}</span>
              <PrioChip p={t.priority} />
            </p>
          ))}
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Safety &amp; concerns</p>
          {(ctx.alerts.length + ctx.escalations.length + ctx.concerns.length) === 0 ? <p className="text-xs text-gray-400">No active alerts, escalations or concerns.</p> : (
            <>
              {ctx.alerts.slice(0, 2).map((al: any) => <p key={al.id} className="text-xs text-red-700">⚠ {titleCase(al.category)}{al.note ? ` — ${al.note}` : ""}</p>)}
              {ctx.escalations.slice(0, 2).map((e: any) => <p key={e.id} className="text-xs text-orange-700">⬆ L{e.level} {e.summary}</p>)}
              {ctx.concerns.slice(0, 2).map((cn: any) => <p key={cn.id} className="text-xs text-gray-600">🚩 {titleCase(cn.category)} ({titleCase(cn.priority)})</p>)}
            </>
          )}
        </div>
      </div>

      {ctx.notes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Operational notes</p>
          {ctx.notes.slice(0, 3).map((n: any) => (
            <p key={n.id} className="text-xs text-gray-500">{n.note} <span className="text-gray-300">· {fmtWhen(n.created_at)}</span></p>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-2 text-xs">
        <Link className="text-emerald-700 hover:underline" href="/healthcare-worker/observations">Record obs →</Link>
        <Link className="text-emerald-700 hover:underline" href="/healthcare-worker/medications">Medications →</Link>
        <Link className="text-emerald-700 hover:underline" href="/healthcare-worker/acuity">Assess acuity →</Link>
        <Link className="text-emerald-700 hover:underline" href="/healthcare-worker/concerns">Raise concern →</Link>
      </div>
    </div>
  );
}

export default async function MyPatientsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { patients, byPatient } = await loadMyPatientWorkspace(admin, user.id);
  const priorityView = view === "priority";
  const ranked = [...patients].sort((a: any, b: any) => (byPatient.get(b.op_patients.id)?.cnci?.score ?? 0) - (byPatient.get(a.op_patients.id)?.cnci?.score ?? 0));

  const toggle = (label: string, href: string, active: boolean) => (
    <Link href={href} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${active ? "bg-emerald-600 text-white" : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{label}</Link>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Patients</h1>
          <p className="text-sm text-gray-500 mt-1">Your primary operational workspace — CNCI drives the priority view; open any patient for their full workspace.</p>
        </div>
        <div className="flex gap-1.5 self-center">
          {toggle("List view", "/healthcare-worker/patients", !priorityView)}
          {toggle("Priority view", "/healthcare-worker/patients?view=priority", priorityView)}
        </div>
      </div>

      {patients.length === 0 ? (
        <div className={card}>
          <Empty>No active patient assignments. Your coordinator allocates patients in the Clinical Operations Centre; they appear here with their full operational picture.</Empty>
        </div>
      ) : priorityView ? (
        <div className="space-y-4">
          {CNCI_BANDS.map(band => {
            const group = ranked.filter((a: any) => byPatient.get(a.op_patients.id)?.cnci?.band === band.key);
            if (!group.length) return null;
            return (
              <div key={band.key} className={card}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${band.tone}`}>{band.label}</span>
                  <span className="text-xs text-gray-400">{group.length} patient{group.length === 1 ? "" : "s"} · CNCI {band.min}+</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {group.map((a: any) => {
                    const p = a.op_patients; const ctx = byPatient.get(p.id) ?? {};
                    return (
                      <div key={p.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className={`font-bold tabular-nums w-8 ${band.dot}`}>{ctx.cnci?.score ?? "—"}</span>
                        <Link href={`/healthcare-worker/patients/${p.id}`} className="font-medium text-gray-800 hover:text-emerald-700">{p.op_beds?.label ? `${p.op_beds.label} · ` : ""}{p.label}</Link>
                        <AcuityChip level={p.acuity_level} />
                        {ctx.pews != null && <span className={`text-xs font-semibold tabular-nums ${ewsColor(ctx.pews)}`}>PEWS {ctx.pews}</span>}
                        {ctx.reassess?.due && <Chip tone="bg-orange-100 text-orange-700">Reassess</Chip>}
                        <span className="ml-auto text-[11px] text-gray-400">{(ctx.cnci?.drivers ?? []).slice(0, 2).join(" · ")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid xl:grid-cols-2 gap-5">
          {ranked.map((a: any) => <PatientCard key={a.op_patients.id} a={a} ctx={byPatient.get(a.op_patients.id) ?? {}} />)}
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Patient sex and service line are not held in the operational roster (they live in the clinical record) and are never fabricated here.
      </p>
    </div>
  );
}
