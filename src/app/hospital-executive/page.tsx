import { hexGuard, Head, Stat, Card, Pill, Ring, Foot, T, ragPct } from "./_ui";
import { loadExecHome } from "@/lib/hex/dashboard";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-001 Executive Dashboard — the 30-second enterprise view aggregating all HEX domains.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ST_TONE: Record<string, string> = { active: "emerald", planned: "slate", paused: "amber", completed: "blue", cancelled: "rose", measuring: "blue", planning: "indigo", closed: "slate" };

export default async function ExecutiveDashboard() {
  const { admin, isSuper, hid, fullName } = await hexGuard();
  const d = await loadExecHome(admin, hid, isSuper);
  const k = d.kpis, wf = d.workforce, sf = d.safety;
  const pct = (v: any) => (v != null ? `${Math.round(Number(v))}%` : "—");

  return (
    <div className="space-y-4">
      <Head title="Executive Dashboard" sub={`Enterprise oversight — performance, quality, risk & strategy in one view · ${fullName}`} action={{ label: "AI copilot →", href: "/hospital-executive/intelligence" }} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🎯" tone={k.readiness != null ? ragPct(k.readiness) : "slate"} label="Organisational readiness" value={pct(k.readiness)} sub="composite index" />
        <Stat icon="👥" tone="blue" label="Total workforce" value={k.workforce} />
        <Stat icon="🩺" tone={k.quality != null ? ragPct(k.quality) : "slate"} label="Quality compliance" value={pct(k.quality)} />
        <Stat icon="⚠️" tone={k.highRisks ? "rose" : "emerald"} label="High-severity risks" value={k.highRisks} />
        <Stat icon="💼" tone={k.vacancies ? "amber" : "emerald"} label="Vacancies" value={k.vacancies} />
        <Stat icon="🚀" tone="violet" label="Open initiatives" value={k.initiatives} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Performance scorecard">
          <div className="flex items-center gap-3 mb-3">
            <Ring pct={k.readiness ?? 0} size={72} />
            <div className="text-[11px] text-gray-500">Overall organisational readiness — a composite of the domains that have live data. Rows marked &ldquo;—&rdquo; have no records yet.</div>
          </div>
          <div className="space-y-2">
            {d.scorecard.map((s: any, i: number) => (
              <div key={i}>
                <div className="flex items-center justify-between text-[12px] mb-1"><Link href={s.href} className="text-gray-700 hover:text-teal-700">{s.name}</Link><span className={`font-semibold tabular-nums ${s.score != null ? T(ragPct(s.score)).text : "text-gray-300"}`}>{s.score != null ? `${s.score}%` : "—"}</span></div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${s.score != null ? T(ragPct(s.score)).bar : ""}`} style={{ width: `${s.score ?? 0}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Enterprise risk" right={<Link href="/hospital-executive/risk" className="text-teal-600 hover:underline">Full register →</Link>}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-3xl font-bold tabular-nums ${k.highRisks ? "text-rose-600" : "text-emerald-600"}`}>{k.highRisks}</span>
            <span className="text-[12px] text-gray-500">high / extreme risks open on the register</span>
          </div>
          {d.topRisks.length ? <div className="space-y-1.5">{d.topRisks.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px]"><span className="text-gray-800 truncate flex-1">{r.title}</span><span className="text-gray-400 capitalize text-[10px]">{r.category}</span><span className="inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold" style={{ backgroundColor: T(r.score >= 15 ? "rose" : r.score >= 10 ? "amber" : "blue").hex + "22", color: T(r.score >= 15 ? "rose" : r.score >= 10 ? "amber" : "blue").hex }}>{r.score}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-2 text-center">No risks registered.</p>}
        </Card>

        <Card title="Strategic initiatives" right={<Link href="/hospital-executive/strategy" className="text-teal-600 hover:underline">Strategy →</Link>}>
          {d.initiatives.length ? <div className="space-y-2">{d.initiatives.map((i: any, idx: number) => (
            <div key={idx}>
              <div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700 truncate pr-2">{i.title}</span>{i.progress != null ? <span className="font-medium text-gray-800 tabular-nums">{i.progress}%</span> : <Pill text={(i.status ?? "").replace(/_/g, " ")} tone={ST_TONE[i.status] ?? "slate"} />}</div>
              {i.progress != null && <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-teal-500" style={{ width: `${i.progress}%` }} /></div>}
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No initiatives yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Workforce readiness" right={<Link href="/hospital-executive/workforce" className="text-teal-600 hover:underline">Workforce →</Link>}>
          <div className="flex items-center gap-3">
            <Ring pct={wf.fill ?? 0} size={64} tone="blue" />
            <div className="text-[12px] space-y-1 flex-1">
              <div className="flex justify-between"><span className="text-gray-500">Establishment fill</span><b className="tabular-nums">{pct(wf.fill)}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Competency currency</span><b className="tabular-nums">{pct(wf.competency)}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Learning compliance</span><b className="tabular-nums">{pct(wf.learning)}</b></div>
              <div className="flex justify-between"><span className="text-gray-500">Vacancies</span><b className="tabular-nums">{wf.vacant}</b></div>
            </div>
          </div>
        </Card>

        <Card title="Quality & safety overview" right={<Link href="/hospital-executive/quality" className="text-teal-600 hover:underline">Quality →</Link>}>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {[["Patient safety index", sf.index != null ? `${sf.index}%` : "—"], ["Patient safety events", sf.pse ?? "—"], ["Medication errors", sf.medErrors ?? "—"], ["Infection rate", sf.infection != null ? `${sf.infection}%` : "—"], ["Mortality index", sf.mortality ?? "—"], ["Readmissions (30d)", sf.readmission != null ? `${sf.readmission}%` : "—"]].map(([l, v]: any, i: number) => (
              <div key={i} className="border border-gray-100 rounded-lg px-2.5 py-1.5"><p className="text-[10px] text-gray-400 leading-tight">{l}</p><p className="text-sm font-semibold text-gray-800 tabular-nums">{v}</p></div>
            ))}
          </div>
        </Card>

        <Card title="Financial snapshot" right={<Link href="/hospital-executive/financial" className="text-teal-600 hover:underline">Financial →</Link>}>
          <div className="flex flex-col items-center justify-center py-5 text-center">
            <span className="text-2xl mb-1">💷</span>
            <p className="text-[12px] text-gray-500">Operating finance connects when ready.</p>
            <p className="text-[10px] text-gray-400 mt-1">Cost-centre budget vs actual is live in the Financial module; revenue, expenditure and cash flow require a finance-system integration (not fabricated).</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="AI executive summary" className="xl:col-span-2">
          <div className="bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-100 rounded-lg p-3">
            <p className="text-[13px] text-gray-800 leading-relaxed">
              Organisational readiness is {pct(k.readiness)}{d.objProgress != null ? `, with strategic objectives averaging ${d.objProgress}% progress` : ""}.
              {k.highRisks ? ` ${k.highRisks} high/extreme risk${k.highRisks > 1 ? "s are" : " is"} open` : " Enterprise risk is within tolerance"}
              {d.action.overdueCapa ? ` and ${d.action.overdueCapa} corrective action${d.action.overdueCapa > 1 ? "s are" : " is"} overdue.` : "."}
              {d.action.criticalFindings ? ` ${d.action.criticalFindings} critical quality finding${d.action.criticalFindings > 1 ? "s need" : " needs"} attention.` : ""}
            </p>
            <Link href="/hospital-executive/intelligence" className="mt-2 inline-block text-[12px] font-medium text-violet-700 hover:underline">Open the live executive copilot →</Link>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">At-a-glance rule-based summary; the Executive Intelligence centre runs a real LLM grounded in this data.</p>
        </Card>

        <Card title="Executive action centre">
          <div className="space-y-2 text-[12.5px]">
            <Link href="/hospital-executive/quality" className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 hover:border-teal-300"><span className="text-gray-600">Critical quality findings</span><b className={`tabular-nums ${d.action.criticalFindings ? "text-rose-600" : "text-gray-900"}`}>{d.action.criticalFindings}</b></Link>
            <Link href="/quality-accreditation/improvements" className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 hover:border-teal-300"><span className="text-gray-600">Overdue corrective actions</span><b className={`tabular-nums ${d.action.overdueCapa ? "text-rose-600" : "text-gray-900"}`}>{d.action.overdueCapa}</b></Link>
            <Link href="/hospital-executive/risk" className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 hover:border-teal-300"><span className="text-gray-600">High / extreme risks</span><b className={`tabular-nums ${d.action.highRisks ? "text-amber-600" : "text-gray-900"}`}>{d.action.highRisks}</b></Link>
            <Link href="/hospital-executive/workforce" className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 hover:border-teal-300"><span className="text-gray-600">Vacant established roles</span><b className={`tabular-nums ${d.action.vacancies ? "text-amber-600" : "text-gray-900"}`}>{d.action.vacancies}</b></Link>
          </div>
        </Card>
      </div>

      <Foot>HEX-001 — the executive command centre, aggregating the HR + Quality scorecard (<code>loadExecutiveDashboard</code>), strategic initiatives &amp; objectives (<code>ppe_*</code>), the risk register (<code>gov_risks</code>) and the latest quality/ops snapshots. Every figure is live, tenant-scoped, and reconciles with its owning module (each panel links through). Operating finance is shown as connect-when-ready, never fabricated.</Foot>
    </div>
  );
}
