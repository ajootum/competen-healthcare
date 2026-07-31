import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMessagingHub, CONTEXT_META } from "@/lib/messaging-hub";
import Composer from "@/components/messaging/Composer";

// PW-005 Messaging & Communications Hub — user-scoped view over the real op_messages store. Conversation list +
// thread + functional composer + KPI ribbon + communication summary. Channel selection via ?c=. Renders REAL
// channels/messages for the caller's hospital; sending is live. Read-state / reactions / threads / stars /
// scheduling aren't backed by op_messages yet — shown honestly (Unread = last-24h proxy, Starred = next-phase).
export const dynamic = "force-dynamic";

const fmtTime = (t: string) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const initials = (n: string | null) => (n ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

function Kpi({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className="flex items-center justify-between"><p className="text-[11px] font-medium text-gray-500">{label}</p><span className="opacity-70">{icon}</span></div>
      <p className={`text-2xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );
}

export default async function MessagingHubPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();

  const d = await loadMessagingHub(admin, user.id, profile, c ?? null);
  const selCh = d.channels.find((x: any) => x.name === d.selected); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Communication summary donut geometry.
  const sumTotal = d.summary.reduce((s: number, x: any) => s + x.n, 0) || 1; // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = 44, C = 2 * Math.PI * R;
  const segs = d.summary.map((x: any, i: number) => ({ ...x, len: (x.n / sumTotal) * C, offset: d.summary.slice(0, i).reduce((s: number, y: any) => s + (y.n / sumTotal) * C, 0) })); // eslint-disable-line @typescript-eslint/no-explicit-any

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-information)] uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Messaging &amp; Communications</h1>
          <p className="text-sm text-gray-500 mt-0.5">All your messages, conversations and collaborative communications in one place.</p>
        </div>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Recent (24h)" value={d.kpis.unread} icon="💬" tone="text-[var(--cmp-text-information)]" />
        <Kpi label="Direct" value={d.kpis.direct} icon="👤" tone="text-gray-900" />
        <Kpi label="Groups" value={d.kpis.groups} icon="👥" tone="text-gray-900" />
        <Kpi label="Broadcasts" value={d.kpis.broadcasts} icon="📢" tone="text-[var(--cmp-text-warning)]" />
        <Kpi label="Mentions" value={d.kpis.mentions} icon="@" tone="text-[var(--cmp-text-error)]" />
        <Kpi label="Starred" value={d.kpis.starred} icon="⭐" tone="text-gray-400" />
      </div>

      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)_260px] gap-5 items-start">
        {/* Conversation list */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Conversations</h2></div>
          {d.channels.length > 0 ? (
            <div className="divide-y divide-gray-50 max-h-[560px] overflow-y-auto">
              {d.channels.map((ch: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                const meta = CONTEXT_META[ch.context_type] ?? { color: "#94a3b8", icon: "💬" };
                const active = ch.name === d.selected;
                return (
                  <Link key={ch.name} href={`/dashboard/messages?c=${encodeURIComponent(ch.name)}`} className={`flex gap-2.5 px-3 py-2.5 ${active ? "bg-[var(--cmp-surface-information)]" : "hover:bg-gray-50"}`}>
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}>{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1"><p className={`text-[13px] truncate ${active ? "font-semibold text-blue-800" : "font-medium text-gray-800"}`}>{ch.name}</p><span className="text-[10px] text-gray-400 shrink-0">{fmtTime(ch.last.created_at)}</span></div>
                      <p className="text-[11px] text-gray-500 truncate">{ch.last.author_name ? `${ch.last.author_name.split(" ")[0]}: ` : ""}{ch.last.body}</p>
                    </div>
                    {ch.recent > 0 && <span className="self-center bg-[var(--cmp-color-information)] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">{ch.recent}</span>}
                  </Link>
                );
              })}
            </div>
          ) : <p className="px-4 py-16 text-center text-sm text-gray-400">No conversations yet. Start one below.</p>}
        </div>

        {/* Thread */}
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col min-h-[500px]">
          {d.selected ? <>
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm" style={{ background: (CONTEXT_META[selCh?.context_type] ?? { color: "#94a3b8" }).color }}>{(CONTEXT_META[selCh?.context_type] ?? { icon: "💬" }).icon}</div>
              <div><h2 className="text-sm font-semibold text-gray-900">{d.selected}</h2><p className="text-[11px] text-gray-400">{(CONTEXT_META[selCh?.context_type] ?? { label: "Channel" }).label} · {selCh?.count ?? 0} message{selCh?.count === 1 ? "" : "s"}</p></div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[440px]">
              {d.thread.map((m: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={m.id} className={`flex gap-2.5 ${m.mine ? "flex-row-reverse" : ""}`}>
                  <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center shrink-0">{initials(m.author_name)}</div>
                  <div className={`max-w-[75%] ${m.mine ? "items-end" : ""} flex flex-col`}>
                    <div className="flex items-center gap-2"><span className="text-[11px] font-semibold text-gray-700">{m.mine ? "You" : m.author_name ?? "Unknown"}</span><span className="text-[10px] text-gray-400">{fmtTime(m.created_at)}</span></div>
                    <div className={`mt-0.5 px-3 py-2 rounded-2xl text-[13px] leading-snug ${m.mine ? "bg-[var(--cmp-color-information)] text-white rounded-tr-sm" : "bg-gray-100 text-gray-800 rounded-tl-sm"}`}>{m.body}</div>
                  </div>
                </div>
              ))}
              {d.thread.length === 0 && <p className="text-center text-sm text-gray-400 py-10">No messages in this conversation yet.</p>}
            </div>
            <Composer channel={d.selected} contextType={selCh?.context_type} />
          </> : (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Select a conversation to view messages.</div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/dashboard/messages?c=General" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">✉ General</Link>
              <Link href="/dashboard/notifications" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">🔔 Alerts</Link>
              <Link href="/dashboard/shift" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">👥 Team</Link>
              <Link href="/dashboard/tasks" className="text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50">☑ Tasks</Link>
            </div>
          </div>

          {d.channels.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">My Channels</h3>
              <div className="flex flex-wrap gap-1.5">
                {d.myChannels.map((n: string) => (
                  <Link key={n} href={`/dashboard/messages?c=${encodeURIComponent(n)}`} className={`text-[11px] rounded-full px-2.5 py-1 ring-1 ${n === d.selected ? "bg-[var(--cmp-color-information)] text-white ring-blue-600" : "bg-gray-50 text-gray-600 ring-gray-200 hover:bg-gray-100"}`}>{n}</Link>
                ))}
              </div>
            </div>
          )}

          {/* Communication summary donut */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Communication Summary</h3>
            {d.summary.length > 0 ? (
              <div className="flex items-center gap-4">
                <svg width="116" height="116" viewBox="0 0 116 116" className="shrink-0">
                  <circle cx="58" cy="58" r={R} fill="none" stroke="#f1f5f9" strokeWidth="13" />
                  {segs.map((x: any, i: number) => <circle key={i} cx="58" cy="58" r={R} fill="none" stroke={x.color} strokeWidth="13" strokeDasharray={`${x.len} ${C - x.len}`} strokeDashoffset={-x.offset} transform="rotate(-90 58 58)" />) /* eslint-disable-line @typescript-eslint/no-explicit-any */}
                  <text x="58" y="54" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="18">{d.total}</text>
                  <text x="58" y="70" textAnchor="middle" className="fill-gray-400" fontSize="8">Total</text>
                </svg>
                <div className="space-y-1.5 text-[12px] flex-1">
                  {d.summary.map((x: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <div key={x.ctx} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: x.color }} /><span className="text-gray-600 truncate">{x.label}</span><span className="ml-auto font-semibold text-gray-900">{x.n}</span></div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No messages yet.</p>}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Channels + messages are your hospital&apos;s real op_messages; sending is live. Read receipts, reactions, threads, starred, pinned and scheduled messages aren&apos;t backed by the store yet (Recent = last 24h, Starred = next-phase).</p>
    </div>
  );
}
