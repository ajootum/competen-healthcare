import { hexGuard, Head, Tabs, Stat, Card, Donut, Legend, Trend, Bars, Gauge, Foot, ragPct, T } from "../_ui";
import { loadExecWorkforce } from "@/lib/hex/workforce";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-004 Workforce Intelligence (executive lens).
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Workforce Analytics", "Competency & Readiness", "Learning & Compliance", "Recruitment & Pipeline", "Retention & Performance", "Succession & Growth", "Forecasting"];
const fmtFte = (v: number | null) => (v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(1));
const filledTone = (p: number) => (p >= 90 ? "emerald" : p >= 75 ? "teal" : "amber");
const vacTone = (p: number) => (p >= 12 ? "rose" : p >= 6 ? "amber" : "emerald");
const turnoverTone = (t: number | null) => (t == null ? "gray" : t >= 18 ? "rose" : t >= 12 ? "amber" : "emerald");

export default async function ExecWorkforcePage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecWorkforce(admin, hid, isSuper);
  const head = <Head code="HEX-004 · Hospital Executive" title="Workforce Intelligence" sub="Understand. Develop. Deploy. Retain. Your people are your greatest advantage." action={{ label: "HR workspace →", href: "/human-resources" }} />;
  const k = d.kpis;
  const q = (v: any) => (v != null ? `${Math.round(Number(v))}%` : "—");

  if (d.empty) {
    return (
      <div className="space-y-4">
        {head}
        <Tabs tabs={TABS} active="Overview" />
        <Card>
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <span className="text-3xl mb-2">👥</span>
            <p className="text-sm text-gray-600 font-medium">No workforce data yet</p>
            <p className="text-[12px] text-gray-400 mt-1 max-w-md">No staff profiles or establishment positions are recorded for this hospital. Once people, positions and assignments exist, this module lights up with live composition, readiness and vacancy analytics.</p>
            <Link href="/human-resources" className="mt-4 text-sm text-teal-600 hover:underline">Open the HR workspace →</Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="👥" tone="blue" label="Total workforce" value={k.total} sub="on the books" />
        <Stat icon="🪑" tone={filledTone(k.filledPct)} label="Establishment filled" value={`${k.filledPct}%`} sub={`${k.filled}/${k.establishment} roles`} />
        <Stat icon="🕳️" tone={vacTone(k.vacancyPct)} label="Vacancy rate" value={`${k.vacancyPct}%`} sub={`${k.vacant} vacant`} />
        <Stat icon="🎓" tone={k.readiness != null ? ragPct(Number(k.readiness)) : "gray"} label="Competency readiness" value={q(k.readiness)}
          trend={d.readinessDelta != null ? { dir: d.readinessDelta > 0 ? "up" : d.readinessDelta < 0 ? "down" : "flat", label: `${Math.abs(d.readinessDelta)} pts`, good: d.readinessDelta >= 0 } : undefined} />
        <Stat icon="📚" tone={ragPct(Number(k.learningCompliance))} label="Learning compliance" value={q(k.learningCompliance)} sub={`${k.learningCompleted}/${k.learningTotal} mandatory`} />
        <Stat icon="🔄" tone={turnoverTone(k.turnover)} label="Turnover rate" value={q(k.turnover)} sub="last 12 months" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Workforce composition" right="by category">
          {d.composition.length ? (
            <div className="flex items-center gap-3">
              <Donut segments={d.composition} total={k.total} label="People" size={130} />
              <Legend items={d.composition.map((c: any) => ({ label: c.label, value: c.value, tone: c.tone, pct: k.total ? Math.round((c.value / k.total) * 100) : 0 }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No staff profiles yet.</p>}
        </Card>

        <Card title="Establishment vs filled" right="Workforce Assignment Engine">
          <Bars items={[
            { label: "Filled", pct: k.filledPct, tone: "emerald", value: `${k.filled}/${k.establishment}` },
            { label: "Vacant", pct: k.vacancyPct, tone: "rose", value: k.vacant },
          ]} />
          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">Lifecycle: <span className="text-gray-600 font-medium">{d.employment.newStarters}</span> new starters (30d) · <span className="text-gray-600 font-medium">{d.employment.orientation}</span> orientation · <span className="text-gray-600 font-medium">{d.employment.probation}</span> probation · <span className="text-gray-600 font-medium">{d.employment.confirmed}</span> confirmed.</p>
        </Card>

        <Card title="Competency readiness" right="live coverage">
          <div className="flex flex-col items-center">
            <Gauge pct={Number(k.coverage) || 0} label="current & in-date" tone={ragPct(Number(k.coverage))} />
            <p className="text-[11px] text-gray-500 mt-2 text-center"><span className="font-semibold text-gray-700 tabular-nums">{d.competency.current}</span> of <span className="tabular-nums">{d.competency.total}</span> validations current across the workforce.</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Competency readiness trend" className="xl:col-span-2" right="last 6 months">
          {d.readinessTrend.length >= 2 ? (
            <>
              <Trend points={d.readinessTrend.map((t: any) => t.value)} labels={d.readinessTrend.map((t: any) => t.label)} tone="violet" suffix="" target={85} />
              <p className="text-[10px] text-gray-400 text-center mt-1">Daily <code>competency_readiness_snapshots</code> rolled to month-latest · dashed = 85% readiness target.</p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-2xl mb-1">📈</span>
              <p className="text-[12px] text-gray-500">Not enough readiness-snapshot history yet.</p>
              <p className="text-[10px] text-gray-400 mt-1">A daily snapshot accumulates the trend; the enterprise (all-hospital) view aggregates once seeded.</p>
            </div>
          )}
        </Card>

        <Card title="Live safe staffing" right="latest daily snapshot">
          {d.staffing ? (
            <>
              {d.staffing.safeStaffing != null && <div className="flex justify-center"><Gauge pct={Number(d.staffing.safeStaffing)} label="safe-staffing score" tone={ragPct(Number(d.staffing.safeStaffing))} /></div>}
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[["Required FTE", d.staffing.required, "slate"], ["Available FTE", d.staffing.available, "emerald"], ["Vacant FTE", d.staffing.vacant, "rose"], ["Agency FTE", d.staffing.agency, "amber"]].map(([label, val, tone]: any, i: number) => (
                  <div key={i} className="border border-gray-100 rounded-lg px-2.5 py-2">
                    <p className="text-[10px] text-gray-400 leading-tight">{label}</p>
                    <p className={`text-[17px] font-bold tabular-nums ${T(tone).text}`}>{fmtFte(val)}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-2xl mb-1">🩺</span>
              <p className="text-[12px] text-gray-500">No operational staffing snapshot yet.</p>
              <p className="text-[10px] text-gray-400 mt-1">Establishment above is live; safe-staffing FTEs come from the daily <code>op_ops_snapshots</code> once operations data flows.</p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Vacancy intelligence" className="xl:col-span-2" right="active positions by department">
          {d.vacancyByDept.length ? (
            <>
              <Bars items={d.vacancyByDept.map((v: any) => ({ label: v.label, pct: v.pct, tone: vacTone(v.pct), value: `${v.vacant} of ${v.establishment}` }))} />
              <p className="text-[10px] text-gray-400 mt-3">{k.vacant} vacant role{k.vacant === 1 ? "" : "s"} across the establishment · bars show each department&apos;s vacancy share of its own positions.</p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-2xl mb-1">✅</span>
              <p className="text-[12px] text-gray-500">{k.establishment ? "No departmental vacancies — every active position is filled." : "No establishment positions recorded yet."}</p>
            </div>
          )}
        </Card>

        <Card title="Turnover & retention" right="separations / month">
          {d.hasTurnoverTrend ? (
            <>
              <Trend points={d.turnoverTrend.map((t: any) => t.value)} labels={d.turnoverTrend.map((t: any) => t.label)} tone="rose" suffix="" />
              <p className="text-[10px] text-gray-400 text-center mt-1">Leavers per month (employment_records end-dates). Rate: <span className="font-semibold text-gray-600">{q(k.turnover)}</span> of active headcount over 12 months.</p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-2xl mb-1">🔄</span>
              <p className="text-[12px] text-gray-500">No separations recorded in the last 6 months.</p>
              <p className="text-[10px] text-gray-400 mt-1">Turnover derives from employment_records end-dates; the trend appears as leavers accrue.</p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recruitment & pipeline">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">📥</span>
            <p className="text-[12px] text-gray-500">An applicant / requisition pipeline is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Vacancies above are live from the establishment; a recruitment store adds requisitions, candidates and time-to-fill.</p>
          </div>
        </Card>

        <Card title="Succession & growth">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">🌱</span>
            <p className="text-[12px] text-gray-500">Succession planning is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Competency readiness above signals bench strength; a succession store adds critical-role coverage and successor readiness.</p>
          </div>
        </Card>

        <Card title="Workforce forecasting">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="text-2xl mb-1">🔮</span>
            <p className="text-[12px] text-gray-500">Demand / supply forecasting is the next phase.</p>
            <p className="text-[10px] text-gray-400 mt-1">Establishment, vacancy and turnover above are the inputs; a forecasting store projects future gaps and hiring needs.</p>
          </div>
        </Card>
      </div>

      <Foot>HEX-004 — executive lens over the Human Resources workspace: <code>loadHrDashboard</code> (headcount &amp; composition, employment lifecycle, establishment/vacancy from the Workforce Assignment Engine, competency coverage, mandatory-learning compliance), the daily <code>competency_readiness_snapshots</code> (readiness trend), the latest daily <code>op_ops_snapshots</code> (safe-staffing FTEs), <code>positions</code> + <code>workforce_assignments</code> + <code>departments</code> (by-department vacancies) and <code>employment_records</code> end-dates (turnover). All live and tenant-scoped, reconciling with the <Link href="/human-resources" className="text-teal-600 hover:underline">HR workspace</Link>. Recruitment pipeline, succession and forecasting need dedicated stores — flagged honestly above, never fabricated.</Foot>
    </div>
  );
}
