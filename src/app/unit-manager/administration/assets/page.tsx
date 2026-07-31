import { loadAdmAssets } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Pill, Provision, Foot } from "../_ui";
import { STATUS_TONE } from "@/lib/admin/admin-suite";

export const dynamic = "force-dynamic";

// UMW-ADM-004 Resource & Asset Administration — full asset lifecycle: register, maintenance, calibration, warranty
// and utilisation. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_COLORS = ["#22c55e", "#a855f7", "#f59e0b", "#3b82f6", "#ef4444", "#14b8a6"];
const STATUS_COLORS: Record<string, string> = { in_service: "#22c55e", under_maintenance: "#f59e0b", out_of_service: "#ef4444", in_storage: "#3b82f6", pending: "#a855f7" };
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; } };
const dueTone = (n: number | null) => (n == null ? "slate" : n < 0 ? "rose" : n <= 7 ? "rose" : n <= 30 ? "amber" : "emerald");

export default async function AssetsPage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmAssets(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-004 · Administration & Configuration" title="Resource & Asset Administration" sub="Manage the complete lifecycle of all unit resources and assets — availability, maintenance, calibration, warranty and utilisation." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="004" /><Provision module="Asset Administration" part="part 1" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="004" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Asset Readiness" value={`${k.readiness}%`} sub="in service" tone={k.readiness >= 85 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"} />
        <Kpi label="Availability" value={`${k.availability}%`} sub="usable" />
        <Kpi label="Total Assets" value={k.total} sub="registered" />
        <Kpi label="Maintenance Due" value={k.maintDue} sub="next 30 days" tone={k.maintDue ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Calibration Due" value={k.calDue} sub="next 30 days" tone={k.calDue ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Assets Down" value={k.down} sub="maint. + OOS" tone={k.down ? "text-[var(--cmp-text-error)]" : undefined} />
        <Kpi label="Utilisation" value={`${k.utilisation}%`} sub="average" />
        <Kpi label="Warranty Covered" value={`${k.warrantyCovered}%`} sub="under warranty" tone="text-[var(--cmp-text-success)]" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Assets by Category">
          <div className="flex items-center gap-3">
            <Donut segs={d.byCategory.map((c: any, i: number) => ({ n: c.n, color: CAT_COLORS[i % CAT_COLORS.length] }))} total={k.total} centre={k.total} sub="assets" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{d.byCategory.map((c: any, i: number) => <div key={c.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{c.label}</span><span className="font-semibold text-gray-900">{c.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Assets by Status">
          <div className="flex items-center gap-3">
            <Donut segs={d.byStatus.map((s: any) => ({ n: s.n, color: STATUS_COLORS[s.status] }))} total={k.total} centre={k.total} sub="assets" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{d.byStatus.map((s: any) => <div key={s.status} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} /><span className="text-gray-600 flex-1 truncate">{s.label}</span><span className="font-semibold text-gray-900">{s.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Maintenance Due" right={<span className="text-[11px] text-gray-400">next 30 days</span>}>
          {d.maintenanceDue.length ? <div className="space-y-2">{d.maintenanceDue.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[11px] text-gray-800 leading-tight truncate">{a.name}</p><p className="text-[10px] text-gray-400">{a.asset_tag} · {fmtD(a.maintenance_due)}</p></div><Pill text={a.maintIn < 0 ? `${-a.maintIn}d over` : `${a.maintIn}d`} tone={dueTone(a.maintIn)} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">None due.</p>}
        </Card>

        <Card title="Calibration Due" right={<span className="text-[11px] text-gray-400">next 30 days</span>}>
          {d.calibrationDue.length ? <div className="space-y-2">{d.calibrationDue.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[11px] text-gray-800 leading-tight truncate">{a.name}</p><p className="text-[10px] text-gray-400">{a.asset_tag} · {fmtD(a.calibration_due)}</p></div><Pill text={a.calIn < 0 ? `${-a.calIn}d over` : `${a.calIn}d`} tone={dueTone(a.calIn)} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">None due.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Assets at Risk" className="xl:col-span-2">
          {d.atRisk.length ? <div className="space-y-2">{d.atRisk.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5"><span className="text-amber-500">⚠️</span><div className="min-w-0 flex-1"><p className="text-[12px] text-gray-800 leading-tight truncate">{a.name}</p><p className="text-[10px] text-gray-400">{a.location} · {a.custodianName}</p></div><span className="text-[11px] text-gray-500">util {Math.round(Number(a.utilisation_pct || 0))}%</span><Pill text={a.status} tone={STATUS_TONE[a.status]} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No at-risk assets. ✅</p>}
        </Card>

        <Card title="Vendors & Contracts">
          <div className="space-y-2 text-[12px]">{d.vendors.map((v: any) => <div key={v.vendor} className="flex items-center justify-between"><span className="text-gray-700 truncate">{v.vendor}</span><span className="text-gray-400 tabular-nums">{v.n} assets</span></div>)}</div>
        </Card>
      </div>

      <Foot>UMW-ADM-004 — asset lifecycle over adm_assets. Register, category/status mix, maintenance/calibration due, warranty and utilisation are real; work-order management, barcode/QR scanning and predictive-maintenance AI are the next phase. (op_equipment remains the operational equipment-status source.)</Foot>
    </div>
  );
}
