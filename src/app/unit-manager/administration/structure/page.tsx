import { loadAdmStructure } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Progress, Pill, Provision, Foot } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-ADM-002 Unit Structure & Organization Manager — the authoritative unit structure: profile, hierarchy, physical
// layout, beds, services, establishment and operational rules. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ROOM_LABEL: Record<string, string> = { patient: "Patient", clinical_support: "Clinical Support", staff: "Staff", utility: "Utility", isolation: "Isolation", theatre: "Theatre", store: "Store", nurse_station: "Nurse Station" };

export default async function StructurePage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmStructure(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-002 · Administration & Configuration" title="Unit Structure & Organization Manager" sub="Design and manage the organizational, physical and operational structure of your unit — the master metadata for workforce, operations and analytics." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="002" /><Provision module="Unit Structure" /></div>;

  const k = d.kpis, p = d.profile;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="002" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Departments" value={k.departments} sub="in hospital" />
        <Kpi label="Rooms" value={k.rooms} sub="physical" />
        <Kpi label="Beds" value={k.beds} sub={`${d.beds.occupied} occupied`} />
        <Kpi label="Services" value={k.services} sub="active" />
        <Kpi label="Cost Centres" value={k.costCentres} sub="financial" />
        <Kpi label="Establishment" value={k.establishment} sub={`${d.establishment.filled} filled`} />
        <Kpi label="Operational Rules" value={d.rules.length} sub="configured" />
        <Kpi label="Structure Health" value={`${k.structureHealth}%`} sub="good" tone="text-[var(--cmp-text-success)]" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Unit Profile">
          {p ? <div className="space-y-1.5 text-[12px]">
            {[["Unit Name", p.unit_name], ["Code", p.unit_code], ["Specialty", p.specialty], ["Cost Centre", p.cost_centre], ["Location", p.location], ["Hours", p.operational_hours], ["Manager", p.managerName], ["Version", p.config_version]].map(([l, v]: any) => (
              <div key={l} className="flex items-center justify-between"><span className="text-gray-500">{l}</span><span className="text-gray-900 font-medium text-right truncate ml-2">{v ?? "—"}</span></div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-4 text-center">No profile.</p>}
        </Card>

        <Card title="Organizational Hierarchy" className="xl:col-span-2">
          <div className="rounded-lg bg-[var(--cmp-color-information)] text-white text-center py-2 px-2 mb-2 text-[12px] font-semibold">{p?.unit_name ?? "Unit"} <span className="opacity-70">({p?.unit_code})</span></div>
          <p className="text-[11px] text-gray-500 mb-2">Departments in this hospital ({d.departments.length}):</p>
          <div className="flex flex-wrap gap-1.5">{d.departments.map((dep: any) => <span key={dep.id} className="text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-700">{dep.name}</span>)}</div>
          <div className="mt-3 pt-3 border-t border-gray-100"><p className="text-[11px] font-semibold text-gray-500 mb-1.5">Service Catalogue ({d.services.length})</p>
            <div className="space-y-1 text-[11px]">{d.services.map((s: any) => <div key={s.id} className="flex items-center justify-between"><span className="text-gray-700">{s.name}</span><span className="text-gray-400 tabular-nums">{s.cases} cases</span></div>)}</div>
          </div>
        </Card>

        <Card title="Beds Overview">
          <div className="flex items-center gap-3">
            <Donut segs={[{ n: d.beds.occupied, color: "#22c55e" }, { n: d.beds.available, color: "#3b82f6" }, { n: d.beds.maintenance, color: "#ef4444" }]} total={d.beds.total} centre={d.beds.total} sub="beds" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">
              {[["Occupied", d.beds.occupied, "#22c55e"], ["Available", d.beds.available, "#3b82f6"], ["Out of Service", d.beds.maintenance, "#ef4444"]].map(([l, n, c]: any) => <div key={l} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} /><span className="text-gray-600 flex-1">{l}</span><span className="font-semibold text-gray-900">{n}</span></div>)}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Physical Layout" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">{d.rooms.length} rooms</span>}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {d.rooms.map((r: any) => (
              <div key={r.id} className="border border-gray-200 rounded-lg p-2 text-center"><p className="text-[11px] font-medium text-gray-800 truncate">{r.name}</p><p className="text-[10px] text-gray-400">{ROOM_LABEL[r.room_type] ?? r.room_type}{r.bed_count ? ` · ${r.bed_count} beds` : ""}</p></div>
            ))}
          </div>
        </Card>

        <Card title="Staff Establishment">
          <div className="flex items-center gap-3">
            <Donut segs={[{ n: d.establishment.filled, color: "#22c55e" }, { n: d.establishment.vacant, color: "#f59e0b" }]} total={d.establishment.total} centre={d.establishment.total} sub="positions" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-success)]" /><span className="text-gray-600 flex-1">Filled</span><span className="font-semibold text-gray-900">{d.establishment.filled} ({d.establishment.pct}%)</span></div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--cmp-color-warning)]" /><span className="text-gray-600 flex-1">Vacant</span><span className="font-semibold text-gray-900">{d.establishment.vacant}</span></div>
              <div className="pt-1"><Progress pct={d.establishment.pct} /></div>
            </div>
          </div>
        </Card>

        <Card title="Operational Rules" right={<span className="text-[11px] text-gray-400">{d.rules.length}</span>}>
          <div className="space-y-1.5 text-[12px]">{d.rules.map((r: any) => <div key={r.id} className="flex items-center justify-between"><span className="text-gray-700 truncate">{r.name}</span><Pill text={r.status} tone={r.status === "active" ? "emerald" : "slate"} /></div>)}</div>
        </Card>
      </div>

      <Foot>UMW-ADM-002 — unit structure over adm_rooms / adm_services / adm_operational_rules + adm_unit_profile, reusing live op_beds (bed status) + departments + positions (establishment). Interactive floor-plan editor, org-chart designer and versioned publishing are the next phase.</Foot>
    </div>
  );
}
