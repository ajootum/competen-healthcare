import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCommunicationCentre } from "@/lib/operations/communication-centre";
import CommsConsole from "./CommsConsole";
import BroadcastList from "./BroadcastList";

export const dynamic = "force-dynamic";

// Communication Centre (SSW-COM-001) — operational messaging, broadcasts, escalation
// & handover communication, announcements and analytics. Messaging & broadcasts are
// live from op_messages / op_broadcasts (migration 072); escalation, handover, alert
// and notification communication reuse the existing op_* / notifications tables.
// Response-time & peak-time analytics and per-message read receipts have no store
// yet and are shown as honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const tc = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const ALERT_TONE: Record<string, string> = { high: "border-rose-100 bg-rose-50/40", medium: "border-amber-100 bg-amber-50/40", low: "border-gray-100" };
const STATUS_TONE: Record<string, string> = { open: "bg-rose-50 text-rose-700", acknowledged: "bg-blue-50 text-blue-700", resolved: "bg-green-50 text-green-700" };
const CTX_TONE: Record<string, string> = { team: "bg-blue-50 text-blue-600", patient: "bg-violet-50 text-violet-600", task: "bg-amber-50 text-amber-600", direct: "bg-teal-50 text-teal-600", general: "bg-gray-100 text-gray-600" };
const CH_C = ["#14b8a6", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444"];

export default async function CommunicationCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadCommunicationCentre(admin, hid, isSuper, user.id);
  const k = d.kpis, h = d.hub, an = d.analytics;

  const kpis = [
    ["Unread Messages", k.unreadMessages, "Across all channels", ""],
    ["Active Broadcasts", k.activeBroadcasts, "Require acknowledgement", ""],
    ["Open Escalations", k.openEscalations, "Awaiting resolution", k.openEscalations ? "text-rose-600" : ""],
    ["Pending Handover Items", k.pendingHandoverItems, "From outgoing shift", ""],
    ["Alerts Requiring Action", k.alertsRequiringAction, "High / medium priority", k.alertsRequiringAction ? "text-amber-600" : ""],
  ];
  const hubTiles = [["Critical Alerts", h.criticalAlerts, "Immediate action", "text-rose-600"], ["Escalations", h.escalations, "Open escalations", "text-orange-600"], ["Broadcasts", h.broadcasts, "Active broadcasts", "text-blue-600"], ["Handover Items", h.handoverItems, "Pending items", "text-violet-600"], ["Awaiting Ack.", h.awaitingAck, "Need acknowledgement", "text-amber-600"], ["AI Suggestions", h.aiSuggestions, "New recommendations", "text-teal-600"]];

  const chTotal = an.channelDist.reduce((n: number, c: any) => n + c.n, 0) || 1;
  const chDonut = (() => { let acc = 0; const st: string[] = []; an.channelDist.forEach((c: any, i: number) => { const a = (acc / chTotal) * 360, b = ((acc + c.n) / chTotal) * 360; if (c.n) st.push(`${CH_C[i % CH_C.length]} ${a}deg ${b}deg`); acc += c.n; }); return st.length ? `conic-gradient(${st.join(", ")})` : "conic-gradient(#e5e7eb 0deg 360deg)"; })();

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Communication Centre</h1><p className="text-sm text-gray-500">Real-time communication and coordination across your shift.</p></div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Live</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpis.map(([l, v, sub, tone]: any) => (<div key={l} className={`${card} p-4`}><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide leading-tight">{l}</p><p className={`text-2xl font-bold mt-1 tabular-nums ${tone || "text-gray-900"}`}>{v}</p><p className="text-[10px] text-gray-400 truncate">{sub}</p></div>))}
      </div>

      {/* Operations Hub */}
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Operations Hub <span className="text-gray-400 font-normal">· your communication overview</span></h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          {hubTiles.map(([l, v, sub, tone]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-3"><p className={`text-xl font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[10px] font-semibold text-gray-700 leading-tight">{l}</p><p className="text-[9px] text-gray-400">{sub}</p></div>))}
        </div>
      </div>

      {/* Console · Team Communications · Priority Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4" id="console">
        <CommsConsole messagesProvisioned={d.messagesProvisioned} broadcastsProvisioned={d.broadcastsProvisioned} />

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Team Communications</h2>
          {!d.messagesProvisioned ? <p className="text-xs text-gray-400">Run migration 072 to enable messaging.</p> : d.channels.length === 0 ? <p className="text-sm text-gray-400">No conversations yet — send a message to start.</p> : (
            <div className="space-y-1.5">
              {d.channels.map((ch: any, i: number) => (
                <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="text-xs font-medium text-gray-800 truncate">{ch.channel}</span><span className={`text-[8px] px-1 py-0.5 rounded ${CTX_TONE[ch.context] ?? "bg-gray-100"}`}>{ch.context}</span></div><p className="text-[10px] text-gray-400 truncate">{ch.last}</p></div>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(ch.lastAt)}</span>
                  <span className="text-[9px] font-semibold text-white bg-teal-500 rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center shrink-0">{ch.n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Priority Alerts</h2>
          {d.priorityAlerts.length === 0 ? <p className="text-sm text-gray-400">No priority alerts.</p> : (
            <div className="space-y-2">
              {d.priorityAlerts.map((a: any, i: number) => (
                <div key={i} className={`rounded-lg border p-2.5 ${ALERT_TONE[a.tone] ?? "border-gray-100"}`}>
                  <div className="flex items-center gap-2"><span className="text-xs font-medium text-gray-800 truncate flex-1 capitalize">{a.title}</span><span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${a.tone === "high" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{a.action}</span></div>
                  <p className="text-[10px] text-gray-400">{relTime(a.at)}{a.sub ? ` · ${a.sub}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Broadcast Centre · Escalation Communications · Unread/Awaiting Ack */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Broadcast Centre</h2>
          {!d.broadcastsProvisioned ? <p className="text-xs text-gray-400">Run migration 072 to enable broadcasts.</p> : <BroadcastList broadcasts={d.broadcasts} editable={true} />}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Escalation Communications</h2>
          {d.escList.length === 0 ? <p className="text-sm text-gray-400">No escalations.</p> : (
            <div className="space-y-1.5">
              {d.escList.map((e: any, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${e.level >= 4 ? "bg-rose-500" : "bg-amber-500"}`} />
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-800 truncate">{e.patient ? `${e.patient} — ` : ""}{e.summary}</p><p className="text-[10px] text-gray-400">{relTime(e.at)}{e.by ? ` · ${e.by}` : ""}</p></div>
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${STATUS_TONE[e.status] ?? "bg-gray-100 text-gray-600"}`}>{tc(e.status)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Unread / Awaiting Acknowledgement</h2>
          <div className="space-y-1.5">
            {d.notifs.filter((n: any) => !n.read).length === 0 && d.broadcasts.filter((b: any) => !b.userAcked).length === 0 && <p className="text-sm text-gray-400">✅ Nothing awaiting you.</p>}
            {d.broadcasts.filter((b: any) => !b.userAcked).slice(0, 3).map((b: any, i: number) => (<div key={`b${i}`} className="flex items-center gap-2 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" /><span className="text-gray-700 flex-1 truncate">{b.title}</span><span className="text-[10px] text-gray-400">{b.acked}/{b.target || "—"}</span></div>))}
            {d.notifs.filter((n: any) => !n.read).slice(0, 4).map((n: any, i: number) => (<div key={`n${i}`} className="flex items-center gap-2 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" /><span className="text-gray-700 flex-1 truncate">{n.title}</span><span className="text-[10px] text-gray-400">{relTime(n.created_at)}</span></div>))}
          </div>
        </div>
      </div>

      {/* Shift Handover · Announcements · Analytics */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-2"><h2 className="text-sm font-bold text-gray-900">Shift Handover</h2><Link href="/supervisor/handover" className="text-[11px] text-teal-700 hover:underline">Continue →</Link></div>
          <p className="text-xs text-gray-600 mb-3">{d.handover.outgoing ?? "—"} <span className="text-gray-400">· {tc(d.handover.status)} ({d.handover.pct}%)</span></p>
          <div className="grid grid-cols-4 gap-2">
            {[["Critical Patients", d.handover.criticalPatients], ["Outstanding Tasks", d.handover.outstandingTasks], ["Open Escalations", d.handover.openEscalations], ["Follow-up", d.handover.followUp]].map(([l, v]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className="text-lg font-bold text-gray-900 tabular-nums">{v ?? "—"}</p><p className="text-[8px] text-gray-500 leading-tight">{l}</p></div>))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Follow-up items need a handover-items store.</p>
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Announcements &amp; Alerts</h2>
          {d.notifs.length === 0 ? <p className="text-sm text-gray-400">No recent announcements.</p> : (
            <div className="space-y-1.5">
              {d.notifs.slice(0, 5).map((n: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${n.read ? "bg-gray-300" : "bg-teal-500"}`} /><span className="text-gray-700 flex-1 truncate">{n.title}</span><span className="text-[10px] text-gray-400 shrink-0">{relTime(n.created_at)}</span></div>))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Communication Analytics</h2>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[["Avg Response", an.avgResponseMin == null ? "—" : `${an.avgResponseMin}m`, "text-gray-400"], ["Ack Rate", an.broadcastAckRate == null ? "—" : `${an.broadcastAckRate}%`, scoreTone(an.broadcastAckRate)], ["Messages Sent", an.messagesSent, "text-gray-900"]].map(([l, v, tone]: any) => (<div key={l} className="rounded-lg border border-gray-100 p-2 text-center"><p className={`text-base font-bold tabular-nums ${tone}`}>{v}</p><p className="text-[8px] text-gray-500">{l}</p></div>))}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 shrink-0 rounded-full" style={{ background: chDonut }}><div className="absolute inset-[7px] bg-white rounded-full flex items-center justify-center"><span className="text-[9px] text-gray-400">by channel</span></div></div>
            <div className="text-[10px] space-y-0.5 flex-1">
              {an.channelDist.length === 0 ? <span className="text-gray-400">No messages yet.</span> : an.channelDist.slice(0, 5).map((c: any, i: number) => (<div key={c.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: CH_C[i % CH_C.length] }} /><span className="text-gray-600 flex-1 capitalize">{c.label}</span><span className="text-gray-500 tabular-nums">{c.pct}%</span></div>))}
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Response times &amp; peak-time trends need message read-receipt timestamps.</p>
        </div>
      </div>

      {/* AI Copilot Recommendations · Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-1.5 mb-3"><span className="text-base">✨</span><h2 className="text-sm font-bold text-gray-900">AI Copilot Recommendations</h2></div>
          {d.aiRecs.length === 0 ? <p className="text-sm text-gray-400">No recommendations.</p> : (
            <div className="grid sm:grid-cols-2 gap-2">
              {d.aiRecs.map((r: any, i: number) => (<div key={i} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-gray-800 leading-tight">{r.text}</p><p className="text-[10px] text-gray-400">{r.sub}</p></div><span className="text-[10px] font-semibold text-violet-700 border border-violet-200 rounded-full px-2 py-0.5 shrink-0">{r.action}</span></div>))}
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-3 gap-2">
            {[["💬 New Message", "#console"], ["📣 Send Broadcast", "#console"], ["⬆️ Raise Escalation", "/supervisor/operations?section=safety"], ["🔄 Start Handover", "/supervisor/handover"], ["📢 Create Announcement", "#console"], ["✨ AI Summarise", "/supervisor/ai"]].map(([l, href]: any) => (<Link key={l} href={href} className="rounded-lg border border-gray-100 hover:border-teal-300 hover:bg-teal-50/40 p-2.5 text-center text-[11px] font-medium text-gray-700">{l}</Link>))}
          </div>
        </div>
      </div>

      {/* Integration strip */}
      <div className={`${card} p-4`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Integrated Across Your Shift <span className="text-gray-400 font-normal">· communication drives every operational module</span></h2>
        <div className="flex flex-wrap gap-2">{[["🧭 Patient Operations", "Patient alerts & updates"], ["✅ Task Centre", "Task assignments & updates"], ["👥 Workforce Operations", "Redeployment & coverage"], ["🛡️ Quality & Safety", "Incidents & CAPA updates"], ["✨ AI Operational Copilot", "Smart communications"]].map(([t, s]: any) => (<div key={t} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5"><p className="text-[11px] font-medium text-gray-700">{t}</p><p className="text-[9px] text-gray-400">{s}</p></div>))}</div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Communication Centre (SSW-COM-001) is the shift's operational coordination hub — context-aware team messaging and ward/hospital broadcasts with acknowledgement tracking (live from op_messages / op_broadcasts), plus escalation, handover, alert and announcement communication drawn from the existing operational engines. Response-time &amp; peak-time analytics, per-message read receipts and a follow-up-items store are not yet backed and are shown as honest states rather than fabricated.</p>
    </div>
  );
}
