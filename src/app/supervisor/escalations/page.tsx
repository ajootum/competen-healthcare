import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEscalations } from "@/lib/operations/escalations-workspace";
import EscalationActions from "./EscalationActions";

// Clinical Escalation Centre (SSW-CCR-003) — the supervisor's escalation
// command surface. Until now the sidebar BADGED escalations in two groups and
// had no page at all, deep-linking into the admin console; the read model
// (loadEscalations) was fully written and unused. This renders it: the
// priority board with SLA response timers from op_escalations.response_deadline,
// the deterioration watch that feeds escalations, the shift's response team,
// outcomes and the 6-step workflow — with the real acknowledge/assign/
// escalate/resolve write path attached to every row.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = "bg-white rounded-xl border border-gray-200 p-5";
const label = "text-[11px] font-semibold text-gray-400 uppercase tracking-wider";
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const fmtWhen = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";
const BUCKET: Record<string, string> = { Critical: "bg-red-100 text-red-700", High: "bg-orange-100 text-orange-700", Medium: "bg-amber-100 text-amber-700", Low: "bg-gray-100 text-gray-500" };
const STATUS: Record<string, string> = { open: "bg-red-100 text-red-700", acknowledged: "bg-blue-100 text-blue-700", resolved: "bg-green-100 text-green-700" };
const ewsColor = (n: number | null) => n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";

// SSW-CCR-003 S5 — the escalation workflow, rendered as the operational
// contract this page implements.
const WORKFLOW = [
  { n: 1, label: "Detect", sub: "Nurse or system trigger" },
  { n: 2, label: "Raise", sub: "Logged with level & detail" },
  { n: 3, label: "Triage", sub: "Priority & routing by SSW" },
  { n: 4, label: "Respond", sub: "Team notified & acts" },
  { n: 5, label: "Resolve", sub: "Issue resolved & documented" },
  { n: 6, label: "Review", sub: "Outcome reviewed & learned" },
];

