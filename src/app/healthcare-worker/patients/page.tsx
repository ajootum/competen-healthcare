import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMyPatientWorkspace } from "@/lib/hww/patients";
import { buildShiftCard } from "@/lib/hww/my-shift";
import { cnciTone, CNCI_BANDS } from "@/lib/hww/cnci";
import { acuityMaxFor } from "@/lib/hww/instruments";
import { card, titleCase, fmtWhen, AcuityChip, Chip, Empty, ewsColor } from "@/lib/hww/kit";

// My Patients (HWW-ARCH-002 S6 + HWW-UI-001) — the primary operational
// workspace: a persistent SHIFT SUMMARY RIBBON, assignment/priority filter
// tabs with search, compact enhanced patient cards (assignment tag, admitted
// time, priority banner, metric chips with a workload bar, and a clinical
// indicator strip), the CNCI priority view, and a one-click quick-action bar.
// Cards stay compact — the full detail is each patient's workspace, one click
// away. Every figure is a live operational record.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const W_BAR = (pct: number) => pct >= 100 ? "bg-red-500" : pct >= 70 ? "bg-orange-400" : pct >= 40 ? "bg-amber-400" : "bg-emerald-500";
const ASG_TAG: Record<string, string> = { primary: "bg-emerald-100 text-emerald-700", supporting: "bg-violet-100 text-violet-700" };

