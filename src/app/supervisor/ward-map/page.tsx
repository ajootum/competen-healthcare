import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime, titleCase, ewsColor, STATE_TONE, BED_TONE } from "@/lib/operations/patient-ops";

export const dynamic = "force-dynamic";

// Ward Map (SSW-005 · Patient Operations) — a visual overview of the ward built
// from the shared patient/bed/acuity/staffing model. There are NO floor-plan
// coordinates in the operational schema, so beds are laid out as a grid grouped
// by zone (department) and coloured by patient clinical state / bed status rather
// than a fabricated spatial plan. Overlays shown are acuity / PEWS / status only.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function WardMapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const po = await loadPatientOps(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Ward Map</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div>
    </div>
  );

  const { zones, copilot, summary, capacity } = po;

  // Header quick-stat strip — all figures are live from the shared model.
  const stats = [
    { label: "Patients in care", value: summary.total, tone: "text-gray-900" },
    { label: "Occupancy", value: `${capacity.occPct}%`, sub: `${capacity.occupied}/${capacity.total} beds`, tone: capacity.occPct >= 90 ? "text-red-600" : capacity.occPct >= 75 ? "text-orange-600" : "text-green-600" },
    { label: "High risk", value: summary.highRisk, tone: summary.highRisk ? "text-red-600" : "text-gray-900" },
    { label: "Available beds", value: capacity.available, tone: capacity.available ? "text-blue-600" : "text-gray-900" },
    { label: "Isolation", value: summary.isolation, tone: summary.isolation ? "text-purple-600" : "text-gray-900" },
    { label: "Zones", value: zones.length, tone: "text-gray-900" },
  ];

  // AI insight — high-acuity concentration derived from live zone rollups.
  const hotZones = zones.filter(z => z.highRisk >= 2).sort((a, b) => b.highRisk - a.highRisk);
  const nurseGap = zones.filter(z => z.patients > 0 && z.staff === 0);
  const copilotHints = copilot.filter(c => /rebalanc|acuity|no assigned nurse/i.test(c.text)).slice(0, 3);

  // Legend — text + colour, never colour alone.
  const legend = [
    { label: "Stable", cls: "bg-green-100 text-green-700" },
    { label: "Review / observation", cls: "bg-amber-100 text-amber-700" },
    { label: "High risk / critical", cls: "bg-red-100 text-red-700" },
    { label: "Isolation", cls: "bg-purple-100 text-purple-700" },
    { label: "Available", cls: "bg-blue-100 text-blue-700" },
    { label: "Reserved", cls: "bg-violet-100 text-violet-700" },
    { label: "Cleaning / maintenance", cls: "bg-orange-100 text-orange-700" },
  ];

  const actions = [
    { label: "Open Patient", icon: "👤", href: "/supervisor/patient-list" },
    { label: "Assign Nurse", icon: "👥", href: "/supervisor/operations?section=assignments" },
    { label: "Move Patient", icon: "🔀", href: "/supervisor/operations?section=ward" },
    { label: "Request Review", icon: "🔎", href: "/supervisor/operations?section=safety" },
    { label: "Escalate", icon: "🚨", href: "/supervisor/operations?section=safety", danger: true },
    { label: "Mark for Cleaning", icon: "🧹", href: "/supervisor/bed-management" },
  ];

  const initials = (label: string) => (label ?? "").split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();

  return (
    <div className="space-y-5">
      {/* A) Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ward Map</h1>
        <p className="text-sm text-gray-500 mt-0.5">Visual overview of the ward</p>
      </div>

      {/* Quick-stat strip */}
      <div className="bg-white rounded-xl border border-gray-200 px-2 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          {stats.map((s, i) => (
            <div key={i} className="px-3 py-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{s.label}</p>
              <p className={`text-lg font-bold tabular-nums leading-tight ${s.tone}`}>{s.value}</p>
              {s.sub && <p className="text-[10px] text-gray-400 leading-tight">{s.sub}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* C) Legend */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">🗺️ Legend</h3>
          <span className="text-[11px] text-gray-400">Colour indicates clinical state or bed status</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {legend.map(l => (
            <span key={l.label} className={`inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 ${l.cls}`}>
              <span className="w-2 h-2 rounded-full bg-current opacity-70" aria-hidden />{l.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-200">◐ ISO — isolation precaution</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-1 bg-red-50 text-red-700 border border-red-200">⚠ n — open safety alerts</span>
        </div>
      </div>

      {/* B) Zone bed grids */}
      <div className="space-y-4">
        {zones.map(zone => (
          <div key={zone.name} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                🏥 {zone.name}
                <span className="text-[11px] font-normal text-gray-400">{zone.beds.length} bed{zone.beds.length !== 1 ? "s" : ""}</span>
              </h3>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{zone.patients} patient{zone.patients !== 1 ? "s" : ""}</span>
                {zone.highRisk > 0 && <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5">{zone.highRisk} high risk</span>}
                <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5">{zone.available} available</span>
                <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{zone.staff} staff</span>
                {zone.alerts > 0 && <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5">{zone.alerts} alert{zone.alerts !== 1 ? "s" : ""}</span>}
              </div>
            </div>
            {zone.beds.length === 0 ? (
              <p className="text-sm text-gray-400">No beds configured in this zone.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                {zone.beds.map(bed => {
                  const p = bed.patient;
                  const tone = p ? (STATE_TONE[p.state] ?? "bg-gray-100 text-gray-700") : (BED_TONE[bed.status] ?? "border-gray-200");
                  return (
                    <div
                      key={bed.id}
                      title={p ? `${p.label} · ${p.state}${p.lastObs ? ` · last obs ${fmtTime(p.lastObs)}` : ""}` : `${bed.label} · ${titleCase(bed.status)}`}
                      className={`rounded-lg border p-2 min-h-[70px] flex flex-col justify-between ${tone}`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-[10px] font-semibold truncate">{bed.label}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {p && p.isolation !== "none" && <span className="text-[9px] font-bold text-purple-600" title={`${titleCase(p.isolation)} isolation`}>◐ISO</span>}
                          {p && p.alerts.length > 0 && <span className="text-[9px] font-bold text-red-600">⚠{p.alerts.length}</span>}
                        </span>
                      </div>
                      {p ? (
                        <>
                          <p className="text-xs font-semibold truncate" title={p.label}>{initials(p.label)}</p>
                          <div className="flex items-end justify-between gap-1">
                            <span className="text-[9px] font-medium uppercase tracking-tight truncate">{p.state}</span>
                            <span className={`text-sm font-bold tabular-nums shrink-0 ${ewsColor(p.pews)}`}>{p.pews ?? "—"}</span>
                          </div>
                        </>
                      ) : (
                        <span className="text-[10px] font-medium text-gray-500">{titleCase(bed.status)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* E) AI insight + D) zone workload */}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className={`${card} lg:col-span-2`}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">📊 Zone Workload</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-medium">Zone</th>
                  <th className="py-1.5 px-1 font-medium text-right">Patients</th>
                  <th className="py-1.5 px-1 font-medium text-right">High risk</th>
                  <th className="py-1.5 px-1 font-medium text-right">Staff</th>
                  <th className="py-1.5 px-1 font-medium text-right">Ratio</th>
                  <th className="py-1.5 px-1 font-medium text-right">Open alerts</th>
                  <th className="py-1.5 px-1 font-medium text-right">Available</th>
                </tr>
              </thead>
              <tbody>
                {zones.map(z => (
                  <tr key={z.name} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 font-medium text-gray-800 truncate max-w-[10rem]">{z.name}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums text-gray-700">{z.patients}</td>
                    <td className={`py-1.5 px-1 text-right tabular-nums font-semibold ${z.highRisk ? "text-red-600" : "text-gray-400"}`}>{z.highRisk}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums text-gray-700">{z.staff}</td>
                    <td className={`py-1.5 px-1 text-right tabular-nums ${z.ratio != null && z.ratio > 4 ? "text-orange-600 font-semibold" : "text-gray-700"}`}>{z.ratio ?? "—"}</td>
                    <td className={`py-1.5 px-1 text-right tabular-nums ${z.alerts ? "text-orange-600 font-semibold" : "text-gray-400"}`}>{z.alerts}</td>
                    <td className="py-1.5 px-1 text-right tabular-nums text-blue-600">{z.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Ratio is patients per assigned nurse in the zone; &ldquo;—&rdquo; means no nurse is yet assigned there.</p>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">✨ AI Insight</h3>
          <div className="space-y-2">
            {hotZones.length === 0 && nurseGap.length === 0 && copilotHints.length === 0 && (
              <p className="text-sm text-gray-500">Acuity is spread evenly across zones — no concentration to rebalance right now.</p>
            )}
            {hotZones.slice(0, 2).map(z => (
              <div key={z.name} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                <p className="text-sm text-amber-900"><span className="font-semibold">{z.name}</span> holds {z.highRisk} high-acuity patient{z.highRisk !== 1 ? "s" : ""} with {z.staff} staff{z.ratio != null ? ` (ratio ${z.ratio})` : ""}. Consider rebalancing assignments.</p>
                <Link href="/supervisor/operations?section=assignments" className="text-[11px] font-medium text-teal-700 hover:underline">Rebalance assignments →</Link>
              </div>
            ))}
            {nurseGap.slice(0, 2).map(z => (
              <div key={z.name} className="rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
                <p className="text-sm text-orange-900"><span className="font-semibold">{z.name}</span> has {z.patients} patient{z.patients !== 1 ? "s" : ""} but no assigned nurse.</p>
                <Link href="/supervisor/operations?section=assignments" className="text-[11px] font-medium text-teal-700 hover:underline">Assign staff →</Link>
              </div>
            ))}
            {copilotHints.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700 truncate flex-1">{c.text}</span>
                <Link href="/supervisor/operations?section=assignments" className="text-[11px] font-medium text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 hover:bg-teal-50 shrink-0">{c.action}</Link>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Rule-based suggestions from live zone rollups.</p>
        </div>
      </div>

      {/* G) Actions bar */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">⚡ Ward Actions</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {actions.map(a => (
            <Link key={a.label} href={a.href} className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 px-1 text-center transition-colors ${a.danger ? "border-red-200 hover:bg-red-50/50" : "border-gray-200 hover:border-teal-300 hover:bg-teal-50/40"}`}>
              <span className="text-lg">{a.icon}</span>
              <span className={`text-[10px] leading-tight ${a.danger ? "text-red-600" : "text-gray-600"}`}>{a.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* F) Honest note */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          This map is a <span className="font-medium text-gray-600">zone-grouped grid</span>, not a true spatial floor plan — the operational schema holds no ward-layout coordinates.
          Beds are grouped by department and the only overlays shown are <span className="font-medium text-gray-600">acuity, PEWS and bed status</span>, all live from the shared patient-operations model.
          A real floor plan with positioned beds, plus staff break / workload overlays, activates once ward-layout configuration is added.
        </p>
      </div>
    </div>
  );
}
