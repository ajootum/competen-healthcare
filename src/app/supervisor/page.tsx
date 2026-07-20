import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

export const dynamic = "force-dynamic";

// Shift Supervisor Dashboard (SSW-001 Phase 2) — the live operational picture
// for the shift, assembled from the Clinical Operations Engine (op_*) data.
/* eslint-disable @typescript-eslint/no-explicit-any */

const pretty = (s: string) => (s ?? "").replace(/_/g, " ");
const ACUITY = ["critical", "high", "moderate", "stable"];
const ACUITY_COLOR: Record<string, string> = { stable: "text-green-600", moderate: "text-yellow-600", high: "text-orange-600", critical: "text-red-600" };
const card = "bg-white rounded-xl border border-gray-200 p-5";

function Stat({ n, label, tone, href }: { n: any; label: string; tone?: string; href?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function SupervisorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { ready, data } = await loadOpsConsoleData(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  if (!ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Shift Dashboard</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ Coming online</p>
          <p className="text-sm text-amber-800 mt-2">The Clinical Operations Engine tables aren&apos;t provisioned yet (migrations 038 &amp; 039). Once applied, this dashboard fills with your live shift data.</p>
        </div>
      </div>
    );
  }

  const { shifts, shiftStaff, beds, patients, escalations, tasks, observations } = data;
  const { data: notifs } = await admin.from("notifications").select("type, title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6);

  // ── Widget aggregates
  const census = patients.length;
  const acuityCount = (a: string) => patients.filter((p: any) => p.acuity_level === a).length;
  const highRisk = patients.filter((p: any) => p.acuity_level === "high" || p.acuity_level === "critical");
  const activeShiftIds = new Set(shifts.filter((s: any) => s.status === "active").map((s: any) => s.id));
  // Only genuinely-present staff count toward staffing (exclude off_duty/absent).
  const onDuty = shiftStaff.filter((s: any) => activeShiftIds.has(s.shift_id) && ["on_duty", "confirmed", "assigned"].includes(s.status));
  const roleMix = onDuty.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
  const ratio = census && onDuty.length ? (census / onDuty.length).toFixed(1) : "—";
  const openTasks = tasks;
  const taskByPriority = (p: string) => openTasks.filter((t: any) => t.priority === p).length;
  const adt = (s: string) => patients.filter((p: any) => p.operational_status === s).length;
  const pews = escalations.filter((e: any) => e.escalation_type === "clinical_deterioration");
  const recentObs = observations.filter((o: any) => o.status === "recorded").slice(0, 6);
  const totalBeds = beds.length, occupied = beds.filter((b: any) => b.status === "occupied").length, available = beds.filter((b: any) => b.status === "available").length;
  const occPct = totalBeds ? Math.round((occupied / totalBeds) * 100) : 0;
  const l45 = escalations.filter((e: any) => e.level >= 4).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Shift Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Live operational command centre for your shift · {profile?.full_name}</p>
      </div>

      {/* Top stat row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat n={census} label="Patients on the ward" href="/supervisor/operations?section=ward" />
        <Stat n={highRisk.length} label="High-risk patients" tone={highRisk.length ? "text-orange-600" : undefined} href="/supervisor/operations?section=ward" />
        <Stat n={pews.length} label="PEWS / deterioration alerts" tone={pews.length ? "text-red-600" : undefined} href="/supervisor/operations?section=safety" />
        <Stat n={onDuty.length} label="Staff on duty" href="/supervisor/operations?section=shifts" />
        <Stat n={openTasks.length} label="Pending tasks" tone={taskByPriority("urgent") ? "text-red-600" : undefined} href="/supervisor/operations?section=care" />
        <Stat n={escalations.length} label="Open escalations" tone={l45 ? "text-red-600" : undefined} href="/supervisor/operations?section=safety" />
        <Stat n={`${occPct}%`} label={`Bed occupancy (${occupied}/${totalBeds})`} tone={occPct >= 90 ? "text-red-600" : occPct >= 75 ? "text-orange-600" : "text-green-600"} href="/supervisor/operations?section=ward" />
        <Stat n={available} label="Beds available" tone="text-green-600" href="/supervisor/operations?section=ward" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* PEWS / deterioration */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">PEWS &amp; deterioration alerts</h3>
          {pews.length === 0 && <p className="text-sm text-gray-400">No active deterioration escalations.</p>}
          <div className="space-y-1.5">
            {pews.slice(0, 6).map((e: any) => (
              <div key={e.id} className="flex items-center gap-2 text-sm">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${e.level >= 4 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>L{e.level}</span>
                <span className="text-gray-800 truncate">{e.summary}</span>
              </div>
            ))}
          </div>
        </div>

        {/* High-risk patients */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">High-risk patients ({highRisk.length})</h3>
          {highRisk.length === 0 && <p className="text-sm text-gray-400">No high or critical acuity patients.</p>}
          <div className="space-y-1.5">
            {highRisk.slice(0, 6).map((p: any) => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${ACUITY_COLOR[p.acuity_level]}`}>●</span>
                <span className="text-gray-800">{p.label}</span>
                <span className="text-xs text-gray-400">{p.op_beds?.label ?? "no bed"}{p.isolation_status !== "none" ? ` · ${p.isolation_status}` : ""}</span>
                <span className={`ml-auto text-xs ${ACUITY_COLOR[p.acuity_level]}`}>{p.acuity_level}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Staffing & skill mix */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Staffing &amp; skill mix</h3>
          {onDuty.length === 0 && <p className="text-sm text-gray-400">No staff deployed on an active shift yet.</p>}
          {onDuty.length > 0 && (
            <>
              <p className="text-sm text-gray-600 mb-2">{onDuty.length} on duty · <span className="font-medium">{ratio}</span> patients / staff</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(roleMix).map(([r, n]) => (
                  <span key={r} className="text-xs bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2.5 py-1">{pretty(r)}: <b>{n as number}</b></span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Patient flow (ADT) */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Patient flow</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Expected admissions</span><b className="tabular-nums">{adt("expected")}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Admitted</span><b className="tabular-nums">{adt("admitted")}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Transfer pending</span><b className="tabular-nums">{adt("transfer_pending")}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Discharge pending</span><b className="tabular-nums">{adt("discharge_pending")}</b></div>
          </div>
          <div className="mt-3 pt-3 border-t flex gap-4 text-xs text-gray-500">
            {ACUITY.map(a => <span key={a}>{pretty(a)}: <b className={ACUITY_COLOR[a]}>{acuityCount(a)}</b></span>)}
          </div>
        </div>

        {/* Pending tasks */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Pending tasks ({openTasks.length})</h3>
          <div className="flex gap-3 text-xs mb-3">
            {["urgent", "high", "normal", "low"].map(p => <span key={p} className="text-gray-500">{p}: <b className={p === "urgent" ? "text-red-600" : p === "high" ? "text-orange-600" : "text-gray-800"}>{taskByPriority(p)}</b></span>)}
          </div>
          <div className="space-y-1.5">
            {openTasks.slice(0, 5).map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.priority === "urgent" ? "bg-red-100 text-red-700" : t.priority === "high" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"}`}>{t.priority}</span>
                <span className="text-gray-800 truncate">{t.description}</span>
                <span className="ml-auto text-xs text-gray-400">{t.profiles?.full_name ?? ""}</span>
              </div>
            ))}
            {openTasks.length === 0 && <p className="text-sm text-gray-400">No open tasks.</p>}
          </div>
        </div>

        {/* Recent observations */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Recent observations</h3>
          {recentObs.length === 0 && <p className="text-sm text-gray-400">No observations recorded yet.</p>}
          <div className="space-y-1.5">
            {recentObs.map((o: any) => (
              <div key={o.id} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700">{o.op_patients?.label ?? "—"}</span>
                <span className="text-xs text-gray-400">{pretty(o.observation_type)}</span>
                {o.ews_score != null && <span className={`font-medium ${o.ews_score >= 5 ? "text-orange-600" : "text-gray-600"}`}>EWS {o.ews_score}</span>}
                {o.escalation_triggered && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">escalated</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Notifications */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Notifications</h3>
          {(notifs ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing new.</p>}
          <div className="space-y-1.5">
            {(notifs ?? []).map((n: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-800 truncate">{n.title}</span>
                <span className="ml-auto text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI recommendations — later phase */}
        <div className={`${card} border-dashed`}>
          <h3 className="font-semibold text-gray-900 mb-1">AI recommendations</h3>
          <p className="text-sm text-gray-400">Operational AI (safe-staffing, workload &amp; capacity recommendations) arrives in a later SSW phase. The data feeding it — staffing, acuity, escalations — is already live above.</p>
        </div>
      </div>
    </div>
  );
}