function Kpi({ label: l, value, tone, sub }: { label: string; value: React.ReactNode; tone?: string; sub?: string }) {
  return (
    <div className={card}>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{l}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function EscalationCentrePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isSuperUser = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const NONE = "00000000-0000-0000-0000-000000000000";

  const d: any = await loadEscalations(admin, hid, isSuperUser, undefined, id);

  if (!d.provisioned) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold text-gray-900">Clinical Escalation Centre</h1>
        <div className={card}><p className="text-sm text-gray-400">The operational escalation store is not provisioned yet.</p></div>
      </div>
    );
  }

  // Deterioration watch (CCR-003 S4) — the PEWS signal that FEEDS escalation,
  // from real recorded observations on the tenant's patients.
  const scope = (q: any) => (isSuperUser ? q : q.eq("hospital_id", hid ?? NONE));
  const { data: obsRows } = await scope(admin.from("op_observations")
    .select("patient_id, ews_score, recorded_at, escalation_triggered, op_patients!patient_id(label, departments!department_id(name))")
    .not("ews_score", "is", null).eq("status", "recorded")
    .order("recorded_at", { ascending: false }).limit(300)).then((r: any) => r, () => ({ data: [] }));
  const seen = new Set<string>();
  const deterioration: any[] = [];
  for (const o of (obsRows ?? []) as any[]) {
    if (!o.patient_id || seen.has(o.patient_id)) continue;
    seen.add(o.patient_id);
    const prior = ((obsRows ?? []) as any[]).find((x: any) => x.patient_id === o.patient_id && x.recorded_at < o.recorded_at);
    if ((o.ews_score ?? 0) >= 3) {
      deterioration.push({
        patient: o.op_patients?.label ?? "Patient", ward: o.op_patients?.departments?.name ?? "—",
        pews: o.ews_score, prev: prior?.ews_score ?? null,
        trend: prior?.ews_score == null ? null : o.ews_score > prior.ews_score ? "up" : o.ews_score < prior.ews_score ? "down" : "flat",
        at: o.recorded_at, escalated: !!o.escalation_triggered,
      });
    }
  }
  deterioration.sort((a, b) => b.pews - a.pews);

  // Response team (CCR-003 S6) — HONEST: there is no on-call roster store, so
  // this is who is actually on the active shift, not a fabricated directory.
  let responders: { id: string; name: string; role: string; status: string }[] = [];
  {
    let sq = admin.from("op_shifts").select("id").eq("status", "active").order("created_at", { ascending: false }).limit(1);
    if (!isSuperUser) sq = sq.eq("hospital_id", hid ?? NONE);
    const { data: shifts } = await sq;
    if (shifts?.[0]) {
      const { data: staff } = await admin.from("op_shift_staff")
        .select("role, status, profiles!staff_id(id, full_name)").eq("shift_id", shifts[0].id).limit(60);
      responders = ((staff ?? []) as any[]).filter(s => s.profiles)
        .map(s => ({ id: s.profiles.id, name: s.profiles.full_name ?? "Staff", role: s.role, status: s.status }));
    }
  }

  const k = d.kpis;
  const overdueN = d.board.filter((r: any) => r.overdue).length;
  const pendingAck = d.board.filter((r: any) => r.status === "open").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clinical Escalation Centre</h1>
          <p className="text-sm text-gray-500 mt-1">Detect. Escalate. Coordinate. Act. Review. — every open escalation with its response deadline.</p>
        </div>
        <Link href="/supervisor/clinical-safety" className="text-sm text-teal-700 hover:underline self-center">Deterioration surveillance →</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <Kpi label="Active escalations" value={k.open} tone={k.open > 0 ? "text-red-600" : undefined} />
        <Kpi label="Critical (L4-5)" value={k.critical} tone={k.critical > 0 ? "text-red-600" : undefined} sub="immediate action" />
        <Kpi label="Pending acknowledgement" value={pendingAck} tone={pendingAck > 0 ? "text-amber-600" : undefined} />
        <Kpi label="Past response deadline" value={overdueN} tone={overdueN > 0 ? "text-red-600" : undefined} sub="SLA breached" />
        <Kpi label="Avg response" value={k.avgResponse != null ? `${k.avgResponse}m` : "—"} sub="raised → resolved" />
        <Kpi label="Resolved this week" value={k.resolvedThisWeek} tone="text-green-700" />
      </div>

      {d.aiWarn.length > 0 && (
        <div className={card}>
          <p className={label}>Escalation intelligence</p>
          <div className="mt-2 space-y-1">
            {d.aiWarn.map((w: any, i: number) => (
              <p key={i} className={`text-sm ${w.tone === "red" ? "text-red-700" : "text-amber-700"}`}>⚠ <span className="font-medium">{w.title}</span> — {w.sub}</p>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Rule-based over the live queue — deterministic, not a model prediction.</p>
        </div>
      )}

      {/* Priority board — the working surface */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">🚨 Escalation Priority Board <span className="text-gray-400 font-normal">({d.board.length} open)</span></h3>
          <span className="text-[11px] text-gray-400">ranked by level, then age</span>
        </div>
        <div className="divide-y divide-gray-100">
          {d.board.length === 0 && <p className="text-sm text-gray-400 py-2">No open escalations. Raised escalations appear here with their response deadline.</p>}
          {d.board.map((e: any) => {
            const dueMin = e.response_deadline ? Math.round((new Date(e.response_deadline).getTime() - Date.parse(new Date().toISOString())) / 60000) : null;
            return (
              <div key={e.id} className={`py-3 ${e.overdue ? "bg-red-50/40 -mx-2 px-2 rounded-lg" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-800">L{e.level}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${BUCKET[e.bucket] ?? BUCKET.Low}`}>{e.bucket}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS[e.status] ?? STATUS.open}`}>{titleCase(e.status)}</span>
                  <span className="text-sm font-medium text-gray-800">{e.patientLabel ?? e.area}</span>
                  <span className="text-xs text-gray-400">{titleCase(e.escalation_type)}</span>
                  {e.overdue
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">SLA BREACHED</span>
                    : dueMin != null && <span className={`text-[11px] tabular-nums ${dueMin <= 15 ? "text-orange-600 font-semibold" : "text-gray-400"}`}>{dueMin}m to respond</span>}
                  <span className="ml-auto text-[11px] text-gray-400">{e.reporter} · {e.elapsedMin}m ago{e.owner ? ` · owner ${e.owner}` : ""}</span>
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{e.summary}</p>
                <EscalationActions id={e.id} status={e.status} responders={responders.map(r => ({ id: r.id, name: `${r.name} (${r.role})` }))} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Deterioration watch */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">📈 Patient Deterioration Watch <span className="text-gray-400 font-normal">({deterioration.length})</span></h3>
          <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {deterioration.length === 0 && <p className="text-sm text-gray-400 py-2">No patients at or above PEWS 3 on the latest recorded observation.</p>}
            {deterioration.slice(0, 12).map((p, i) => (
              <p key={i} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-800">{p.patient}</span>
                <span className="text-xs text-gray-400">{p.ward}</span>
                <span className={`font-bold tabular-nums ${ewsColor(p.pews)}`}>PEWS {p.pews}</span>
                {p.trend && <span className={`text-sm font-bold ${p.trend === "up" ? "text-red-600" : p.trend === "down" ? "text-green-600" : "text-gray-400"}`}>{p.trend === "up" ? "↗" : p.trend === "down" ? "↘" : "→"}</span>}
                {p.escalated && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">auto-escalated</span>}
                <span className="ml-auto text-[11px] text-gray-400">{fmtWhen(p.at)}</span>
              </p>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">Latest recorded PEWS per patient. A score ≥5 or a concern flag auto-raises an escalation from the bedside.</p>
        </div>

        {/* Response team + outcomes */}
        <div className="space-y-5">
          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">👥 Response Team <span className="text-gray-400 font-normal">({responders.length})</span></h3>
            {responders.length === 0 ? (
              <p className="text-sm text-gray-400">No active shift staffed — activate and staff a shift to see the response team.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {responders.map(r => (
                  <span key={r.id} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${r.status === "on_duty" ? "bg-green-500" : "bg-gray-300"}`} />
                    {r.name}<span className="text-gray-400">{titleCase(r.role)}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">Staff rostered on the active shift. A formal on-call directory is not modelled in the operational schema — this is who is actually on.</p>
          </div>

          <div className={card}>
            <p className={label}>Escalation profile (open)</p>
            <div className="grid grid-cols-2 gap-x-6 mt-2">
              <div>
                <p className="text-[10px] text-gray-400 uppercase mb-1">By type</p>
                {d.byType.length === 0 && <p className="text-xs text-gray-400">—</p>}
                {d.byType.slice(0, 5).map((t: any) => (
                  <p key={t.label} className="text-xs text-gray-600 flex justify-between"><span>{t.label}</span><span className="tabular-nums font-medium">{t.n}</span></p>
                ))}
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase mb-1">Hotspots</p>
                {d.hotspots.length === 0 && <p className="text-xs text-gray-400">—</p>}
                {d.hotspots.map((h: any) => (
                  <p key={h.label} className="text-xs text-gray-600 flex justify-between"><span className="truncate">{h.label}</span><span className="tabular-nums font-medium">{h.n}</span></p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workflow + weekly timeline */}
      <div className={card}>
        <p className={label}>Escalation workflow</p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {WORKFLOW.map((w, i) => (
            <div key={w.n} className="flex items-center gap-2">
              <div className="text-center px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 min-w-[104px]">
                <p className="text-xs font-semibold text-gray-700">{w.n}. {w.label}</p>
                <p className="text-[9px] text-gray-400">{w.sub}</p>
              </div>
              {i < WORKFLOW.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <p className={label}>Opened vs resolved (last 7 days)</p>
        <div className="flex items-end gap-2 mt-3 h-24">
          {d.timeline.map((t: any) => {
            const max = Math.max(1, ...d.timeline.map((x: any) => Math.max(x.opened, x.resolved)));
            return (
              <div key={t.date} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-0.5 h-20">
                  <div className="w-2.5 bg-red-400 rounded-t" style={{ height: `${(t.opened / max) * 100}%` }} title={`${t.opened} opened`} />
                  <div className="w-2.5 bg-green-400 rounded-t" style={{ height: `${(t.resolved / max) * 100}%` }} title={`${t.resolved} resolved`} />
                </div>
                <span className="text-[9px] text-gray-400">{t.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">🔴 opened · 🟢 resolved. Escalation health score {k.health}/100 (weighted by critical share and SLA breaches).</p>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Every acknowledge, assignment, escalation and resolution is audit-logged. Response deadlines are set at raise time by level (L4-5: 15 min · L3: 60 min · L1-2: 240 min).
      </p>
    </div>
  );
}