function IndicatorStrip({ ctx }: { ctx: any }) {
  const recorded = (types: string[] | null) => (ctx.observations ?? []).filter((o: any) => o.recorded_at && (!types || types.includes(o.observation_type))).length;
  const items = [
    { icon: "❤️", count: recorded(["vital_signs", "pews"]), title: "Recent observations available" },
    { icon: "💊", count: (ctx.medsOpen ?? []).filter((m: any) => ["due", "overdue", "delayed"].includes(m.effective_status)).length, title: "Medications scheduled or due", alert: true },
    { icon: "🫁", count: recorded(["respiratory"]), title: "Respiratory status assessments" },
    { icon: "🧠", count: recorded(["neuro", "gcs"]), title: "Neurological checks recorded" },
    { icon: "⚠️", count: (ctx.concerns ?? []).length, title: "Active concerns recorded", alert: true },
    { icon: "📋", count: (ctx.tasks ?? []).length, title: "Outstanding tasks for this patient", alert: true },
  ];
  return (
    <div className="flex items-center gap-3 pt-2 mt-2 border-t border-gray-100">
      {items.map((it, i) => (
        <span key={i} title={it.title} className={`relative text-base leading-none ${it.count === 0 ? "grayscale opacity-30" : ""}`}>
          {it.icon}
          {it.count > 0 && (
            <span className={`absolute -top-1.5 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full text-[8px] font-bold text-white flex items-center justify-center ${it.alert ? "bg-red-500" : "bg-gray-400"}`}>
              {it.count > 9 ? "9+" : it.count}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

function PatientCard({ a, ctx }: { a: any; ctx: any }) {
  const p = a.op_patients;
  const banner = p.acuity_level === "critical" || (ctx.escalations ?? []).some((e: any) => e.level >= 4)
    ? { cls: "bg-red-50 border-red-200 text-red-800", text: "Critical priority — active high-level clinical attention" }
    : p.acuity_level === "high" || (ctx.alerts ?? []).length > 0
      ? { cls: "bg-amber-50 border-amber-200 text-amber-800", text: "Elevated priority — monitor closely" }
      : { cls: "bg-green-50 border-green-200 text-green-800", text: "Stable — continue routine care" };
  const wl = ctx.workloadLatest != null ? Math.round(Number(ctx.workloadLatest.percentage)) : null;
  const acuityMax = acuityMaxFor(ctx.acuityLatest?.framework ?? "ward");

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/healthcare-worker/patients/${p.id}`} className="font-bold text-gray-900 hover:text-emerald-700">{p.label}</Link>
            <Chip tone={ASG_TAG[a.assignment_type] ?? ASG_TAG.supporting}>{a.assignment_type === "primary" ? "PRIMARY" : "SECONDARY"}</Chip>
            {ctx.cnci && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${cnciTone(ctx.cnci.band)}`}>
                {ctx.cnci.score}<span className="font-normal">{titleCase(ctx.cnci.band)}</span>
              </span>
            )}
            {p.isolation_status !== "none" && <Chip tone="bg-purple-100 text-purple-700">{titleCase(p.isolation_status)}</Chip>}
            {ctx.reassess?.due && <Chip tone="bg-orange-100 text-orange-700">Reassess</Chip>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {p.age_years != null ? `${p.age_years} yrs` : "Age n/a"}{p.diagnosis ? ` · ${p.diagnosis}` : ""}{p.consultant ? ` · ${p.consultant}` : ""}{p.op_beds?.label ? ` · ${p.op_beds.label}` : ""}
          </p>
        </div>
        <span className="text-[10px] text-gray-400 shrink-0 text-right">Admitted<br />{fmtWhen(p.created_at)}</span>
      </div>

      <div className={`mt-2 border rounded-lg px-3 py-1.5 text-xs ${banner.cls}`}>{banner.text}</div>

      <div className="grid grid-cols-4 gap-2 mt-2.5">
        <div className="bg-gray-50 rounded-lg py-1.5 text-center">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">PEWS</p>
          <p className={`text-base font-bold tabular-nums ${ewsColor(ctx.pews)}`}>{ctx.pews ?? "—"}</p>
        </div>
        <div className="bg-gray-50 rounded-lg py-1.5 text-center">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Acuity</p>
          <p className="text-xs font-semibold mt-0.5"><AcuityChip level={p.acuity_level} /></p>
          {ctx.acuityLatest && <p className="text-[9px] text-gray-400 tabular-nums">{ctx.acuityLatest.score}/{acuityMax}</p>}
        </div>
        <div className="bg-gray-50 rounded-lg py-1.5 text-center px-1.5">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Workload</p>
          <p className="text-base font-bold tabular-nums text-gray-900">{wl != null ? `${wl}%` : "—"}</p>
          {wl != null && (
            <div className="h-1 rounded-full bg-gray-200 overflow-hidden mt-0.5">
              <div className={`h-full rounded-full ${W_BAR(wl)}`} style={{ width: `${Math.min(100, wl)}%` }} />
            </div>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg py-1.5 text-center">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Tasks</p>
          <p className={`text-base font-bold tabular-nums ${(ctx.tasks ?? []).length > 0 ? "text-gray-900" : "text-gray-300"}`}>{(ctx.tasks ?? []).length}</p>
        </div>
      </div>

      <IndicatorStrip ctx={ctx} />
    </div>
  );
}

const QUICK_ACTIONS = [
  { icon: "📈", label: "Record Observations", href: "/healthcare-worker/observations" },
  { icon: "💊", label: "Medication Administration", href: "/healthcare-worker/medications" },
  { icon: "🌡️", label: "Clinical Assessment", href: "/healthcare-worker/acuity" },
  { icon: "⚖️", label: "Workload", href: "/healthcare-worker/workload" },
  { icon: "⚠️", label: "Record Concern", href: "/healthcare-worker/concerns" },
  { icon: "🔄", label: "Handover", href: "/healthcare-worker/handover" },
];

export default async function MyPatientsPage({ searchParams }: { searchParams: Promise<{ view?: string; filter?: string; q?: string }> }) {
  const { view, filter, q } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();

  const [{ patients, byPatient }, unreadRes, shiftRes] = await Promise.all([
    loadMyPatientWorkspace(admin, user.id),
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
    admin.from("op_shift_staff")
      .select("op_shifts!shift_id(shift_type, status, starts_at, ends_at, units!unit_id(name), departments!department_id(name))")
      .eq("staff_id", user.id).limit(20),
  ]);
  const activeShift = ((shiftRes.data ?? []) as any[]).map(d => d.op_shifts).find((s: any) => s?.status === "active") ?? null;
  const shiftCard = buildShiftCard(activeShift);
  const unread = unreadRes.error ? 0 : unreadRes.count ?? 0;

  // Ribbon aggregates from the loaded per-patient contexts (all real rows).
  const ctxOf = (a: any) => byPatient.get(a.op_patients.id) ?? {};
  const ribbon = {
    patients: patients.length,
    highAcuity: patients.filter((a: any) => ["high", "critical"].includes(a.op_patients.acuity_level)).length,
    medsDue: patients.reduce((n: number, a: any) => n + (ctxOf(a).medsOpen ?? []).filter((m: any) => ["due", "overdue", "delayed"].includes(m.effective_status)).length, 0),
    tasks: patients.reduce((n: number, a: any) => n + (ctxOf(a).tasks ?? []).length, 0),
    escalations: patients.reduce((n: number, a: any) => n + (ctxOf(a).escalations ?? []).length, 0),
    unread,
  };

  // Filter tabs + search, then CNCI ranking.
  const activeFilter = ["primary", "secondary", "high"].includes(filter ?? "") ? filter! : "all";
  const needle = String(q ?? "").trim().toLowerCase();
  const filtered = patients.filter((a: any) => {
    const p = a.op_patients;
    if (activeFilter === "primary" && a.assignment_type !== "primary") return false;
    if (activeFilter === "secondary" && a.assignment_type === "primary") return false;
    if (activeFilter === "high" && !["high", "critical"].includes(p.acuity_level)) return false;
    if (needle && !`${p.label} ${p.diagnosis ?? ""} ${p.op_beds?.label ?? ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const ranked = [...filtered].sort((a: any, b: any) => (ctxOf(b).cnci?.score ?? 0) - (ctxOf(a).cnci?.score ?? 0));
  const priorityView = view === "priority";

  const counts = {
    all: patients.length,
    primary: patients.filter((a: any) => a.assignment_type === "primary").length,
    secondary: patients.filter((a: any) => a.assignment_type !== "primary").length,
    high: patients.filter((a: any) => ["high", "critical"].includes(a.op_patients.acuity_level)).length,
  };
  const tabHref = (f: string) => `/healthcare-worker/patients?${new URLSearchParams({ ...(priorityView ? { view: "priority" } : {}), ...(f !== "all" ? { filter: f } : {}), ...(needle ? { q: needle } : {}) }).toString()}`;
  const tab = (f: string, label: string, n: number) => (
    <Link key={f} href={tabHref(f)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium ${activeFilter === f ? "bg-emerald-600 text-white" : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
      {label} ({n})
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Patients</h1>
          <p className="text-sm text-gray-500 mt-1">Your primary operational workspace — CNCI drives the order; open any patient for their full workspace.</p>
        </div>
        <div className="flex gap-1.5 self-center">
          <Link href={`/healthcare-worker/patients${activeFilter !== "all" ? `?filter=${activeFilter}` : ""}`} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!priorityView ? "bg-emerald-600 text-white" : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>List view</Link>
          <Link href={`/healthcare-worker/patients?view=priority${activeFilter !== "all" ? `&filter=${activeFilter}` : ""}`} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${priorityView ? "bg-emerald-600 text-white" : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>Priority view</Link>
        </div>
      </div>

      {/* Shift summary ribbon (UI-001) */}
      <div className={`${card} py-3`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="pr-4 border-r border-gray-100">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Today&apos;s Shift</p>
            <p className="text-sm font-semibold text-gray-800">{shiftCard ? `${shiftCard.ward ?? "Unit"} · ${shiftCard.window}` : "Not deployed"}</p>
          </div>
          {[
            { icon: "🧑‍⚕️", label: "Patients", value: ribbon.patients, tone: "" },
            { icon: "🌡️", label: "High Acuity", value: ribbon.highAcuity, tone: ribbon.highAcuity ? "text-red-600" : "" },
            { icon: "💊", label: "Medications Due", value: ribbon.medsDue, tone: ribbon.medsDue ? "text-orange-600" : "" },
            { icon: "✅", label: "Tasks Outstanding", value: ribbon.tasks, tone: "" },
            { icon: "🚨", label: "Escalations", value: ribbon.escalations, tone: ribbon.escalations ? "text-red-600" : "" },
            { icon: "💬", label: "New Messages", value: ribbon.unread, tone: "" },
          ].map(m => (
            <div key={m.label} className="flex items-center gap-2">
              <span className="text-base">{m.icon}</span>
              <div>
                <p className={`text-lg font-bold tabular-nums leading-tight ${m.tone || "text-gray-900"}`}>{m.value}</p>
                <p className="text-[9px] text-gray-400 uppercase tracking-wide leading-tight">{m.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter tabs + search */}
      <div className="flex flex-wrap items-center gap-2">
        {tab("all", "All Patients", counts.all)}
        {tab("primary", "Primary", counts.primary)}
        {tab("secondary", "Secondary", counts.secondary)}
        {tab("high", "High Acuity", counts.high)}
        <form className="ml-auto flex gap-1.5" action="/healthcare-worker/patients" method="GET">
          {priorityView && <input type="hidden" name="view" value="priority" />}
          {activeFilter !== "all" && <input type="hidden" name="filter" value={activeFilter} />}
          <input name="q" defaultValue={needle} placeholder="Search patients…"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
          <button className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs text-gray-600 hover:bg-gray-50">Search</button>
        </form>
      </div>

      {patients.length === 0 ? (
        <div className={card}><Empty>No active patient assignments. Accepted assignments appear here; offers wait in your Assignment Inbox.</Empty></div>
      ) : ranked.length === 0 ? (
        <div className={card}><Empty>No patients match this filter{needle ? ` and search “${needle}”` : ""}.</Empty></div>
      ) : priorityView ? (
        <div className="space-y-4">
          {CNCI_BANDS.map(band => {
            const group = ranked.filter((a: any) => ctxOf(a).cnci?.band === band.key);
            if (!group.length) return null;
            return (
              <div key={band.key} className={card}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${band.tone}`}>{band.label}</span>
                  <span className="text-xs text-gray-400">{group.length} patient{group.length === 1 ? "" : "s"} · CNCI {band.min}+</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {group.map((a: any) => {
                    const p = a.op_patients; const ctx = ctxOf(a);
                    return (
                      <div key={p.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                        <span className={`font-bold tabular-nums w-8 ${band.dot}`}>{ctx.cnci?.score ?? "—"}</span>
                        <Link href={`/healthcare-worker/patients/${p.id}`} className="font-medium text-gray-800 hover:text-emerald-700">{p.op_beds?.label ? `${p.op_beds.label} · ` : ""}{p.label}</Link>
                        <Chip tone={ASG_TAG[a.assignment_type] ?? ASG_TAG.supporting}>{a.assignment_type === "primary" ? "PRIMARY" : "SECONDARY"}</Chip>
                        <AcuityChip level={p.acuity_level} />
                        {ctx.pews != null && <span className={`text-xs font-semibold tabular-nums ${ewsColor(ctx.pews)}`}>PEWS {ctx.pews}</span>}
                        {ctx.reassess?.due && <Chip tone="bg-orange-100 text-orange-700">Reassess</Chip>}
                        <span className="ml-auto text-[11px] text-gray-400">{(ctx.cnci?.drivers ?? []).slice(0, 2).join(" · ")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {ranked.map((a: any) => <PatientCard key={a.op_patients.id} a={a} ctx={ctxOf(a)} />)}
        </div>
      )}

      {/* Quick action bar (UI-001: common actions within one click) */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 pr-2">Quick Actions</span>
          {QUICK_ACTIONS.map(qa => (
            <Link key={qa.label} href={qa.href}
              className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/40 py-2.5 px-3 text-center transition-colors min-w-[92px]">
              <span className="text-lg">{qa.icon}</span>
              <span className="text-[10px] text-gray-600 leading-tight">{qa.label}</span>
            </Link>
          ))}
          <span className="text-[10px] text-gray-400 ml-auto max-w-[180px]">Transfer and discharge live inside each patient&apos;s workspace.</span>
        </div>
      </div>

      {/* Indicators legend */}
      <div className={`${card} py-3`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[11px] text-gray-500">
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Indicators</span>
          <span>❤️ Recent observations</span>
          <span>💊 Medications scheduled / due</span>
          <span>🫁 Respiratory assessments</span>
          <span>🧠 Neurological checks</span>
          <span>⚠️ Active concerns</span>
          <span>📋 Outstanding tasks</span>
          <span className="text-gray-400">· Green stable · Amber monitor · Red urgent · Purple isolation</span>
        </div>
      </div>
    </div>
  );
}
