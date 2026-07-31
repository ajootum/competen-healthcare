import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadResourceCapacity } from "@/lib/operations/resource-capacity";

// Resource & Capacity Coordination (SSW-OPS-004) — beds, ICU, isolation,
// equipment and shared resources in one place. op_equipment and op_resources
// (migration 101) had ZERO consuming pages platform-wide; this is their first
// surface. Two spec panels are honestly absent rather than faked: critical
// supplies (no consumables/par-level store) and a theatre CASE SCHEDULE
// (op_resources holds counts and a demand flag, not a case list).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "bg-white rounded-xl border border-gray-200 p-5";
const label = "text-[11px] font-semibold text-gray-400 uppercase tracking-wider";
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const EQ_TONE: Record<string, string> = {
  operational: "bg-green-100 text-green-700", under_maintenance: "bg-amber-100 text-amber-700",
  calibration_due: "bg-yellow-100 text-yellow-800", out_of_service: "bg-red-100 text-red-700",
};
const occTone = (pct: number) => pct >= 95 ? "bg-red-500" : pct >= 90 ? "bg-orange-400" : pct >= 75 ? "bg-amber-400" : "bg-teal-500";

function Kpi({ label: l, value, tone, sub }: { label: string; value: React.ReactNode; tone?: string; sub?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{l}</p>
      {sub != null && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function ResourceCapacityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const d: any = await loadResourceCapacity(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const k = d.kpis;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resource &amp; Capacity Coordination</h1>
          <p className="text-sm text-gray-500 mt-1">Beds, critical care, isolation, equipment and shared resources — what is available right now, and what is constrained.</p>
        </div>
        <Link href="/supervisor/bed-management" className="text-sm text-teal-700 hover:underline self-center">Bed management →</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Bed occupancy" value={`${k.occupancy}%`} tone={k.occupancy >= 90 ? "text-red-600" : undefined} sub={`${k.occupied}/${k.totalBeds} occupied`} />
        <Kpi label="Available beds" value={k.availableBeds} tone={k.availableBeds === 0 ? "text-red-600" : undefined} sub={`${k.cleaning} cleaning · ${k.outOfService} out of service`} />
        <Kpi label="ICU available" value={k.icuTotal ? `${k.icuAvailable}/${k.icuTotal}` : "—"} tone={k.icuTotal > 0 && k.icuAvailable === 0 ? "text-red-600" : undefined} sub="critical-care beds" />
        <Kpi label="Isolation" value={`${k.isolationAvailable} free`} tone={d.isolation.shortfall > 0 ? "text-red-600" : undefined} sub={`${k.isolationDemand} patients requiring`} />
        <Kpi label="Equipment readiness" value={k.equipmentReadiness != null ? `${k.equipmentReadiness}%` : "—"} tone={k.equipmentReadiness != null && k.equipmentReadiness < 90 ? "text-orange-600" : undefined} sub={`${d.equipmentSummary.total} items tracked`} />
        <Kpi label="Resource escalations" value={k.openResourceEscalations} tone={k.openResourceEscalations > 0 ? "text-orange-600" : undefined} sub="equipment / operational, open" />
      </div>

      {d.alerts?.length > 0 && (
        <div className={card}>
          <p className={label}>Capacity alerts</p>
          <div className="mt-2 space-y-1">
            {d.alerts.map((a: any, i: number) => (
              <p key={i} className={`text-sm ${a.severity === "high" ? "text-red-700" : "text-amber-700"}`}>⚠ {a.text}</p>
            ))}
          </div>
        </div>
      )}

      {/* Bed capacity by unit */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🛏️ Bed Capacity by Unit <span className="text-gray-400 font-normal">({d.units.length})</span></h3>
        {d.units.length === 0 ? (
          <p className="text-sm text-gray-400">No beds registered. Beds are configured in ward setup.</p>
        ) : (
          <div className="space-y-2">
            {d.units.map((u: any) => (
              <div key={u.unit}>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-40 truncate">{u.unit}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${occTone(u.occupancy)}`} style={{ width: `${u.occupancy}%` }} />
                  </div>
                  <span className={`text-xs tabular-nums w-28 text-right ${u.occupancy >= 90 ? "text-red-600 font-semibold" : "text-gray-500"}`}>{u.occupancy}% · {u.occupied}/{u.total}</span>
                </div>
                <p className="text-[10px] text-gray-400 ml-[10.5rem]">
                  {u.available} available · {u.cleaning} cleaning · {u.reserved} reserved{u.outOfService ? ` · ${u.outOfService} out of service` : ""}{u.icu ? ` · ${u.icu} ICU` : ""}{u.isolation ? ` · ${u.isolation} isolation` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Equipment readiness */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🔧 Equipment Readiness</h3>
          {!d.equipmentProvisioned || d.equipmentSummary.total === 0 ? (
            <p className="text-sm text-gray-400">No equipment registered in the operational inventory.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {[
                  { k: "operational", n: d.equipmentSummary.operational },
                  { k: "under_maintenance", n: d.equipmentSummary.maintenance },
                  { k: "calibration_due", n: d.equipmentSummary.calibrationDue },
                  { k: "out_of_service", n: d.equipmentSummary.outOfService },
                ].filter(x => x.n > 0).map(x => (
                  <span key={x.k} className={`text-xs px-2 py-1 rounded-full ${EQ_TONE[x.k]}`}>{titleCase(x.k)} · {x.n}</span>
                ))}
              </div>
              <div className="space-y-1.5">
                {d.equipmentByCategory.map((c: any) => (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-32 truncate">{titleCase(c.category)}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${c.readiness >= 90 ? "bg-green-500" : c.readiness >= 70 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${c.readiness}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-gray-500 w-20 text-right">{c.readiness}% · {c.operational}/{c.total}</span>
                  </div>
                ))}
              </div>
              {d.equipmentAttention.length > 0 && (
                <div className="mt-3 pt-2 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase mb-1">Needs attention</p>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {d.equipmentAttention.map((e: any) => (
                      <p key={e.id} className="text-xs text-gray-600 flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${EQ_TONE[e.status]}`}>{titleCase(e.status)}</span>
                        {e.name}<span className="text-gray-400">{e.category ? titleCase(e.category) : ""}</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Isolation + ICU */}
        <div className="space-y-5">
          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🦠 Isolation Capacity</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.isolation.beds}</p><p className="text-[10px] text-gray-500">dedicated beds</p></div>
              <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.isolation.available}</p><p className="text-[10px] text-gray-500">available</p></div>
              <div><p className={`text-xl font-bold tabular-nums ${d.isolation.shortfall > 0 ? "text-red-600" : "text-gray-900"}`}>{d.isolation.patientsRequiring}</p><p className="text-[10px] text-gray-500">patients requiring</p></div>
            </div>
            {d.isolation.byType.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {d.isolation.byType.map((t: any) => (
                  <span key={t.type} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">{titleCase(t.type)} × {t.n}</span>
                ))}
              </div>
            )}
            {d.isolation.shortfall > 0 && (
              <p className="text-xs text-red-700 mt-2">{d.isolation.shortfall} patient(s) beyond dedicated isolation capacity — siding and cohorting decisions required.</p>
            )}
          </div>

          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🫀 Critical Care Capacity</h3>
            {d.icu.total === 0 ? (
              <p className="text-sm text-gray-400">No critical-care beds registered on this tenant.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.icu.total}</p><p className="text-[10px] text-gray-500">ICU beds</p></div>
                <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.icu.occupied}</p><p className="text-[10px] text-gray-500">occupied</p></div>
                <div><p className={`text-xl font-bold tabular-nums ${d.icu.available === 0 ? "text-red-600" : "text-green-700"}`}>{d.icu.available}</p><p className="text-[10px] text-gray-500">available</p></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Shared resources + turnaround */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🏗️ Shared Resources</h3>
          {!d.resourcesProvisioned || d.resourcesByCategory.length === 0 ? (
            <p className="text-sm text-gray-400">No shared resources registered (theatres, procedure rooms, transport).</p>
          ) : (
            <div className="space-y-2">
              {d.resourcesByCategory.map((r: any) => (
                <div key={r.category}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-36 truncate">{titleCase(r.category)}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${r.utilisation >= 90 ? "bg-red-500" : r.utilisation >= 70 ? "bg-amber-400" : "bg-teal-500"}`} style={{ width: `${r.utilisation}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-gray-500 w-24 text-right">{r.available}/{r.total} free</span>
                  </div>
                  {r.strained > 0 && <p className="text-[10px] text-orange-600 ml-[9.5rem]">{r.strained} flagged high demand</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Availability counts and demand flags. A theatre CASE SCHEDULE is not modelled in the operational schema — this shows capacity, not a booked case list.</p>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🔄 Bed Turnaround In Flight <span className="text-gray-400 font-normal">({d.turnaroundAging.length})</span></h3>
          {d.turnaroundAging.length === 0 ? (
            <p className="text-sm text-gray-400">No beds mid-turnaround. Completed turnarounds return beds to available.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {d.turnaroundStages.map((s: any) => (
                  <span key={s.stage} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{titleCase(s.stage)} × {s.n}</span>
                ))}
              </div>
              <div className="space-y-1">
                {d.turnaroundAging.map((t: any) => (
                  <p key={t.id} className="text-xs text-gray-600 flex items-center gap-2">
                    <span className="text-gray-400">{titleCase(t.stage)}</span>
                    <span className={`ml-auto tabular-nums ${t.ageMin > 120 ? "text-red-600 font-semibold" : t.ageMin > 60 ? "text-amber-600" : "text-gray-400"}`}>{t.ageMin} min in stage</span>
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resource escalations */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">⬆️ Resource Escalations <span className="text-gray-400 font-normal">({d.escalations.length})</span></h3>
        {d.escalations.length === 0 ? (
          <p className="text-sm text-gray-400">No open equipment or operational escalations.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {d.escalations.map((e: any) => (
              <p key={e.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-gray-800">L{e.level}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{titleCase(e.escalation_type)}</span>
                <span className="text-gray-600 flex-1 min-w-0 truncate">{e.summary}</span>
                <Link href="/supervisor/escalations" className="text-xs text-teal-700 hover:underline">Manage →</Link>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <p className={label}>Not tracked in the operational schema</p>
        <p className="text-sm text-gray-600 mt-1">
          <span className="font-medium">Critical supplies &amp; consumables</span> — there is no par-level or stock store, so supply status cannot be shown without inventing it. Supply shortages raised by nurses do appear above as resource escalations.
        </p>
        <p className="text-sm text-gray-600 mt-1">
          <span className="font-medium">Theatre case scheduling</span> — theatre capacity is tracked as counts and demand, not as a booked case list.
        </p>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Live from the bed register, equipment inventory, shared-resource register, isolation status on the census and the open escalation queue.
      </p>
    </div>
  );
}
