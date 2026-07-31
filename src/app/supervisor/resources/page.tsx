import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadResourceCapacity } from "@/lib/operations/resource-capacity";
import { cardClass, Badge, Alert, Progress, type BadgeTone } from "@/components/ui/primitives";
import { KpiRibbon } from "@/components/ui/charts";

// Resource & Capacity Coordination (SSW-OPS-004) — beds, ICU, isolation,
// equipment and shared resources in one place. op_equipment and op_resources
// (migration 101) had ZERO consuming pages platform-wide; this is their first
// surface. Two spec panels are honestly absent rather than faked: critical
// supplies (no consumables/par-level store) and a theatre CASE SCHEDULE
// (op_resources holds counts and a demand flag, not a case list).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
// Equipment status -> library Badge tone. One mapping, not four bespoke class strings.
const EQ_TONE: Record<string, BadgeTone> = {
  operational: "success", under_maintenance: "warning", calibration_due: "warning", out_of_service: "critical",
};

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

      <KpiRibbon kpis={[
        { label: "Bed occupancy", value: `${k.occupancy}%`, tone: k.occupancy >= 90 ? "critical" : "default", sub: `${k.occupied}/${k.totalBeds} occupied` },
        { label: "Available beds", value: k.availableBeds, tone: k.availableBeds === 0 ? "critical" : "default", sub: `${k.cleaning} cleaning · ${k.outOfService} out of service` },
        { label: "ICU available", value: k.icuTotal ? `${k.icuAvailable}/${k.icuTotal}` : "—", tone: k.icuTotal > 0 && k.icuAvailable === 0 ? "critical" : "default", sub: "critical-care beds" },
        { label: "Isolation", value: `${k.isolationAvailable} free`, tone: d.isolation.shortfall > 0 ? "critical" : "default", sub: `${k.isolationDemand} patients requiring` },
        { label: "Equipment readiness", value: k.equipmentReadiness != null ? `${k.equipmentReadiness}%` : "—", tone: k.equipmentReadiness != null && k.equipmentReadiness < 90 ? "warning" : "default", sub: `${d.equipmentSummary.total} items tracked` },
        { label: "Resource escalations", value: k.openResourceEscalations, tone: k.openResourceEscalations > 0 ? "warning" : "default", sub: "equipment / operational, open", href: "/supervisor/escalations" },
      ]} />

      {d.alerts?.length > 0 && (
        <div className="space-y-2">
          {d.alerts.map((a: any, i: number) => (
            <Alert key={i} tone={a.severity === "high" ? "critical" : "warning"}>{a.text}</Alert>
          ))}
        </div>
      )}

      {/* Bed capacity by unit */}
      <div className={cardClass}>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🛏️ Bed Capacity by Unit <span className="text-gray-400 font-normal">({d.units.length})</span></h3>
        {d.units.length === 0 ? (
          <p className="text-sm text-gray-400">No beds registered. Beds are configured in ward setup.</p>
        ) : (
          <div className="space-y-2">
            {d.units.map((u: any) => (
              <div key={u.unit}>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 w-40 truncate">{u.unit}</span>
                  <div className="flex-1">
                    <Progress value={u.occupancy} label={`${u.unit} occupancy`} showValue={false}
                      tone={u.occupancy >= 90 ? "critical" : u.occupancy >= 75 ? "warning" : "primary"} />
                  </div>
                  <span className={`text-xs tabular-nums w-28 text-right ${u.occupancy >= 90 ? "text-[var(--cmp-text-critical)] font-semibold" : "text-gray-500"}`}>{u.occupancy}% · {u.occupied}/{u.total}</span>
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
        <div className={cardClass}>
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
                  <Badge key={x.k} tone={EQ_TONE[x.k]}>{titleCase(x.k)} · {x.n}</Badge>
                ))}
              </div>
              <div className="space-y-1.5">
                {d.equipmentByCategory.map((c: any) => (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-32 truncate">{titleCase(c.category)}</span>
                    <div className="flex-1">
                      <Progress value={c.readiness} label={`${titleCase(c.category)} readiness`} showValue={false}
                        tone={c.readiness >= 90 ? "success" : c.readiness >= 70 ? "warning" : "critical"} />
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
                        <Badge tone={EQ_TONE[e.status]}>{titleCase(e.status)}</Badge>
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
          <div className={cardClass}>
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🦠 Isolation Capacity</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.isolation.beds}</p><p className="text-[10px] text-gray-500">dedicated beds</p></div>
              <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.isolation.available}</p><p className="text-[10px] text-gray-500">available</p></div>
              <div><p className={`text-xl font-bold tabular-nums ${d.isolation.shortfall > 0 ? "text-[var(--cmp-text-critical)]" : "text-gray-900"}`}>{d.isolation.patientsRequiring}</p><p className="text-[10px] text-gray-500">patients requiring</p></div>
            </div>
            {d.isolation.byType.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {d.isolation.byType.map((t: any) => (
                  <Badge key={t.type} tone="info">{titleCase(t.type)} × {t.n}</Badge>
                ))}
              </div>
            )}
            {d.isolation.shortfall > 0 && (
              <p className="text-xs text-[var(--cmp-text-critical)] mt-2">{d.isolation.shortfall} patient(s) beyond dedicated isolation capacity — siding and cohorting decisions required.</p>
            )}
          </div>

          <div className={cardClass}>
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🫀 Critical Care Capacity</h3>
            {d.icu.total === 0 ? (
              <p className="text-sm text-gray-400">No critical-care beds registered on this tenant.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.icu.total}</p><p className="text-[10px] text-gray-500">ICU beds</p></div>
                <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.icu.occupied}</p><p className="text-[10px] text-gray-500">occupied</p></div>
                <div><p className={`text-xl font-bold tabular-nums ${d.icu.available === 0 ? "text-[var(--cmp-text-critical)]" : "text-[var(--cmp-text-success)]"}`}>{d.icu.available}</p><p className="text-[10px] text-gray-500">available</p></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Shared resources + turnaround */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className={cardClass}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🏗️ Shared Resources</h3>
          {!d.resourcesProvisioned || d.resourcesByCategory.length === 0 ? (
            <p className="text-sm text-gray-400">No shared resources registered (theatres, procedure rooms, transport).</p>
          ) : (
            <div className="space-y-2">
              {d.resourcesByCategory.map((r: any) => (
                <div key={r.category}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-36 truncate">{titleCase(r.category)}</span>
                    <div className="flex-1">
                      <Progress value={r.utilisation} label={`${titleCase(r.category)} utilisation`} showValue={false}
                        tone={r.utilisation >= 90 ? "critical" : r.utilisation >= 70 ? "warning" : "primary"} />
                    </div>
                    <span className="text-xs tabular-nums text-gray-500 w-24 text-right">{r.available}/{r.total} free</span>
                  </div>
                  {r.strained > 0 && <p className="text-[10px] text-[var(--cmp-text-warning)] ml-[9.5rem]">{r.strained} flagged high demand</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Availability counts and demand flags. A theatre CASE SCHEDULE is not modelled in the operational schema — this shows capacity, not a booked case list.</p>
        </div>

        <div className={cardClass}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">🔄 Bed Turnaround In Flight <span className="text-gray-400 font-normal">({d.turnaroundAging.length})</span></h3>
          {d.turnaroundAging.length === 0 ? (
            <p className="text-sm text-gray-400">No beds mid-turnaround. Completed turnarounds return beds to available.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {d.turnaroundStages.map((s: any) => (
                  <Badge key={s.stage} tone="neutral">{titleCase(s.stage)} × {s.n}</Badge>
                ))}
              </div>
              <div className="space-y-1">
                {d.turnaroundAging.map((t: any) => (
                  <p key={t.id} className="text-xs text-gray-600 flex items-center gap-2">
                    <span className="text-gray-400">{titleCase(t.stage)}</span>
                    <span className={`ml-auto tabular-nums ${t.ageMin > 120 ? "text-[var(--cmp-text-critical)] font-semibold" : t.ageMin > 60 ? "text-[var(--cmp-text-warning)]" : "text-gray-400"}`}>{t.ageMin} min in stage</span>
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Resource escalations */}
      <div className={cardClass}>
        <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">⬆️ Resource Escalations <span className="text-gray-400 font-normal">({d.escalations.length})</span></h3>
        {d.escalations.length === 0 ? (
          <p className="text-sm text-gray-400">No open equipment or operational escalations.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {d.escalations.map((e: any) => (
              <p key={e.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-gray-800">L{e.level}</span>
                <Badge tone="neutral">{titleCase(e.escalation_type)}</Badge>
                <span className="text-gray-600 flex-1 min-w-0 truncate">{e.summary}</span>
                <Link href="/supervisor/escalations" className="text-xs text-teal-700 hover:underline">Manage →</Link>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className={cardClass}>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Not tracked in the operational schema</p>
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
