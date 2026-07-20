import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPatientOps, fmtTime, titleCase, ewsColor, STATE_TONE, BED_TONE } from "@/lib/operations/patient-ops";

export const dynamic = "force-dynamic";

// Bed Management (SSW-005 / Patient Operations) — ward capacity and bed
// lifecycle. Everything renders from the shared Patient Ops model (po.capacity /
// po.bedBoard / po.cleaningBeds). Data the operational schema does not hold —
// step-by-step turnaround event times and an hourly occupancy forecast — is
// surfaced as honest callouts, never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

// Human labels + text/colour legend keyed to bed status (BED_TONE gives border/bg).
const STATUS_LABEL: Record<string, string> = {
  occupied: "Occupied", available: "Available", reserved: "Reserved", cleaning: "Cleaning", out_of_service: "Maintenance",
};
const STATUS_DOT: Record<string, string> = {
  occupied: "bg-gray-400", available: "bg-blue-500", reserved: "bg-violet-500", cleaning: "bg-orange-500", out_of_service: "bg-gray-500",
};

export default async function BedManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const po = await loadPatientOps(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!po.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Bed Management</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );

  const { capacity, bedBoard, cleaningBeds } = po;

  // B) Capacity KPI row — all real figures from po.capacity.
  const kpis: { label: string; n: number; sub?: string; tone: string }[] = [
    { label: "Total beds", n: capacity.total, tone: "text-gray-900" },
    { label: "Occupied", n: capacity.occupied, sub: `${capacity.occPct}% occupancy`, tone: "text-gray-900" },
    { label: "Available", n: capacity.available, tone: "text-blue-600" },
    { label: "Reserved", n: capacity.reserved, tone: "text-violet-600" },
    { label: "Cleaning", n: capacity.cleaning, tone: "text-orange-600" },
    { label: "Maintenance", n: capacity.maintenance, tone: "text-gray-600" },
    { label: "Isolation", n: capacity.isolation, tone: "text-rose-600" },
    { label: "Expected vacancies", n: capacity.expectedVacancies, sub: "discharges due", tone: "text-teal-600" },
    { label: "Expected demand", n: capacity.expectedDemand, sub: "admissions expected", tone: "text-amber-600" },
  ];

  // F) Action bar — every control links to a real operational surface (no dead buttons).
  const WARD = "/supervisor/operations?section=ward";
  const actions: { label: string; href: string; primary?: boolean }[] = [
    { label: "Allocate Bed", href: WARD, primary: true },
    { label: "Move Patient", href: WARD },
    { label: "Request Cleaning", href: WARD },
    { label: "Reserve Bed", href: WARD },
    { label: "Block Bed", href: WARD },
    { label: "Bed Turnaround", href: WARD },
  ];

  const BedTile = ({ b }: { b: any }) => (
    <div className={`rounded-lg border p-3 ${BED_TONE[b.status] ?? "border-gray-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-900 truncate">{b.label}</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[b.status] ?? "bg-gray-300"}`} />
          {STATUS_LABEL[b.status] ?? titleCase(b.status)}
        </span>
      </div>
      <p className="text-[10px] text-gray-400 truncate mt-0.5">{[b.type ? titleCase(b.type) : null, b.department].filter(Boolean).join(" · ") || "—"}</p>
      {b.patient ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-700 truncate">{b.patient.label}</span>
            <span className="flex items-center gap-1 shrink-0">
              {b.patient.pews != null && <span className={`text-[10px] font-semibold tabular-nums ${ewsColor(b.patient.pews)}`}>PEWS {b.patient.pews}</span>}
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${STATE_TONE[b.patient.state] ?? "bg-gray-100 text-gray-600"}`}>{b.patient.state}</span>
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1 tabular-nums">Last obs {fmtTime(b.patient.lastObs)}</p>
        </>
      ) : (
        <p className="text-xs text-gray-500 mt-2">{STATUS_LABEL[b.status] ?? titleCase(b.status)}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* A) Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bed Management</h1>
        <p className="text-sm text-gray-500 mt-1">Manage beds &amp; capacity</p>
      </div>

      {/* B) Capacity summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={card + " py-4"}>
            <p className={`text-3xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-xs text-gray-500 mt-1">{k.label}</p>
            {k.sub && <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>}
          </div>
        ))}
        <div className={card + " py-4 flex flex-col justify-center"}>
          <div className="flex items-baseline justify-between"><span className="text-xs text-gray-500">Occupancy</span><span className="text-sm font-semibold tabular-nums text-gray-900">{capacity.occPct}%</span></div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mt-2"><div className={`h-full rounded-full ${capacity.occPct >= 90 ? "bg-red-500" : capacity.occPct >= 80 ? "bg-amber-500" : "bg-teal-500"}`} style={{ width: `${Math.min(capacity.occPct, 100)}%` }} /></div>
          <p className="text-[10px] text-gray-400 mt-1.5 tabular-nums">{capacity.occupied} / {capacity.total} occupied</p>
        </div>
      </div>

      {/* F) Actions bar */}
      <div className="flex flex-wrap gap-2">
        {actions.map(a => (
          <Link key={a.label} href={a.href}
            className={a.primary
              ? "text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2 transition-colors"
              : "text-sm font-medium bg-white border border-gray-200 text-teal-700 hover:border-teal-300 hover:bg-teal-50/40 rounded-lg px-3.5 py-2 transition-colors"}>
            {a.label}
          </Link>
        ))}
      </div>

      {/* C) Bed status board */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Bed status board</h2>
          <span className="text-xs text-gray-400 tabular-nums">{bedBoard.length} beds</span>
        </div>
        {bedBoard.length === 0 ? (
          <p className="text-sm text-gray-400">No beds registered for this ward.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
            {bedBoard.map((b: any) => <BedTile key={b.id} b={b} />)}
          </div>
        )}
        {/* G) Legend — text + colour, never colour alone */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-gray-100">
          {(["occupied", "available", "reserved", "cleaning", "out_of_service"] as const).map(s => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className={`w-2.5 h-2.5 rounded-sm ${STATUS_DOT[s]}`} />{STATUS_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* D) Bed turnaround */}
        <div className={card}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Bed turnaround</h2>
            <span className="text-xs text-gray-400 tabular-nums">{cleaningBeds.length} in turnaround</span>
          </div>
          {cleaningBeds.length === 0 ? (
            <p className="text-sm text-gray-400">No beds currently in turnaround.</p>
          ) : (
            <ul className="space-y-2">
              {cleaningBeds.map((b: any) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-orange-200 bg-orange-50/40 px-3 py-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-sm font-medium text-gray-800 truncate">{b.label}</span>
                    <span className="text-[11px] text-gray-400 truncate">{b.departments?.name ?? b.bed_type ? titleCase(b.departments?.name ?? b.bed_type ?? "") : ""}</span>
                  </span>
                  <span className="text-[11px] font-medium text-orange-700 shrink-0">In turnaround (cleaning)</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              The step-by-step turnaround timeline — discharge → vacated → cleaning → inspection → available, with per-step timestamps — activates with the bed-turnaround tracking module. Beds above are shown live from their current cleaning status.
            </p>
          </div>
        </div>

        {/* E) Demand & capacity */}
        <div className={card}>
          <h2 className="font-semibold text-gray-900 mb-3">Demand &amp; capacity</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3">
              <p className="text-2xl font-bold tabular-nums text-teal-700">{capacity.expectedVacancies}</p>
              <p className="text-xs text-gray-600 mt-1">Expected vacancies</p>
              <p className="text-[10px] text-gray-400">discharges due to free beds</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <p className="text-2xl font-bold tabular-nums text-amber-700">{capacity.expectedDemand}</p>
              <p className="text-xs text-gray-600 mt-1">Expected demand</p>
              <p className="text-[10px] text-gray-400">admissions expected in</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-gray-500">Free now</span><span className="font-semibold tabular-nums text-blue-600">{capacity.available}</span></div>
            <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-gray-500">Net position</span><span className={`font-semibold tabular-nums ${capacity.available + capacity.expectedVacancies - capacity.expectedDemand < 0 ? "text-red-600" : "text-green-600"}`}>{capacity.available + capacity.expectedVacancies - capacity.expectedDemand >= 0 ? "+" : ""}{capacity.available + capacity.expectedVacancies - capacity.expectedDemand}</span></div>
          </div>
          <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              The hourly occupancy forecast chart activates with the bed-turnaround tracking module. Figures above are the real current free count, expected discharges and expected admissions — the net position projects beds available once expected flow clears.
            </p>
          </div>
        </div>
      </div>

      {/* Cross-links */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
        <Link href="/supervisor/ward-map" className="text-teal-700 hover:underline">Ward map →</Link>
        <Link href="/supervisor/patient-flow" className="text-teal-700 hover:underline">Patient flow →</Link>
        <Link href="/supervisor/patient-list" className="text-teal-700 hover:underline">Patient list →</Link>
      </div>
    </div>
  );
}
