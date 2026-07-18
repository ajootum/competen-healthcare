import { requireAnalyticsAccess } from "@/lib/analytics";
import { createAdminClient } from "@/lib/supabase/server";
import { AiHeader } from "../ui";

// AI Assistant History — your AI interactions from the audit trail (every AI
// action is logged with model + token usage). Chat transcripts are not stored,
// and that is stated rather than simulated.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ q?: string }>;

const ACTION_UI: Record<string, { icon: string; label: string }> = {
  ai_assistant_query: { icon: "💬", label: "CKCM assistant query" },
  ai_coach: { icon: "🎓", label: "Learner development plan" },
  ai_assess_assist: { icon: "📝", label: "In-session assessment assist" },
  ai_osce_design: { icon: "🩺", label: "OSCE station draft" },
  ai_simulation_design: { icon: "🧪", label: "Simulation scenario draft" },
  ai_insights: { icon: "💡", label: "Insight narrative" },
  ai_report: { icon: "📄", label: "Generated report" },
};

export default async function AiHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const { userId } = await requireAnalyticsAccess();
  const { q } = await searchParams;
  const admin = createAdminClient();

  const { data: rows } = await admin.from("audit_log")
    .select("action, entity_name, new_value, created_at")
    .eq("actor_id", userId).like("action", "ai_%")
    .order("created_at", { ascending: false }).limit(100);

  const filtered = (rows ?? []).filter(r => {
    if (!q?.trim()) return true;
    const t = q.trim().toLowerCase();
    const meta = JSON.stringify(r.new_value ?? {}).toLowerCase();
    return r.action.includes(t) || (r.entity_name ?? "").toLowerCase().includes(t) || meta.includes(t) || (ACTION_UI[r.action]?.label.toLowerCase().includes(t) ?? false);
  });

  const totalTokens = (rows ?? []).reduce((s, r) => {
    const u = (r.new_value as { tokens?: { input_tokens?: number; output_tokens?: number } } | null)?.tokens;
    return s + (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0);
  }, 0);

  return (
    <div className="max-w-3xl">
      <AiHeader icon="🕘" title="AI Assistant History" sub="Your AI interactions and generated content — from the platform's audit trail." />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <form action="/assessor/ai/history" className="flex items-center gap-2">
          <input name="q" defaultValue={q ?? ""} placeholder="Search your AI activity…"
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-64 focus:outline-none focus:border-indigo-400" />
          <button type="submit" className="text-sm font-semibold text-white bg-indigo-600 rounded-lg px-3 py-2 hover:bg-indigo-700">Search</button>
        </form>
        <p className="text-[10px] text-gray-400">{(rows ?? []).length} logged actions · ~{totalTokens.toLocaleString()} tokens all-time</p>
      </div>

      {filtered.length ? (
        <div className="space-y-1.5">
          {filtered.map((r, i) => {
            const ui = ACTION_UI[r.action] ?? { icon: "✨", label: r.action.replace("ai_", "").replace(/_/g, " ") };
            const meta = r.new_value as { model?: string; scope?: string; report_type?: string; question?: string; scenario?: string; station?: string } | null;
            const detail = meta?.question ?? meta?.scenario ?? meta?.station ?? meta?.report_type ?? meta?.scope ?? r.entity_name ?? null;
            return (
              <div key={i} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex items-center gap-3">
                <span className="text-base">{ui.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{ui.label}</p>
                  {detail && <p className="text-[10px] text-gray-400 truncate">{detail}</p>}
                </div>
                {meta?.model && <span className="text-[9px] text-gray-300 hidden sm:block">{meta.model}</span>}
                <span className="text-[10px] text-gray-400 shrink-0" suppressHydrationWarning>
                  {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-xs text-gray-400">
          {q ? `Nothing matches “${q}”.` : "No AI activity yet — everything you generate is logged here."}
        </p>
      )}

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: full chat transcripts aren&apos;t stored (copilot conversations are ephemeral by design) — this history is the governed audit
        record of each AI action with its model and token usage.
      </p>
    </div>
  );
}
