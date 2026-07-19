import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAiIntelligence } from "@/lib/ai-intelligence";
import { WORKSPACES, NODE_POS } from "./workspaces";

// AI & Intelligence Hub — the institution intelligence command centre (spec
// v1.0 + mockup). Dark command-centre theme with 6 live executive KPIs, an
// interactive Institution Intelligence Map, prioritised rule-derived
// recommendations and the 10 Intelligence Workspaces. Every figure is live.

export const dynamic = "force-dynamic";

const hourNow = () => new Date().getHours();
const PRIO_CLS: Record<string, string> = { High: "bg-red-500/20 text-red-300 border-red-500/30", Medium: "bg-amber-500/20 text-amber-300 border-amber-500/30", Low: "bg-sky-500/20 text-sky-300 border-sky-500/30" };

export default async function AiHub() {
  const { admin, hospitalId, name } = await requireEducatorAccess();
  const d = await loadAiIntelligence(admin, hospitalId ?? "");
  const C = d.cards;
  const greeting = hourNow() < 12 ? "Good Morning" : hourNow() < 17 ? "Good Afternoon" : "Good Evening";
  const firstName = name?.split(" ").slice(0, 2).join(" ") ?? "Educator";

  const kpis = [
    { icon: "🧑‍⚕️", label: "Require Intervention", value: C.intervention, tint: "text-rose-400", href: "/educator/at-risk" },
    { icon: "📖", label: "Curricula Require Review", value: C.curriculaReview, tint: "text-orange-400", href: "/educator/studio/curriculum" },
    { icon: "🎯", label: "Insufficient Evidence", value: C.insufficientEvidence, tint: "text-amber-400", href: "/educator/analytics/competency/gaps" },
    { icon: "📋", label: "Awaiting Validation", value: C.awaitingValidation, tint: "text-sky-400", href: "/educator/validations" },
    { icon: "🛡️", label: "Accreditation Risks", value: C.accreditationRisks, tint: "text-fuchsia-400", href: "/educator/analytics/accreditation" },
    { icon: "🧠", label: "AI Recommendations", value: C.recommendations, tint: "text-emerald-400", href: "#recommendations" },
  ];

  return (
    <div className="max-w-[1400px] -mx-4 md:-mx-6 -mt-4 md:-mt-8">
      <div className="bg-[#0a0d24] bg-[radial-gradient(ellipse_at_top,rgba(139,92,246,0.15),transparent_60%)] min-h-screen px-4 md:px-6 py-6 text-slate-200">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-300 via-purple-300 to-fuchsia-300 bg-clip-text text-transparent">AI &amp; Intelligence</h1>
          <p className="text-slate-400 text-sm">Institution Intelligence Hub</p>
        </div>

        {/* Greeting + KPI cards */}
        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-3 mb-5">
          <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-lg shadow-lg shadow-violet-500/30">🧠</span>
            <div>
              <p className="text-[11px] text-slate-400">{greeting}</p>
              <p className="text-sm font-bold text-white">{firstName} 👋</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Your intelligence summary for today.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {kpis.map(k => (
              <Link key={k.label} href={k.href} className="rounded-2xl bg-white/[0.04] border border-white/10 p-3.5 hover:bg-white/[0.07] hover:border-white/20 transition-colors">
                <span className={`text-lg ${k.tint}`}>{k.icon}</span>
                <p className="text-2xl font-extrabold text-white leading-tight mt-1">{k.value}</p>
                <p className="text-[10px] text-slate-400 leading-tight">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* Map + recommendations */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 mb-6 items-stretch">
          {/* Intelligence map */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Institution Intelligence Map</p>
            <div className="relative w-full" style={{ aspectRatio: "16 / 10" }}>
              <svg viewBox="0 0 100 62.5" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                {d.nodes.map(nd => { const p = NODE_POS[nd.id]; return <line key={nd.id} x1="50" y1="31.25" x2={p.x} y2={p.y * 0.625} stroke={nd.color} strokeOpacity="0.35" strokeWidth="0.3" strokeDasharray="1 1" />; })}
              </svg>
              {/* Central AI */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white font-extrabold text-lg shadow-[0_0_40px_rgba(139,92,246,0.6)] ring-4 ring-violet-500/20">AI</div>
              </div>
              {/* Nodes */}
              {d.nodes.map(nd => { const p = NODE_POS[nd.id]; return (
                <Link key={nd.id} href={nd.href} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                  <span className="w-10 h-10 rounded-full flex items-center justify-center text-sm border-2 transition-transform group-hover:scale-110" style={{ borderColor: nd.color, background: `${nd.color}1f`, boxShadow: nd.alert ? `0 0 16px ${nd.color}80` : "none" }}>
                    {nd.id === "learners" ? "👥" : nd.id === "competencies" ? "🎯" : nd.id === "curriculum" ? "📖" : nd.id === "assessments" ? "📋" : nd.id === "educators" ? "🧑‍🏫" : nd.id === "institution" ? "🏛️" : nd.id === "accreditation" ? "🛡️" : "📈"}
                  </span>
                  <span className="text-[10px] font-bold text-white mt-1 whitespace-nowrap">{nd.label}</span>
                  <span className="text-[8px] text-slate-400 whitespace-nowrap">{nd.metric}</span>
                </Link>
              ); })}
            </div>
          </div>

          {/* Recommendations */}
          <div id="recommendations" className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <span>✨</span><p className="text-[11px] font-bold uppercase tracking-widest text-slate-300">AI Recommendations</p>
              <span className="ml-auto text-[8px] font-bold uppercase text-slate-500">rule-derived</span>
            </div>
            <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
              {d.recommendations.map((r, i) => (
                <Link key={i} href={r.href} className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-2.5 hover:bg-white/[0.07] transition-colors">
                  <span className="text-base shrink-0">{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-white leading-tight">{r.title}</span>
                    <span className="block text-[10px] text-slate-400 truncate">{r.reason}</span>
                  </span>
                  <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${PRIO_CLS[r.priority]}`}>{r.priority}</span>
                </Link>
              ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-3">Every recommendation is explainable and links to the live record. AI never auto-approves or closes actions.</p>
          </div>
        </div>

        {/* 10 Intelligence Workspaces */}
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Intelligence Workspaces</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {WORKSPACES.map(w => (
            <Link key={w.n} href={w.href} className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 hover:bg-white/[0.07] hover:border-white/25 transition-all group">
              <span className="text-[10px] font-bold text-slate-500">{w.n}</span>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg my-2 transition-transform group-hover:scale-105" style={{ background: `linear-gradient(135deg, ${w.from}33, ${w.to}33)`, border: `1px solid ${w.from}55` }}>{w.icon}</div>
              <p className="text-[12px] font-bold text-white leading-tight">{w.name}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{w.tagline}</p>
            </Link>
          ))}
        </div>

        <p className="text-[10px] text-slate-500 mt-6">
          The hub synthesises live signals from across the platform. Every KPI and recommendation is computed from real hospital records; each workspace opens the
          live intelligence that powers it. Natural-language chat, task automation and WebSocket live-updates route through the AI Copilot and the platform&apos;s AI endpoints.
        </p>
      </div>
    </div>
  );
}
