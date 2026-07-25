import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import { loadPersonalWorkspace } from "@/lib/personal-workspace";

export const dynamic = "force-dynamic";

// Personal Workspace (PW-000 / PW-001 Personal Dashboard) — the authenticated user's own command centre,
// aggregating their real work (assigned patients, tasks, competencies, learning, schedule, messages,
// notifications, performance) and their workspace launcher. Scoped to the person (never expands access); every
// widget honest-empty when they have no such record. "What needs my attention?" — role workspaces answer "how".
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const prPill: Record<string, string> = { urgent: "bg-rose-100 text-rose-700", high: "bg-rose-100 text-rose-700", normal: "bg-amber-100 text-amber-700", medium: "bg-amber-100 text-amber-700", low: "bg-emerald-100 text-emerald-700" };
const prLabel: Record<string, string> = { urgent: "High", high: "High", normal: "Medium", medium: "Medium", low: "Low" };
const tagTone: Record<string, string> = { "High Risk": "bg-rose-100 text-rose-700", Critical: "bg-rose-100 text-rose-700", "Discharge Plan": "bg-sky-100 text-sky-700", Stable: "bg-emerald-100 text-emerald-700" };
const fmtTime = (iso: string | null) => { if (!iso) return ""; try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const relTime = (iso: string | null) => { if (!iso) return ""; try { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)}d ago`; } catch { return ""; } };
function clock() { const d = new Date(); return { hour: d.getHours(), date: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }; }
const nowMs = () => Date.now(); // module helper — direct Date.now() in render trips the purity rule

function Ring({ pct, label }: { pct: number | null; label: string }) {
  const size = 64, r = (size - 8) / 2, c = 2 * Math.PI * r;
  const v = pct ?? 0; const color = v >= 90 ? "#22c55e" : v >= 70 ? "#14b8a6" : pct == null ? "#e5e7eb" : "#f59e0b";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth="6" />
        {pct != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${Math.max((v / 100) * c, 1)} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        <text x={size / 2} y={size / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize="14" fontWeight="700" fill={pct == null ? "#9ca3af" : "#111827"}>{pct == null ? "—" : `${pct}%`}</text>
      </svg>
      <span className="text-[10px] text-gray-500 mt-1">{label}</span>
    </div>
  );
}

const QUICK = [
  { icon: "▶", label: "Start Shift", href: "/dashboard/shift" }, { icon: "👥", label: "My Patients", href: "/dashboard/shift" },
  { icon: "💊", label: "Medication Tasks", href: "/dashboard/shift" }, { icon: "🔄", label: "Handover", href: "/dashboard/shift" },
  { icon: "⚠️", label: "Report Incident", href: "/dashboard/shift" }, { icon: "🆘", label: "Request Help", href: "mailto:gabriel@semacast.com" },
  { icon: "📝", label: "Open Assessments", href: "/dashboard/assessments" }, { icon: "🎓", label: "My Learning", href: "/dashboard/learning" },
];
const AI_PROMPTS = ["What patients need my attention first?", "What competencies expire this month?", "Summarize my workload today", "Draft my shift reflection"];

export default async function PersonalWorkspacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  const userRoles: AppRole[] = (profile.roles?.length ? profile.roles : [profile.role]).filter(Boolean) as AppRole[];

  const [d, workspaces] = await Promise.all([
    loadPersonalWorkspace(admin, user.id, profile) as Promise<any>,
    workspaceLinksForUser(admin, user.id, userRoles).catch(() => []),
  ]);
  const { hour, date } = clock();
  const now = nowMs();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const comp = d.competencies;

  return (
    <div className="max-w-7xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">{greeting}, {d.firstName} 👋</h1><p className="text-sm text-gray-400">{date}</p></div>
        <Link href="/dashboard/billing" className="text-xs font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">⚙ Customize Dashboard</Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Main column */}
        <div className="xl:col-span-2 space-y-4">
          {/* AI briefing + priorities */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl border border-indigo-100 p-5">
              <h2 className="font-semibold text-gray-900 text-sm mb-2 flex items-center gap-1.5">✨ AI Shift Briefing</h2>
              <p className="text-xs text-gray-600 mb-2">{greeting} {d.firstName}.</p>
              <div className="space-y-1.5">{d.briefing.map((b: string, i: number) => <p key={i} className="text-[11px] text-gray-600 flex gap-1.5"><span className="text-indigo-400 mt-0.5">•</span><span>{b}</span></p>)}</div>
              <div className="flex gap-2 mt-3"><Link href="/dashboard/copilot" className="text-[10px] font-medium bg-white border border-indigo-200 text-indigo-700 rounded-lg px-2.5 py-1 hover:bg-indigo-50">Prepare me for today&apos;s shift</Link><Link href="/dashboard/copilot" className="text-[10px] font-medium bg-white border border-indigo-200 text-indigo-700 rounded-lg px-2.5 py-1 hover:bg-indigo-50">Summarize overnight events</Link></div>
            </div>
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">🚩 Today&apos;s Priorities</h2></div>
              <div className="space-y-2">{d.priorities.map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${prPill[t.priority] ?? prPill.low}`}>{prLabel[t.priority] ?? "Low"}</span><span className="text-[11px] text-gray-700 flex-1 truncate">{t.label}</span><span className="text-[10px] text-gray-400 shrink-0">{t.due ? fmtTime(t.due) : t.source === "Learning" ? "This week" : ""}</span></div>
              ))}{!d.priorities.length && <p className="text-[11px] text-gray-400 py-3 text-center">No priorities right now 🎉</p>}</div>
              <Link href="/dashboard/shift" className="text-[10px] text-indigo-600 font-medium mt-2 inline-block">View all tasks →</Link>
            </div>
          </div>

          {/* Patients + tasks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm">👥 My Patients ({d.patients.length})</h2></div>
              {d.patients.length ? <div className="space-y-2">{d.patients.slice(0, 5).map((p: any) => (
                <div key={p.id} className="border border-gray-100 rounded-lg p-2.5"><div className="flex items-center justify-between"><span className="text-[10px] text-gray-400">Bed {p.bed}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${tagTone[p.tag] ?? "bg-gray-100 text-gray-600"}`}>{p.tag}</span></div><p className="text-xs font-medium text-gray-800">{p.name}</p><p className="text-[10px] text-gray-400">{p.status?.replace(/_/g, " ")}{p.isolation && p.isolation !== "none" ? ` · ${p.isolation}` : ""}</p></div>
              ))}</div> : <p className="text-[11px] text-gray-400 py-6 text-center">No patients assigned to you today.</p>}
            </div>
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm">📋 Tasks Requiring Action ({d.tasksCount})</h2></div>
              {d.tasks.length ? <div className="space-y-1.5">{d.tasks.slice(0, 6).map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px]"><span className="text-gray-300">{t.type === "learning" ? "🎓" : t.type === "competency" ? "🎯" : "☑"}</span><span className="text-gray-700 flex-1 truncate">{t.label}</span><span className="text-gray-400 shrink-0">{t.source}</span>{t.due && <span className={`text-[10px] shrink-0 ${new Date(t.due).getTime() < now ? "text-rose-600" : "text-gray-400"}`}>{fmtTime(t.due)}</span>}</div>
              ))}</div> : <p className="text-[11px] text-gray-400 py-6 text-center">No open tasks.</p>}
              <Link href="/dashboard/shift" className="text-[10px] text-indigo-600 font-medium mt-2 inline-block">Go to My Tasks →</Link>
            </div>
          </div>

          {/* Performance + competencies + AI assistant */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm">📊 My Performance</h2><Link href="/dashboard/passport" className="text-[10px] text-indigo-600">View Details</Link></div>
              <div className="grid grid-cols-3 gap-2">{d.performance.map((p: any) => <Ring key={p.label} pct={p.pct} label={p.label} />)}</div>
              {d.perfBacked < d.performance.length && <p className="text-[9px] text-gray-300 mt-2">Rings show your real record where available.</p>}
            </div>
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm">🎯 My Competencies</h2><Link href="/dashboard/passport" className="text-[10px] text-indigo-600">View Passport</Link></div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[["Validated", comp.validated, "text-emerald-600"], ["Pending", comp.pending, "text-amber-600"], ["Expiring", comp.expiring, "text-orange-600"], ["Remediation", comp.remediation, "text-rose-600"]].map(([l, v, t]: any) => (<div key={l} className="text-center bg-gray-50 rounded-lg py-2"><p className={`text-lg font-bold tabular-nums ${t}`}>{v}</p><p className="text-[9px] text-gray-500">{l}</p></div>))}
              </div>
              {comp.compliance != null && <><div className="flex items-center justify-between text-[10px] text-gray-500 mb-1"><span>Overall Compliance</span><span className="font-semibold">{comp.compliance}%</span></div><div className="h-2 bg-gray-100 rounded overflow-hidden"><div className="h-full bg-emerald-500 rounded" style={{ width: `${comp.compliance}%` }} /></div></>}
            </div>
            <div className={`${card} p-5`}>
              <h2 className="font-semibold text-gray-900 text-sm mb-3">✨ AI Assistant</h2>
              <Link href="/dashboard/copilot" className="block text-[11px] text-gray-400 border border-gray-200 rounded-lg px-3 py-2 mb-2 hover:bg-gray-50">Ask me anything…</Link>
              <div className="space-y-1">{AI_PROMPTS.map(p => <Link key={p} href="/dashboard/copilot" className="block text-[10px] text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 hover:bg-gray-100">{p}</Link>)}</div>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">📅 Today&apos;s Schedule</h2>
            {d.currentShift ? <div className="space-y-2.5">{d.schedule.map((s: any, i: number) => (
              <div key={i} className="flex gap-3"><span className="text-[11px] font-medium text-gray-400 tabular-nums w-10 shrink-0">{s.time}</span><div className="border-l-2 border-indigo-200 pl-2.5"><p className="text-[11px] font-medium text-gray-800">{s.title}</p><p className="text-[10px] text-gray-400">{s.sub}</p></div></div>
            ))}</div> : <p className="text-[11px] text-gray-400 py-4 text-center">No shift scheduled today.</p>}
          </div>

          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm">🔔 Recent Notifications</h2><Link href="/dashboard/notifications" className="text-[10px] text-indigo-600">View All</Link></div>
            {d.notifications.length ? <div className="space-y-2">{d.notifications.slice(0, 5).map((n: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.read ? "bg-gray-200" : "bg-indigo-500"}`} /><div className="flex-1 min-w-0"><p className="text-[11px] text-gray-700 leading-snug">{n.title}</p><p className="text-[9px] text-gray-400">{relTime(n.at)}</p></div></div>
            ))}</div> : <p className="text-[11px] text-gray-400 py-4 text-center">No notifications.</p>}
          </div>

          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900 text-sm">💬 Messages</h2><Link href="/dashboard/notifications" className="text-[10px] text-indigo-600">View All</Link></div>
            {d.messages.length ? <div className="space-y-2">{d.messages.map((m: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">{(m.from ?? "?")[0]}</span><div className="flex-1 min-w-0"><p className="text-[11px] font-medium text-gray-700 truncate">{m.from} <span className="text-[9px] text-gray-400 font-normal">· {m.channel}</span></p><p className="text-[10px] text-gray-500 truncate">{m.body}</p></div><span className="text-[9px] text-gray-300 shrink-0">{fmtTime(m.at)}</span></div>
            ))}</div> : <p className="text-[11px] text-gray-400 py-4 text-center">No recent messages.</p>}
          </div>
        </div>
      </div>

      {/* Quick actions + workspaces */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">⚡ Quick Actions</h2>
          <div className="grid grid-cols-4 gap-2">{QUICK.map(a => (
            <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50 hover:border-indigo-200 transition-colors"><span className="text-lg">{a.icon}</span><span className="text-[9px] text-gray-600 text-center leading-tight">{a.label}</span></Link>
          ))}</div>
        </div>
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-3">🧭 My Workspaces</h2>
          <div className="flex flex-wrap gap-2">
            <span className="flex flex-col items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5 w-24"><span className="text-lg">🩺</span><span className="text-[9px] text-gray-700 text-center">Healthcare Worker</span></span>
            {workspaces.slice(0, 5).map((w: any) => (
              <Link key={w.href} href={w.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 p-2.5 w-24 hover:bg-gray-50 hover:border-indigo-200 transition-colors"><span className="text-lg">{w.icon ?? "🗂️"}</span><span className="text-[9px] text-gray-600 text-center leading-tight">{w.label}</span></Link>
            ))}
          </div>
          {!workspaces.length && <p className="text-[10px] text-gray-400 mt-1">Your Healthcare Worker workspace. Additional role workspaces appear here when granted.</p>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Your Personal Workspace aggregates your own work across the platform (PW-000) — assigned patients, tasks, competencies, learning, schedule, messages and notifications. It references source records and never expands your access. Widgets show your real record; the unified Task, Calendar, Messaging and Documents centres (PW-002..008) are progressively rolling out.</p>
    </div>
  );
}
