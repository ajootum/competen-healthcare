import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CopilotChat, { type PinnedResource } from "./CopilotChat";
import { loadCopilotHub } from "@/lib/copilot-hub";
import { aiStatus } from "@/lib/ai/config";

// PW-009 Personal AI Copilot — the streaming clinical chat (existing CopilotChat → /api/copilot) wrapped in the
// PW-009 command surface: real AI-usage KPIs (plat_ai_requests), rule-based AI insights + AI-prioritised tasks,
// recommendations and recent AI activity, all from real signals. Voice/attachments/conversation persistence need
// infra that doesn't exist yet — omitted, not faked; "time saved" has no basis and isn't shown.
export const dynamic = "force-dynamic";

const TONE: Record<string, string> = { violet: "bg-violet-50 border-violet-100", amber: "bg-amber-50 border-amber-100", rose: "bg-rose-50 border-rose-100", blue: "bg-blue-50 border-blue-100", emerald: "bg-emerald-50 border-emerald-100" };
const QUICK = [
  { icon: "📄", label: "Summarise a document", prompt: "Summarise the key points from a clinical policy or guideline." },
  { icon: "🗒️", label: "Draft SBAR handover", prompt: "Help me draft an SBAR handover for a patient." },
  { icon: "✅", label: "Create a checklist", prompt: "Create a patient education checklist." },
  { icon: "💡", label: "Explain a topic", prompt: "Explain a clinical topic in simple terms." },
  { icon: "🎓", label: "Recommend learning", prompt: "Recommend learning for my competency gaps." },
];
const fmtAgo = (t: string) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Kpi({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className="flex items-center justify-between"><p className="text-[11px] font-medium text-gray-500">{label}</p><span className="opacity-70">{icon}</span></div>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      <p className="text-[10px] text-gray-400">{sub}</p>
    </div>
  );
}

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  const { scenario } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: profile } = await admin.from("profiles").select("full_name, hospital_id").eq("id", user.id).single();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  const [{ data: knowledge }, { data: cases }, d] = await Promise.all([
    admin.from("knowledge_objects").select("id, title, knowledge_type").neq("status", "retired").order("created_at", { ascending: false }).limit(3),
    admin.from("clinical_cases").select("id, title").neq("status", "retired").order("created_at", { ascending: false }).limit(1),
    loadCopilotHub(admin, user.id),
  ]);
  const pinned: PinnedResource[] = [
    ...(knowledge ?? []).map((k: any) => ({ id: k.id, title: k.title, kind: "knowledge" as const, type: k.knowledge_type as string })), // eslint-disable-line @typescript-eslint/no-explicit-any
    ...(cases ?? []).map((c: any) => ({ id: c.id, title: c.title, kind: "case" as const, type: "case study" })), // eslint-disable-line @typescript-eslint/no-explicit-any
  ];
  const ai = aiStatus();

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">Personal Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900">Personal AI Copilot</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your intelligent assistant for clinical practice, learning, productivity and professional growth.</p>
        </div>
        <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium shrink-0 ${ai.configured ? "text-emerald-600 bg-emerald-50" : "text-gray-500 bg-gray-100"}`}><span className={`w-1.5 h-1.5 rounded-full ${ai.configured ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} />{ai.configured ? "Online" : "Not configured"}</span>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="✨" label="Copilot Usage" value={d.kpis.usage30} sub="Last 30 days" />
        <Kpi icon="📖" label="Knowledge Queries" value={d.kpis.queries} sub="All time" />
        <Kpi icon="🎯" label="Accuracy" value={d.kpis.accuracy === null ? "—" : `${d.kpis.accuracy}%`} sub={d.kpis.accuracy === null ? "No usage yet" : "Successful responses"} />
        <Kpi icon="☑️" label="Tasks Prioritised" value={d.kpis.prioritised} sub="Open tasks" />
        <Kpi icon="📚" label="Learning Support" value={d.kpis.learning} sub="Active courses" />
        <Kpi icon="🗂️" label="Knowledge Base" value={d.kpis.knowledge} sub="Governed articles" />
      </div>

      <div className="grid lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-5 items-start">
        {/* Left: quick actions + recent activity */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-1.5">
              {QUICK.map(a => (
                <Link key={a.label} href={`/dashboard/copilot?scenario=${encodeURIComponent(a.prompt)}`} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-gray-700 hover:bg-blue-50 hover:text-blue-700"><span>{a.icon}</span>{a.label}</Link>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent AI Activity</h3>
            {d.recentOps.length > 0 ? (
              <div className="space-y-2">
                {d.recentOps.map((r: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <div key={i} className="flex items-center gap-2"><span className="text-blue-400 text-xs">✦</span><div className="min-w-0"><p className="text-[12px] text-gray-700 capitalize truncate">{r.op}</p><p className="text-[10px] text-gray-400">{fmtAgo(r.at)}</p></div></div>
                ))}
              </div>
            ) : <p className="text-[12px] text-gray-400 py-3 text-center">Your AI activity will appear here. Conversations are session-based.</p>}
          </div>
        </div>

        {/* Center: chat */}
        <div>
          <div className="mb-2 text-sm text-gray-600">Hello <span className="font-semibold">{firstName}</span> 👋 — how can I help you today?</div>
          <CopilotChat pinned={pinned} autoPrompt={scenario ?? null} />
        </div>

        {/* Right: insights + prioritised tasks + recommended */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">AI Insights For You</h3>
            <div className="space-y-2">
              {d.insights.map((ins: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                <div key={i} className={`rounded-lg border p-2.5 ${TONE[ins.tone] ?? "bg-gray-50 border-gray-100"}`}>
                  <p className="text-[12px] font-semibold text-gray-800">{ins.icon} {ins.title}</p>
                  <p className="text-[11px] text-gray-600 leading-snug mt-0.5">{ins.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">My Tasks (AI Prioritised)</h3><Link href="/dashboard/tasks" className="text-[11px] font-medium text-blue-600 hover:underline">All →</Link></div>
            {d.tasks.length > 0 ? (
              <div className="space-y-2">
                {d.tasks.map((t: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <Link key={t.id} href="/dashboard/tasks" className="flex items-center gap-2 group">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.priority === "high" ? "#f43f5e" : t.priority === "medium" ? "#f59e0b" : "#94a3b8" }} />
                    <span className="flex-1 text-[12px] text-gray-700 group-hover:text-blue-700 truncate">{t.title}</span>
                    {t.overdue && <span className="text-[10px] font-medium text-rose-600 shrink-0">Overdue</span>}
                  </Link>
                ))}
              </div>
            ) : <p className="text-[12px] text-gray-400 py-3 text-center">No open tasks. 🎉</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Recommended by Copilot</h3>
            {d.recommended.length > 0 ? (
              <div className="space-y-2">
                {d.recommended.map((r: any, i: number) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <Link key={i} href={r.href} className="block border border-gray-100 rounded-lg p-2.5 hover:border-blue-200 hover:bg-blue-50/40">
                    <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">{r.kind}</p>
                    <p className="text-[12px] font-medium text-gray-800 leading-snug line-clamp-2">{r.title}</p>
                  </Link>
                ))}
              </div>
            ) : <p className="text-[12px] text-gray-400 py-3 text-center">No recommendations right now.</p>}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Usage &amp; accuracy are your real AI-gateway history. Insights, prioritised tasks and recommendations derive from your live records. AI responses can be imprecise — verify critical information.</p>
    </div>
  );
}
