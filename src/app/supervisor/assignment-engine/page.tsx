import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadAssignmentContext, DEFAULT_WORKLOAD_BY_ACUITY, OVERLOAD_PCT } from "@/lib/hww/assignment-engine";

// Assignment & Workload Engine (HWW-AE-001) — the charge nurse's allocation
// tool: the live unit picture (who is on, who carries what load, which
// patients weigh what), one-click explainable recommendations, and the
// review → override → publish workflow. Deterministic and explainable by
// design — every proposal states its WHY; safety rules (competency clearance
// for high acuity, ratio caps) surface as coverage gaps, never silent
// placements. Runs persist to migration 155 as the decision record.
/* eslint-disable @typescript-eslint/no-explicit-any */

import ReviewBoard from "./ReviewBoard";
import { cardClass } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const card = cardClass;
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";
const STATUS_TONE: Record<string, string> = {
  generated: "bg-blue-100 text-blue-700", published: "bg-green-100 text-green-700",
  partially_published: "bg-amber-100 text-amber-700", discarded: "bg-gray-100 text-gray-400",
};

export default async function AssignmentEnginePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isSuperUser = roles.includes("super_admin");

  const ctx = await loadAssignmentContext(admin, profile?.hospital_id ?? null, isSuperUser);

  // Current per-nurse load from live assignments + patient weights.
  const weightOf = new Map(ctx.patients.map(p => [p.id, p.workloadPct]));
  const currentLoads = ctx.nurses.map(n => ({
    ...n,
    patients: n.currentPatients.length,
    load: Math.round(n.currentPatients.reduce((a, pid) => a + (weightOf.get(pid) ?? 0), 0) * 10) / 10,
  })).sort((a, b) => b.load - a.load);
  const unassigned = ctx.patients.filter(p => !p.currentNurse).length;
  const measured = ctx.patients.filter(p => p.workloadIsMeasured).length;

  // Latest runs (fail-soft pre-155).
  let runs: any[] = [];
  let migrationMissing = false;
  {
    let q = admin.from("op_assignment_recommendations").select("*").order("created_at", { ascending: false }).limit(6);
    if (!isSuperUser) q = q.eq("hospital_id", profile?.hospital_id ?? "00000000-0000-0000-0000-000000000000");
    const { data, error } = await q;
    if (error) migrationMissing = /does not exist|schema cache/i.test(error.message);
    else runs = data ?? [];
  }
  const latest = runs[0] ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assignment &amp; Workload Engine</h1>
        <p className="text-sm text-gray-500 mt-1">Explainable nurse-to-patient recommendations from live acuity, NAS workload, competency readiness, continuity and staffing ratios. You review, override and publish.</p>
      </div>

      {migrationMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="font-semibold text-amber-900">⚙️ Decision record not yet enabled</p>
          <p className="text-sm text-amber-800 mt-1">Apply migration <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">155-assignment-recommendations.sql</code> to persist recommendation runs. Generation still works — runs just are not recorded until then.</p>
        </div>
      )}

      {!ctx.shift ? (
        <div className={card}>
          <p className="font-semibold text-gray-800">No active shift.</p>
          <p className="text-sm text-gray-500 mt-1">The engine allocates for the ACTIVE shift&apos;s unit. Activate a shift in Shift Planning &amp; Activation, staff it, then generate.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            <div className={card}><p className="text-2xl font-bold tabular-nums text-gray-900">{ctx.nurses.length}</p><p className="text-xs text-gray-500 mt-0.5">nurses on {titleCase(ctx.shift.shift_type)} · {ctx.shift.unit ?? ctx.shift.department ?? "unit"}</p></div>
            <div className={card}><p className="text-2xl font-bold tabular-nums text-gray-900">{ctx.patients.length}</p><p className="text-xs text-gray-500 mt-0.5">patients{unassigned > 0 ? ` · ${unassigned} unassigned` : ""}</p></div>
            <div className={card}><p className="text-2xl font-bold tabular-nums text-gray-900">{measured}<span className="text-sm text-gray-400 font-normal">/{ctx.patients.length}</span></p><p className="text-xs text-gray-500 mt-0.5">measured workloads (rest estimated by acuity)</p></div>
            <div className={card}><p className="text-2xl font-bold tabular-nums text-gray-900">{ctx.maxPerNurse ?? "—"}</p><p className="text-xs text-gray-500 mt-0.5">ratio cap (patients/nurse){ctx.maxPerNurse == null ? " — no staffing standard set" : ""}</p></div>
            <div className={card}><p className="text-2xl font-bold tabular-nums text-gray-900">{ctx.nurses.filter(n => n.blocked).length}</p><p className="text-xs text-gray-500 mt-0.5">nurses competency-blocked (no high-acuity patients)</p></div>
          </div>

          <div className={card}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Current load by nurse (live assignments × patient weights)</p>
            {currentLoads.length === 0 ? <p className="text-sm text-gray-400">No nurse/charge staff present on the active shift.</p> : (
              <div className="space-y-2">
                {currentLoads.map(n => (
                  <div key={n.id} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-44 truncate">{n.name}{n.role === "charge" ? " (charge)" : ""}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${n.load > OVERLOAD_PCT ? "bg-red-500" : n.load > 80 ? "bg-orange-400" : "bg-teal-500"}`}
                        style={{ width: `${Math.min(100, n.load)}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-gray-500 w-24 text-right">{n.load}% · {n.patients} pt{n.patients === 1 ? "" : "s"}</span>
                    {n.blocked && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">blocked</span>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Weights: measured NAS/ward workload where recorded; otherwise by acuity ({Object.entries(DEFAULT_WORKLOAD_BY_ACUITY).map(([k, v]) => `${k} ${v}%`).join(" · ")}).</p>
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h3 className="font-semibold text-gray-900">🧠 Recommendation</h3>
              {latest && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_TONE[latest.status] ?? STATUS_TONE.generated}`}>{titleCase(latest.status)}</span>}
              {latest && <span className="text-xs text-gray-400">generated {fmtWhen(latest.created_at)} by {latest.generated_by_name ?? "—"}</span>}
            </div>
            {latest?.status === "generated" && (latest.gaps?.length > 0 || latest.risk_alerts?.length > 0) && (
              <div className="mb-3 space-y-1">
                {(latest.risk_alerts ?? []).map((a: any, i: number) => (
                  <p key={i} className={`text-sm ${a.severity === "high" ? "text-red-700" : "text-amber-700"}`}>⚠ {a.text}</p>
                ))}
                {(latest.gaps ?? []).map((g: any) => (
                  <p key={g.patient_id} className="text-sm text-red-700">⛔ {g.patient}: {g.reason}</p>
                ))}
              </div>
            )}
            <ReviewBoard run={latest?.status === "generated" ? latest : null} />
          </div>

          {runs.length > 1 && (
            <div className={card}>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Run history</p>
              <div className="divide-y divide-gray-50">
                {runs.slice(1).map((r: any) => (
                  <div key={r.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_TONE[r.status] ?? STATUS_TONE.generated}`}>{titleCase(r.status)}</span>
                    <span className="text-gray-600">{(r.proposals ?? []).length} proposals · {(r.gaps ?? []).length} gaps</span>
                    <span className="text-xs text-gray-400 ml-auto">{fmtWhen(r.created_at)} · {r.generated_by_name ?? "—"}{r.acted_at ? ` · decided ${fmtWhen(r.acted_at)}` : ""}</span>
                    {r.action_notes && <span className="text-xs text-gray-400 w-full pl-1">“{r.action_notes}”</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Hard rules: competency-blocked nurses never receive high/critical-acuity patients; ratio caps are never exceeded — unsafe allocations surface as coverage gaps to escalate, not silent placements. Published assignments are real op_patient_assignments with the full audit trail.
      </p>
    </div>
  );
}
