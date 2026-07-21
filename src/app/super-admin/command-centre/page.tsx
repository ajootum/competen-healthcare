import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveCommand } from "@/lib/super-admin/executive-command";
import ExecutiveContextBar from "./_ec/ExecutiveContextBar";
import Sparkline from "../_mc/Sparkline";

export const dynamic = "force-dynamic";

// Executive Command Centre (MC-004) — the platform-wide executive situation room:
// heartbeat → attention → platform health + decision queue → cross-platform
// intelligence + growth → command console. All live data; unbacked capabilities
// show honest states, and every console action launches a real owning surface.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const TONE: Record<string, string> = { red: "text-red-600", amber: "text-amber-600", orange: "text-orange-600", violet: "text-violet-600", sky: "text-sky-600", green: "text-green-600" };
const TONE_BG: Record<string, string> = { red: "bg-red-50 border-red-100", amber: "bg-amber-50 border-amber-100", orange: "bg-orange-50 border-orange-100", violet: "bg-violet-50 border-violet-100", sky: "bg-sky-50 border-sky-100", green: "bg-green-50 border-green-100" };
const HEALTH: Record<string, { dot: string; txt: string; label: string }> = {
  healthy: { dot: "bg-green-500", txt: "text-green-600", label: "Healthy" },
  warning: { dot: "bg-amber-500", txt: "text-amber-600", label: "Warning" },
  degraded: { dot: "bg-red-500", txt: "text-red-600", label: "Degraded" },
  not_monitored: { dot: "bg-gray-300", txt: "text-gray-400", label: "Not monitored" },
};

