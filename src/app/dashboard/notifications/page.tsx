import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadNotificationCentre, CAT } from "@/lib/notification-centre";
import MarkRead from "@/components/notifications/MarkRead";

// PW-004 Notification Centre — unified feed aggregating the real notifications store + derived cross-module
// events (overdue tasks, expiring competencies, mandatory learning). KPI ribbon, category panel, grouped feed,
// detail panel + summary donut. Category filter / unread-only / selection all via URL params (server-rendered);
// mark-read is a live client action against /api/notifications. Renders the person's REAL feed.
export const dynamic = "force-dynamic";

const prioPill: Record<string, string> = { high: "bg-rose-50 text-rose-700 ring-rose-200", medium: "bg-amber-50 text-amber-700 ring-amber-200", low: "bg-slate-50 text-slate-600 ring-slate-200" };
const fmt = (t: string) => { const d = new Date(t); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

function Kpi({ label, value, tone, sub, icon }: { label: string; value: number; tone: string; sub?: string; icon: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between"><p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p><span className="text-base opacity-70">{icon}</span></div>
      <p className={`text-3xl font-bold mt-1 ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({ n, selHref }: { n: any; selHref: string }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = CAT[n.category];
  return (
    <div className={`flex gap-3 px-4 py-3 border-l-2 ${n.read ? "border-transparent opacity-70" : n.priority === "high" ? "border-rose-400 bg-rose-50/40" : "border-blue-300"} hover:bg-gray-50/60`}>
      <span className="text-lg shrink-0 mt-0.5">{n.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={selHref} className="text-sm font-semibold text-gray-800 hover:text-blue-700 truncate">{n.title}</Link>
          {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
        </div>
        {n.body && <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-1">{n.body}</p>}
        <div className="flex items-center gap-2 mt-1">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium rounded-md px-1.5 py-0.5" style={{ background: `${c.color}15`, color: c.color }}>{c.label}</span>
          <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ring-1 capitalize ${prioPill[n.priority]}`}>{n.priority}</span>
        </div>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmt(n.time)}</span>
        {n.href && <Link href={n.href} className="text-[11px] font-medium text-blue-600 hover:underline">Take action →</Link>}
        {n.real && !n.read && <MarkRead id={n.id} label="Mark read" />}
      </div>
    </div>
  );
}

