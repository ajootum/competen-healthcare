import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftCommand, fmtTime } from "@/lib/operations/shift-command";

export const dynamic = "force-dynamic";

// Shift Timeline (Shift Command SS §3) — the operational schedule for the shift.
// Built from the Director-of-Nursing round schedule (op_round_schedule) + real
// shift milestones (start, handover, escalations, end). Per-round EXECUTION
// status (in-progress / delayed / completed), checklists and the Gantt lane view
// need a round-execution tracking table that doesn't exist yet — surfaced as an
// honest callout rather than fabricated statuses.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const hm = (h: number | null) => h == null ? "—" : `${Math.max(0, Math.floor(h))}h ${Math.max(0, Math.round((h % 1) * 60))}m`;

export default async function ShiftTimeline() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const sc = await loadShiftCommand(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  if (!sc.ready) return (
    <div className="space-y-4"><h1 className="text-2xl font-bold text-gray-900">Shift Timeline</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet.</p></div></div>
  );
  const { shift, rounds, timelineEvents, copilot } = sc;

  // Merge planned rounds + real milestones onto one clock-time axis.
  type Item = { hm: string; label: string; kind: "round" | "event"; done: boolean };
  const items: Item[] = [
    ...rounds.map((r: any) => ({ hm: r.at_time, label: r.label, kind: "round" as const, done: false })),
    ...timelineEvents.map((e: any) => ({ hm: fmtTime(e.at), label: e.label, kind: "event" as const, done: e.done })),
  ].sort((a, b) => a.hm.localeCompare(b.hm));

  const elapsed = shift?.elapsedH ?? null, remaining = shift?.remainingH ?? null;
  const progress = (elapsed != null && remaining != null && elapsed + remaining > 0) ? Math.round((elapsed / (elapsed + remaining)) * 100) : null;
  const doneEvents = timelineEvents.filter((e: any) => e.done).length;

  const summary = [
    { label: "Scheduled", n: rounds.length, tone: "text-gray-900" },
    { label: "Milestones logged", n: doneEvents, tone: "text-teal-600" },
    { label: "Shift elapsed", n: hm(elapsed), tone: "text-gray-900" },
    { label: "Remaining", n: hm(remaining), tone: "text-gray-900" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Timeline</h1>
          <p className="text-sm text-gray-500 mt-1">Operational schedule &amp; execution</p>
        </div>
        {progress != null && (
          <div className="text-right">
            <p className="text-2xl font-bold text-teal-600 tabular-nums">{progress}%</p>
            <p className="text-[11px] text-gray-400">Shift progress</p>
          </div>
        )}
      </div>

      {progress != null && <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${progress}%` }} /></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.map(s => <div key={s.label} className={card + " py-4"}><p className={`text-2xl font-bold tabular-nums ${s.tone}`}>{s.n}</p><p className="text-xs text-gray-500 mt-1">{s.label}</p></div>)}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Timeline */}
        <div className={`${card} lg:col-span-2`}>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">🕑 Schedule &amp; milestones</h3>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400">No rounds scheduled. Set the ward&apos;s round schedule in <Link href="/supervisor/settings" className="text-teal-700 hover:underline">Ward Configuration</Link>.</p>
          ) : (
            <ol className="relative border-l border-gray-200 ml-3 space-y-4">
              {items.map((e, i) => (
                <li key={i} className="ml-5">
                  <span className={`absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 border-white ${e.kind === "round" ? "bg-teal-300" : e.done ? "bg-teal-500" : "bg-gray-300"}`} />
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-gray-700 w-12">{e.hm}</span>
                    <span className={`text-sm ${e.kind === "round" ? "text-gray-700" : e.done ? "text-gray-800 font-medium" : "text-gray-400"}`}>{e.label}</span>
                    {e.kind === "round" ? <span className="text-[9px] uppercase tracking-wide text-teal-500/70">round</span> : e.done && <span className="text-[9px] uppercase tracking-wide text-green-600">logged</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11px] text-gray-400 mt-4 pt-3 border-t border-gray-100">Rounds come from the ward round schedule; milestones are real shift events. Live per-round status (in progress / delayed / completed), checklists and the team Gantt view arrive with the round-execution tracking module.</p>
        </div>

        {/* Predictive insights + delays */}
        <div className="space-y-5">
          <div className={card}>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">🔮 Predictive Insights <span className="text-[10px] font-normal text-gray-400">rule-based</span></h3>
            <div className="space-y-1.5">
              {copilot.length === 0 && <p className="text-sm text-gray-400">No workload or capacity risks flagged.</p>}
              {copilot.slice(0, 5).map((c: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-teal-500 mt-0.5">›</span>
                  <span className="text-gray-700 flex-1">{c.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">⏱️ Delay Detection</h3>
            <p className="text-sm text-gray-500">Automatic delay alerts (ward round overdue, medication round incomplete, break rotation behind) activate once rounds report execution status. Configure the schedule in <Link href="/supervisor/settings" className="text-teal-700 hover:underline">Ward Configuration</Link>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
