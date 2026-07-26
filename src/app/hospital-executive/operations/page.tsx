import { hexGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Trend, Bars, Table, Foot, T } from "../_ui";
import { loadExecOperations } from "@/lib/hex/operations";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-006 Operations Intelligence (executive lens).
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "Capacity & Flow", "Workforce", "Facilities & Assets", "Supply Chain", "Performance", "Command Centre", "Analytics", "Reports"];

export default async function ExecOperationsPage() {
  const { admin, isSuper, hid } = await hexGuard();
  const d = await loadExecOperations(admin, hid, isSuper);
  const head = <Head code="HEX-006 · Hospital Executive" title="Operations Intelligence" sub="Real-time operational visibility, performance monitoring and execution excellence." action={{ label: "Ops workspace →", href: "/unit-manager" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The operational aggregate (<code>op_ops_snapshots</code>) is not provisioned yet.</p></Card></div>;
  const k = d.kpis;
  const pctv = (v: any) => (v != null ? `${Math.round(Number(v))}%` : "—");
  const numv = (v: any) => (v != null ? `${v}` : "—");

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon="🧭" tone={k.capacityScore != null && Number(k.capacityScore) >= 85 ? "emerald" : "amber"} label="Overall operations score" value={pctv(k.capacityScore)} sub="capacity index" />
        <Stat icon="🛏️" tone={k.occupancy != null && Number(k.occupancy) >= 95 ? "rose" : "blue"} label="Bed occupancy" value={pctv(k.occupancy)} />
        <Stat icon="🔁" tone="teal" label="Patient throughput" value={numv(k.throughput)} sub="admits + discharges (day)" />
        <Stat icon="⏱️" tone="indigo" label="Average length of stay" value={k.avgLos != null ? `${Number(k.avgLos).toFixed(1)}` : "—"} sub="days" />
        <Stat icon="🔪" tone="violet" label="Theatre utilisation" value={pctv(k.theatre)} />
        <Stat icon="🌅" tone="amber" label="Discharge before noon" value={pctv(k.dischargeNoon)} />
        <Stat icon="👥" tone={k.safeStaffing != null && Number(k.safeStaffing) >= 85 ? "emerald" : "amber"} label="Safe staffing" value={pctv(k.safeStaffing)} />
        <Stat icon="🚨" tone={k.openAlerts ? "rose" : "emerald"} label="Open operational alerts" value={k.openAlerts} sub={`${k.openEsc} esc · ${k.activeSafety} safety`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Bed capacity & status" right={d.totalBeds ? `${d.totalBeds} beds` : "snapshot only"}>
          {d.totalBeds ? (
            <div className="flex items-center gap-3">
              <Donut segments={d.bedStatus} total={d.totalBeds} label="Beds" size={130} />
              <Legend items={d.bedStatus.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: d.totalBeds ? Math.round((s.value / d.totalBeds) * 100) : 0 }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No bed records yet — occupancy is shown from the daily snapshot ({pctv(k.occupancy)}); bed detail pending.</p>}
        </Card>

        <Card title="Patient flow" right="operational status">
          {d.hasPatients ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Expected", value: d.flow.expected, tone: "blue" },
                { label: "In care", value: d.flow.admitted, tone: "emerald" },
                { label: "Discharge pending", value: d.flow.dischargePending, tone: "violet" },
                { label: "Discharged", value: d.flow.discharged, tone: "slate" },
              ].map((f, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${T(f.tone).dot}`} /><span className="text-[11px] text-gray-500">{f.label}</span></div>
                  <p className="text-[20px] font-bold text-gray-900 tabular-nums mt-0.5">{f.value}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400 py-4 text-center">No live patient records — flow shown from the daily snapshot below.</p>}
          <div className="flex items-center justify-around mt-3 pt-3 border-t border-gray-100 text-center">
            <div><p className="text-[11px] text-gray-500">Admissions (day)</p><p className="text-[18px] font-bold text-emerald-600 tabular-nums">{numv(d.flow.admissions)}</p></div>
            <div><p className="text-[11px] text-gray-500">Discharges (day)</p><p className="text-[18px] font-bold text-blue-600 tabular-nums">{numv(d.flow.discharges)}</p></div>
            <div><p className="text-[11px] text-gray-500">Patients tracked</p><p className="text-[18px] font-bold text-gray-900 tabular-nums">{d.hasPatients ? d.flow.total : "—"}</p></div>
          </div>
        </Card>

        <Card title="Operational alerts" right="recent escalations">
          <Table cols={["Escalation", "Level", "Severity", "Status"]} rows={d.alerts.map((a: any) => [
            <span key="s" className="font-medium text-gray-800 truncate block max-w-[190px]">{a.summary}</span>,
            <span key="l" className="text-gray-500 tabular-nums">{a.level != null ? `L${a.level}` : "—"}</span>,
            <Pill key="sev" text={a.severity} tone={a.sevTone} />,
            <Pill key="st" text={a.status} tone={a.statusTone} />,
          ])} empty="No escalations in the operational log. ✅" />
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Occupancy trend" className="xl:col-span-2" right="last 6 months">
          {d.trend.length >= 2 ? <><Trend points={d.trend.map((t: any) => t.value)} labels={d.trend.map((t: any) => t.label)} tone="blue" suffix="%" /><p className="text-[10px] text-gray-400 text-center mt-1">Bed occupancy % per month — latest daily snapshot in each month.</p></> : <p className="text-sm text-gray-400 py-8 text-center">Not enough snapshot history yet.</p>}
        </Card>

        <Card title="Performance by domain" right="latest snapshot">
          {d.domains.length ? <Bars items={d.domains.map((x: any) => ({ label: x.label, pct: x.pct, value: `${x.pct}%` }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No snapshot metrics yet.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Facilities & equipment" right={d.equip.readiness != null ? `${d.equip.readiness}% ready` : "no assets"}>
          {d.equip.total ? (
            <div className="flex items-center gap-3">
              <Donut segments={d.equip.donut} total={d.equip.total} label="Assets" size={130} />
              <Legend items={d.equip.donut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone }))} />
            </div>
          ) : <p className="text-sm text-gray-400 py-6 text-center">No equipment records yet.</p>}
        </Card>

        <Card title="Resource availability" right="available vs total">
          {d.resource.length ? <Bars items={d.resource.map((r: any) => ({ label: r.label, pct: r.pct, value: r.value }))} /> : <p className="text-sm text-gray-400 py-6 text-center">No resource records yet.</p>}
        </Card>

        <Card title="Supply chain & procurement">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">Next phase</span>
          <p className="text-sm text-gray-500 leading-relaxed">Inventory, procurement and business-continuity tracking need their own operational stores. Once provisioned, stock levels, purchase orders and continuity readiness surface here alongside the live capacity picture.</p>
        </Card>
      </div>

      <Foot>HEX-006 — live over the daily <code>op_ops_snapshots</code> aggregate (occupancy, LOS, throughput, theatre utilisation, discharge-before-noon, safe staffing and the capacity score, plus the 6-month occupancy trend), <code>op_beds</code> by status, <code>op_patients</code> by operational status, open <code>op_escalations</code> + active <code>op_safety_alerts</code>, and <code>op_equipment</code> / <code>op_resources</code> readiness. All real and tenant-scoped, reconciling with the <Link href="/unit-manager" className="text-teal-600 hover:underline">Operations workspace</Link>. Supply-chain / procurement and business-continuity have no store yet (next phase); where bed or patient detail is empty the snapshot-derived figures stand in.</Foot>
    </div>
  );
}