export default async function NotificationCentrePage({ searchParams }: { searchParams: Promise<{ cat?: string; unread?: string; sel?: string }> }) {
  const { cat, unread, sel } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("hospital_id").eq("id", user.id).single();

  const d = await loadNotificationCentre(admin, user.id, profile);

  // Apply filters.
  let feed = d.feed as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (cat) feed = feed.filter(f => f.category === cat);
  if (unread === "1") feed = feed.filter(f => !f.read);
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const high = feed.filter(f => f.priority === "high");
  const rest = feed.filter(f => f.priority !== "high");
  const today = rest.filter(f => new Date(f.time).getTime() >= startOfToday.getTime());
  const earlier = rest.filter(f => new Date(f.time).getTime() < startOfToday.getTime());

  const detail = (sel && d.feed.find((f: any) => f.id === sel)) || high[0] || feed[0] || null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const qp = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); if (o.cat) p.set("cat", o.cat); if (o.unread) p.set("unread", o.unread); if (o.sel) p.set("sel", o.sel); const s = p.toString(); return s ? `?${s}` : "/dashboard/notifications"; };
  const donutTotal = d.donut.reduce((s: number, c: any) => s + c.n, 0) || 1; // eslint-disable-line @typescript-eslint/no-explicit-any
  const R = 46, C = 2 * Math.PI * R;
  const donutSegs = d.donut.map((c: any, i: number) => ({ ...c, len: (c.n / donutTotal) * C, offset: d.donut.slice(0, i).reduce((s: number, x: any) => s + (x.n / donutTotal) * C, 0) })); // eslint-disable-line @typescript-eslint/no-explicit-any

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Notification Centre</h1>
          <p className="text-sm text-gray-500 mt-0.5">All your important updates, alerts and communications in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          {d.kpis.unread > 0 && <MarkRead all label="Mark all read" className="text-sm font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50" />}
          <Link href="/dashboard/preferences" className="text-sm font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">⚙ Settings</Link>
        </div>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Total" value={d.kpis.total} tone="text-gray-900" sub={`Unread: ${d.kpis.unread}`} icon="🔔" />
        <Kpi label="High Priority" value={d.kpis.high} tone="text-rose-600" sub="Requires attention" icon="❗" />
        <Kpi label="Due Today" value={d.kpis.dueToday} tone="text-amber-600" sub="Action needed" icon="⏰" />
        <Kpi label="This Week" value={d.kpis.thisWeek} tone="text-blue-600" sub="Scheduled" icon="🗓️" />
        <Kpi label="Archived" value={d.kpis.archived} tone="text-gray-500" sub="Read" icon="🗄️" />
      </div>

      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)_300px] gap-5 items-start">
        {/* Left category panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2 pb-1">Categories</p>
          <Link href={qp({ unread })} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm ${!cat ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}><span>🔔 All Notifications</span><span className="text-[11px] text-gray-400">{d.feed.length}</span></Link>
          {d.categories.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
            <Link key={c.key} href={qp({ cat: c.key, unread })} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm ${cat === c.key ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}><span className="truncate">{c.icon} {c.label}</span><span className="text-[11px] text-gray-400 shrink-0 ml-1">{c.n}</span></Link>
          ))}
          <div className="pt-2 mt-1 border-t border-gray-100">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-2 pb-1">View</p>
            <Link href={qp({ cat, unread: unread === "1" ? undefined : "1" })} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm ${unread === "1" ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}>{unread === "1" ? "☑" : "☐"} Unread only</Link>
          </div>
        </div>

        {/* Main feed */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">{cat ? CAT[cat]?.label : "All Notifications"}</h2>
            <span className="text-[11px] text-gray-400">{feed.length} shown</span>
          </div>
          <div className="divide-y divide-gray-50">
            {high.length > 0 && <>
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-rose-600 uppercase tracking-wide">High Priority</p>
              {high.map(n => <Row key={n.id} n={n} selHref={qp({ cat, unread, sel: n.id })} />)}
            </>}
            {today.length > 0 && <>
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Today</p>
              {today.map(n => <Row key={n.id} n={n} selHref={qp({ cat, unread, sel: n.id })} />)}
            </>}
            {earlier.length > 0 && <>
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Earlier</p>
              {earlier.map(n => <Row key={n.id} n={n} selHref={qp({ cat, unread, sel: n.id })} />)}
            </>}
            {feed.length === 0 && <p className="px-4 py-16 text-center text-sm text-gray-400">{d.feed.length === 0 ? "No notifications — you're all caught up. 🎉" : "Nothing matches this filter."}</p>}
          </div>
        </div>

        {/* Right detail + donut */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Notification Details</h3>
            {detail ? (
              <div>
                <div className="flex items-start gap-2.5">
                  <span className="text-2xl">{detail.icon}</span>
                  <div className="min-w-0"><p className="text-sm font-semibold text-gray-800 leading-snug">{detail.title}</p><span className={`inline-block mt-1 text-[10px] font-medium rounded-full px-1.5 py-0.5 ring-1 capitalize ${prioPill[detail.priority]}`}>{detail.priority} priority</span></div>
                </div>
                {detail.body && <p className="text-[13px] text-gray-600 mt-3 leading-relaxed">{detail.body}</p>}
                <dl className="mt-3 space-y-1.5 text-[12px]">
                  <div className="flex justify-between"><dt className="text-gray-400">Source</dt><dd className="text-gray-700 font-medium">{detail.source}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-400">When</dt><dd className="text-gray-700">{fmt(detail.time)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-400">Status</dt><dd className={detail.read ? "text-gray-500" : "text-blue-600 font-medium"}>{detail.read ? "Read" : "Unread"}</dd></div>
                </dl>
                <div className="mt-4 space-y-2">
                  {detail.href && <Link href={detail.href} className="block text-center text-sm font-medium text-white bg-blue-600 rounded-lg py-2 hover:bg-blue-500">Take Action</Link>}
                  {detail.real && !detail.read && <MarkRead id={detail.id} label="Mark as Read" className="block w-full text-center text-sm font-medium text-gray-600 border border-gray-200 rounded-lg py-2 hover:bg-gray-50" />}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 py-6 text-center">Select a notification.</p>}
          </div>

          {/* Summary donut */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">By Category</h3>
            {d.donut.length > 0 ? (
              <div className="flex items-center gap-4">
                <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
                  <circle cx="60" cy="60" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
                  {donutSegs.map((c: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={c.color} strokeWidth="14" strokeDasharray={`${c.len} ${C - c.len}`} strokeDashoffset={-c.offset} transform="rotate(-90 60 60)" />
                  ))}
                  <text x="60" y="56" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="20">{d.feed.length}</text>
                  <text x="60" y="72" textAnchor="middle" className="fill-gray-400" fontSize="9">Total</text>
                </svg>
                <div className="space-y-1.5 text-[12px] flex-1">
                  {d.donut.map((c: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                    <div key={c.key} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} /><span className="text-gray-600 truncate">{c.label}</span><span className="ml-auto font-semibold text-gray-900">{c.n}</span></div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 py-4 text-center">No notifications.</p>}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Category &amp; priority are derived from notification type/source. Live alerts marked as read update instantly; derived items link to their source surface.</p>
    </div>
  );
}
