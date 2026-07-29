import { cmoGuard, Head, Card, Kpi, Bars, Foot } from "../_cmo-ui";
import { loadRecertification, PATHS } from "@/lib/competency/recertification";
import RenewalManager from "./RenewalManager";

export const dynamic = "force-dynamic";

// COMP-020 Competency Recertification & Renewal Management — track every expiring credential (professional
// certifications + current competency decisions) and drive its renewal through to completion. Real over
// cmo_certifications (mig 114) + competency_decisions (mig 011/027) + cmo_renewals (mig 124). No fabricated data.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STAGE_BORDER: Record<string, string> = { blue: "border-blue-200 bg-blue-50/50", amber: "border-amber-200 bg-amber-50/50", rose: "border-rose-200 bg-rose-50/50", slate: "border-gray-200 bg-gray-50" };

export default async function RecertificationPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadRecertification(admin, hid, isSuper);
  const head = <Head code="COMP-020 · Competency Office" title="Recertification & Renewal" sub="Keep every credential current — monitor expiring certifications and competencies, notify ahead of expiry, and drive each renewal through its path to completion." />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">Neither expiry source is provisioned yet — apply migration <code>114</code> (certifications) and ensure <code>competency_decisions</code> exists (migration <code>011</code>/<code>027</code>) to activate recertification. Renewal records use migration <code>124</code>.</p></Card></div>;

  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Expiring ≤30 days" value={k.expiring30} tone={k.expiring30 ? "text-amber-600" : "text-gray-900"} sub="within a month" />
        <Kpi label="Expiring 31–90 days" value={k.expiring90} sub="on the horizon" />
        <Kpi label="Expired" value={k.expired} tone={k.expired ? "text-rose-600" : "text-gray-900"} />
        <Kpi label="Renewals in progress" value={k.inProgress} tone={k.inProgress ? "text-teal-600" : "text-gray-900"} sub="in flight" />
        <Kpi label="Renewal rate" value={k.renewalRate === null ? "—" : `${k.renewalRate}%`} tone={k.renewalRate !== null && k.renewalRate >= 80 ? "text-emerald-600" : "text-gray-900"} sub="completed / opened" />
        <Kpi label="Overdue · no renewal" value={k.overdueNoRenewal} tone={k.overdueNoRenewal ? "text-rose-600" : "text-gray-900"} sub="expired, unactioned" />
      </div>

      <Card title="Renewal lifecycle" right={<span className="text-[11px] text-gray-400">monitor → notify → assign → learn → reassess → renew</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
          {d.lifecycle.map((s: any, i: number) => (
            <div key={s.key} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-gray-400">Step {i + 1}</p>
              <p className="text-[12.5px] font-semibold text-gray-800 leading-tight">{s.label}</p>
              <p className="text-xl font-bold tabular-nums text-gray-900 mt-0.5">{s.n}</p>
              <p className="text-[10px] text-gray-400">{s.sub}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Notification cadence" right={<span className="text-[11px] text-gray-400">escalating renewal reminders by time-to-expiry</span>}>
        <div className="grid grid-cols-5 gap-2">
          {d.stages.map((s: any) => (
            <div key={s.key} className={`rounded-lg border px-3 py-3 text-center ${STAGE_BORDER[s.tone] ?? STAGE_BORDER.slate}`}>
              <p className="text-2xl font-bold tabular-nums text-gray-900">{s.n}</p>
              <p className="text-[11px] font-semibold text-gray-700 mt-0.5">{s.label}</p>
              <p className="text-[10px] text-gray-400">{s.sub}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Renewal management" right={<span className="text-[11px] text-gray-400">{d.worklistTotal} in the renewal window · {d.counts.renewalsTotal} renewal{d.counts.renewalsTotal === 1 ? "" : "s"} opened</span>}>
        <RenewalManager worklist={d.worklist} renewals={d.renewals} worklistTotal={d.worklistTotal} />
      </Card>

      <Card title="Renewal path mix" right={<span className="text-[11px] text-gray-400">distribution of opened renewals</span>}>
        {d.pathMix.length
          ? <Bars rows={d.pathMix.map((p: any) => ({ label: p.label, n: p.n }))} colors={d.pathMix.map((p: any) => p.color)} />
          : <p className="text-sm text-gray-400 py-4 text-center">No renewals opened yet — start one from the worklist to populate the path mix.</p>}
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-1.5">
          {Object.entries(PATHS).map(([key, v]: any) => (
            <div key={key} className="flex items-center gap-1.5 text-[10.5px]"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v.color }} /><span className="text-gray-500 truncate">{v.label}</span></div>
          ))}
        </div>
      </Card>

      <Foot>COMP-020 — the expiring worklist is real and derived on read: professional certifications/licences/registrations from <code>cmo_certifications</code> (mig 114) plus the latest current-competent competency decisions carrying an expiry from <code>competency_decisions</code> (mig 011; <code>hospital_id</code> via 027), each staged by time-to-expiry. Renewals are recorded in <code>cmo_renewals</code> (mig 124) with a chosen path and a status lifecycle (pending → in progress → reassessment → completed, or lapsed); the KPIs, notification cadence and path mix all read from those. Automated notification dispatch, path-specific evidence capture and auto-close on a fresh competent decision are the next-phase deepening.</Foot>
    </div>
  );
}