function Panel({ title, href, linkLabel, children, className = "" }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`${card} p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[13px] uppercase tracking-wide">{title}</h2>
        {href && <Link href={href} className="text-xs text-teal-700 hover:underline shrink-0">{linkLabel ?? "View all"} →</Link>}
      </div>
      {children}
    </div>
  );
}

export default async function ExecutiveCommandCentre({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range } = await searchParams;
  const rangeDays = [7, 30, 90].includes(Number(range)) ? Number(range) : 30;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const ec = await loadExecutiveCommand(admin, rangeDays);
  const { banner, attention, health, decisionQueue, intelligence, growth, metrics, spark } = ec;
  const bannerTone = banner.health === "Operational" ? { txt: "text-green-400", bg: "bg-green-500/15", icon: "✓" }
    : banner.health === "Attention" ? { txt: "text-amber-400", bg: "bg-amber-500/15", icon: "!" }
    : { txt: "text-red-400", bg: "bg-red-500/15", icon: "!" };

  const bannerTiles = [
    { icon: "🏢", n: banner.enterprises, label: "Enterprises" },
    { icon: "🏛️", n: banner.organisations, label: "Organisations" },
    { icon: "🏥", n: banner.facilities, label: "Facilities" },
    { icon: "👥", n: banner.users, label: "Users" },
  ];
  const console_ = [
    { label: "Approve Enterprise", desc: "Review new registrations", icon: "🏢", href: "/super-admin/enterprise/organisations" },
    { label: "Publish Framework", desc: "Publish to organisations", icon: "📐", href: "/super-admin/content" },
    { label: "Publish CPU", desc: "Publish practice units", icon: "🧩", href: "/super-admin/studio" },
    { label: "Deploy Release", desc: "Deploy platform release", icon: "🚀", href: "/platform/control-plane" },
    { label: "Create Organisation", desc: "Create new organisation", icon: "🏛️", href: "/super-admin/enterprise/organisations" },
    { label: "Run Health Check", desc: "Platform diagnostics", icon: "🩺", href: "/super-admin/command-centre" },
    { label: "Open Security Centre", desc: "Security operations", icon: "🛡️", href: "/super-admin/audit" },
    { label: "Open AI Operations", desc: "AI operations centre", icon: "🧠", href: "/super-admin/assistant" },
  ];
  const sparkOf = (label: string) => label === "Assessment Volume" ? spark.assessments : null;

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Command Centre</h1>
          <p className="text-sm text-gray-500">Real-time platform overview, executive decisions and strategic oversight.</p>
        </div>
      </div>

      <ExecutiveContextBar rangeDays={rangeDays} generatedAt={ec.generatedAt} />

      {/* 1) Platform status banner */}
      <div className="rounded-2xl bg-[#0f1923] text-white p-5">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-center">
          <div className="md:col-span-2 flex items-center gap-3">
            <span className={`w-12 h-12 rounded-full ${bannerTone.bg} flex items-center justify-center ${bannerTone.txt} text-2xl`}>{bannerTone.icon}</span>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Competen Platform Status</p>
              <p className={`text-2xl font-bold ${bannerTone.txt}`}>{banner.health}</p>
              <p className="text-[11px] text-slate-400">{banner.note}</p>
            </div>
          </div>
          {bannerTiles.map(t => (
            <div key={t.label} className="flex items-center gap-2.5">
              <span className="text-lg opacity-80">{t.icon}</span>
              <div><p className="text-xl font-bold tabular-nums">{fmt(t.n)}</p><p className="text-[10px] text-slate-400">{t.label}</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* 2) Executive attention */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-semibold text-gray-900 uppercase tracking-wide">Executive Attention</h2>
          <Link href="/super-admin/workflows" className="text-xs text-teal-700 hover:underline">View all issues →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {attention.map(a => (
            <Link key={a.key} href={a.href} className={`rounded-xl border p-4 ${a.n ? TONE_BG[a.tone] : "bg-white border-gray-200"} hover:opacity-90 transition-opacity`}>
              <p className={`text-2xl font-bold tabular-nums ${a.n == null ? "text-gray-300" : a.n ? TONE[a.tone] : "text-gray-900"}`}>{a.n == null ? "—" : a.n}</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5">{a.label}</p>
              <p className="text-[10px] text-gray-400">{a.sub}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* 3) Platform health · Decision queue · Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Platform Health" href="/super-admin/enterprise" linkLabel="All services">
          <div className="space-y-1">
            {health.map(h => { const hc = HEALTH[h.status] ?? HEALTH.not_monitored; return (
              <Link key={h.name} href={h.href} className="flex items-center gap-2 py-1.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg group">
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{h.name}</p><p className="text-[10px] text-gray-400 truncate">{h.desc}</p></div>
                {h.alerts > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5">{h.alerts}</span>}
                <span className={`inline-flex items-center gap-1.5 text-[11px] shrink-0 ${hc.txt}`}><span className={`w-1.5 h-1.5 rounded-full ${hc.dot}`} />{hc.label}</span>
              </Link>
            ); })}
          </div>
        </Panel>

        <Panel title="Executive Decision Queue" href="/super-admin/workflows" linkLabel="View all queue">
          <div className="space-y-1">
            {decisionQueue.map(d => (
              <Link key={d.key} href={d.href} className="flex items-center gap-3 py-1.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{d.label}</p><p className="text-[10px] text-gray-400 truncate">{d.desc}</p></div>
                {d.n == null ? <span className="text-[10px] text-gray-300 shrink-0">n/a</span>
                  : <span className={`text-sm font-bold tabular-nums shrink-0 w-7 text-center rounded ${d.n ? "bg-teal-50 text-teal-700" : "text-gray-300"}`}>{d.n}</span>}
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Cross-Platform Intelligence" href="/super-admin/enterprise" linkLabel="View insights">
          <div className="space-y-2.5">
            {intelligence.map((ins: any, i: number) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="text-sm mt-0.5">{ins.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-gray-700 leading-snug">{ins.text}</p>
                  <span className={`text-[9px] font-medium ${TONE[ins.tone] ?? "text-gray-400"}`}>{ins.tag}</span>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-50">AI predictive insights (completion forecasts, adoption opportunities) activate when the intelligence engine is connected. Signals above are live platform data.</p>
          </div>
        </Panel>
      </div>

      {/* 4) Enterprise growth · Key metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Enterprise Growth · Last ${rangeDays} days`}>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {growth.map(g => (
              <div key={g.label} className="rounded-lg border border-gray-100 py-3 text-center">
                <div className="text-base">{g.icon}</div>
                <p className="text-lg font-bold text-gray-900 tabular-nums mt-0.5">{g.n == null ? "—" : fmt(g.n)}</p>
                <p className="text-[9px] text-gray-500 leading-tight">{g.label}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title={`Key Platform Metrics · Last ${rangeDays} days`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {metrics.map(m => (
              <div key={m.label} className="rounded-lg border border-gray-100 p-3">
                <p className={`text-lg font-bold tabular-nums ${m.real ? "text-gray-900" : "text-gray-400"}`}>{m.value}</p>
                <p className="text-[10px] text-gray-500 leading-tight">{m.label}</p>
                {sparkOf(m.label) ? <div className="mt-1"><Sparkline data={sparkOf(m.label)!} color="#14b8a6" /></div> : !m.real ? <p className="text-[9px] text-gray-300 mt-1">not monitored</p> : null}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* 5) Executive command console */}
      <div className={`${card} p-5`}>
        <h2 className="text-[13px] font-semibold text-gray-900 uppercase tracking-wide mb-3">Executive Command Console</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
          {console_.map(a => (
            <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <span className="text-lg">{a.icon}</span>
              <span className="text-[11px] font-semibold text-gray-700 leading-tight">{a.label}</span>
              <span className="text-[9px] text-gray-400 leading-tight">{a.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Executive situation room — summarises every platform without duplicating it; each action launches the owning workspace. Panels marked “not monitored / n/a” activate when their platform (security events, AI serving, deploy pipeline, uptime) is connected. The full dashboard context bar (Enterprise / Region / Compare / Saved Views) activates with CPF-001.</p>
    </div>
  );
}
