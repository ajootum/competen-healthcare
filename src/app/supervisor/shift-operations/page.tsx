import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftOpsEngine } from "@/lib/operations/shift-ops-engine";
import ShiftLifecycle from "./ShiftLifecycle";
import ReadinessChecklist from "./ReadinessChecklist";
import SupervisorPanel from "./SupervisorPanel";
import SafetyHuddlePanel from "./SafetyHuddlePanel";
import ShiftDecisionsPanel from "./ShiftDecisionsPanel";

export const dynamic = "force-dynamic";

// Shift Operations Engine (SSW-002) — the operational backbone view for the Shift
// Supervisor Workspace. Renders the shift-lifecycle state machine (with a real
// advance action), all 10 architecture engines mapped to their live backing, the
// domain event flow from the audit trail, and the deployment roadmap. Engines
// without a data source render as honest states, never fabricated numbers.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const titleCase = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());

const STATUS_BADGE: Record<string, { label: string; cls: string; dot: string }> = {
  live: { label: "Live", cls: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-500" },
  partial: { label: "Partial", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  config: { label: "Awaiting", cls: "bg-gray-100 text-gray-500 border-gray-200", dot: "bg-gray-400" },
};
const ENGINE_TONE = ["bg-blue-100 text-blue-700", "bg-teal-100 text-teal-700", "bg-violet-100 text-violet-700", "bg-orange-100 text-orange-700", "bg-green-100 text-green-700", "bg-rose-100 text-rose-700", "bg-cyan-100 text-cyan-700", "bg-fuchsia-100 text-fuchsia-700", "bg-amber-100 text-amber-700", "bg-slate-200 text-slate-700"];

export default async function ShiftOperationsEngine() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadShiftOpsEngine(admin, hid, isSuper);

  if (!d.ready) {
    return (
      <div className="space-y-4">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Operations Engine</h1><p className="text-sm text-gray-500">SSW-002 — the operational backbone of the Shift Supervisor Workspace.</p></div>
        <div className={`${card} p-8 text-center`}><p className="text-3xl mb-2">🗄️</p><p className="text-sm font-medium text-gray-700">Operational engine not provisioned</p><p className="text-xs text-gray-400 mt-1">The Clinical Operations tables (op_*) are not available for this workspace yet.</p></div>
      </div>
    );
  }

  const s = d.shift, lc = d.lifecycle, ct = d.counts;

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Shift Operations Engine</h1>
          <p className="text-sm text-gray-500">SSW-002 — the event-driven backbone powering every operational activity in the shift.</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-semibold text-gray-700">{s ? `${titleCase(s.shift_type)} · ${s.unit}` : "No active shift"}</p>
          <p className="text-[11px] text-gray-400">{s?.supervisor ? `Supervisor: ${s.supervisor}` : "Unassigned"} · <span className="text-green-600 font-medium">{d.liveCount}/10 engines live</span></p>
        </div>
      </div>

      {/* Lifecycle state machine + readiness-gated advance action */}
      <ShiftLifecycle states={lc.states} index={lc.index} subState={lc.subState} shiftStatus={lc.shiftStatus} gate={d.gate} command={d.command} shiftId={d.shiftId} />

      {/* Command assignment + pre-shift readiness (both gate activation) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SupervisorPanel shiftId={d.shiftId} provisioned={d.supervisors?.provisioned !== false}
          assignments={d.supervisors?.assignments ?? []} staff={d.supervisors?.staff ?? []}
          editable={lc.shiftStatus !== "completed"} />
        <ReadinessChecklist shiftId={d.shiftId} provisioned={d.readiness?.provisioned !== false}
          items={d.readiness?.items ?? []} mandatoryComplete={d.readiness?.mandatoryComplete ?? 0}
          mandatoryTotal={d.readiness?.mandatoryTotal ?? 0} editable={lc.shiftStatus === "planned"} />
      </div>

      {/* Operational records — safety huddle + material decisions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SafetyHuddlePanel shiftId={d.shiftId} provisioned={d.huddle?.provisioned !== false}
          huddle={d.huddle?.huddle ?? null} editable={lc.shiftStatus !== "completed"} />
        <ShiftDecisionsPanel shiftId={d.shiftId} provisioned={d.decisions?.provisioned !== false}
          decisions={d.decisions?.decisions ?? []} editable={lc.shiftStatus !== "completed"} />
      </div>

      {/* At-a-glance operational band (SSW-002) */}
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
        {[["Active Shifts", ct.activeShifts], ["Command Owners", ct.commandOwners], ["Critical", ct.critical, ct.critical > 0 ? "text-rose-600" : ""], ["Overdue Tasks", ct.overdueTasks, ct.overdueTasks > 0 ? "text-rose-600" : ""], ["Occupancy", ct.occPct == null ? "—" : `${ct.occPct}%`], ["On Duty", `${ct.present}/${ct.rostered}`], ["Escalations", ct.escalations, ct.escalations > 0 ? "text-amber-600" : ""], ["State", lc.current]].map(([l, v, tone]: any) => (
        <div key={l} className={`${card} p-3 text-center`}><p className={`text-lg font-bold tabular-nums truncate ${tone ?? "text-gray-900"}`}>{v}</p><p className="text-[9px] text-gray-500 uppercase tracking-wide truncate">{l}</p></div>
        ))}
      </div>

      {/* The 10 engines */}
      <div>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Engine Services</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          {d.engines.map((e: any) => {
            const badge = STATUS_BADGE[e.status];
            return (
              <Link key={e.n} href={e.href} className={`${card} p-4 hover:border-teal-300 hover:shadow-sm transition-all group`}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${ENGINE_TONE[e.n - 1]}`}>{e.n}</span>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${badge.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />{badge.label}</span>
                </div>
                <h3 className="text-[13px] font-bold text-gray-900 leading-tight group-hover:text-teal-700">{e.name}</h3>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight mb-2.5 min-h-[24px]">{e.desc}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {e.metrics.map((m: any, i: number) => (
                    <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 p-1.5 text-center">
                      <p className="text-[13px] font-bold text-gray-900 tabular-nums truncate">{m.value == null ? "—" : m.value}</p>
                      <p className="text-[8px] text-gray-500 uppercase tracking-wide truncate">{m.label}</p>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Domain event flow */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center text-sm">⚡</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Domain Event Flow</h2><p className="text-[10px] text-gray-500">Real operational events on the shift, from the audit trail</p></div>
          </div>
          {d.eventFlow.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">No recognised domain events in the recent audit trail.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {d.eventFlow.map((ev: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 py-2">
                  <span className="text-[10px] font-mono font-semibold text-cyan-700 bg-cyan-50 border border-cyan-100 rounded px-1.5 py-0.5 shrink-0">{ev.event}</span>
                  <span className="text-xs text-gray-700 flex-1 truncate">{ev.entity ?? titleCase(ev.raw ?? "")}{ev.actor ? ` · ${ev.actor}` : ""}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(ev.at)}</span>
                </div>
              ))}
            </div>
          )}
          {d.copilot.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Operational Intelligence — recommendations (human-approved)</p>
              <div className="space-y-1">
                {d.copilot.slice(0, 3).map((c: any, i: number) => (
                  <Link key={i} href={c.href} className="flex items-center gap-2 text-xs rounded-lg border border-gray-100 p-2 hover:border-teal-200">
                    <span className="text-gray-700 flex-1">{c.text}</span>
                    <span className="text-[10px] font-semibold text-teal-700 shrink-0">{c.action} →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Deployment roadmap + principles */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center text-sm">🗺️</span>
            <div><h2 className="text-sm font-bold text-gray-900 leading-tight">Deployment Roadmap</h2><p className="text-[10px] text-gray-500">Engine build phases (SSW-002 Ch.17)</p></div>
          </div>
          <div className="space-y-1.5 mb-4">
            {d.roadmap.map((r: any) => (
              <div key={r.phase} className="flex items-center gap-2 text-xs">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${r.done ? "bg-green-500 text-white" : "bg-gray-200 text-gray-400"}`}>{r.done ? "✓" : r.phase}</span>
                <span className={`flex-1 ${r.done ? "text-gray-700" : "text-gray-400"}`}>Phase {r.phase} · {r.label}</span>
                {!r.done && <span className="text-[9px] text-gray-400 shrink-0">planned</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Key principles</p>
          <div className="flex flex-wrap gap-1.5">
            {d.principles.map((p: string) => (
              <span key={p} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">{p}</span>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Shift Operations Engine (SSW-002) is the operational backbone of the Shift Supervisor Workspace — ten event-driven services over a single operational source of truth. Every figure here is live: the lifecycle state is derived from the real op_shifts status with escalation/handover overlays, engine metrics read the op_*/audit domain, and the event flow maps real audit records onto the specification's domain events. The lifecycle advance action drives an audited op_shifts transition. Engines without a hospital-scoped data source (a communications volume metric, enterprise report export) are shown as honest states rather than fabricated numbers.</p>
    </div>
  );
}
