import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadAiOps } from "@/lib/platform/phase3";

export const dynamic = "force-dynamic";

// AI Operations (AIS-001).
const card = "bg-white rounded-xl border border-gray-200 p-5";
const provLabel = (p: string | null) => (p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : p === "gemini" ? "Gemini" : p ?? "—");

export default async function AiOpsPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const ai = await loadAiOps(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Operations</h1>
        <p className="text-sm text-gray-500 mt-1">Model provider status and platform-wide AI usage.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><div className={`text-3xl font-bold ${ai.live ? "text-green-600" : "text-gray-400"}`}>{ai.live ? "Live" : "Off"}</div><div className="text-xs text-gray-500 mt-1">Operational status</div></div>
        <div className={card}><div className="text-lg font-bold text-gray-900">{provLabel(ai.provider)}</div><div className="text-xs text-gray-500 mt-1">Provider</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{ai.events30d}</div><div className="text-xs text-gray-500 mt-1">AI events (30d)</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{ai.eventsTotal}</div><div className="text-xs text-gray-500 mt-1">AI events (all time)</div></div>
      </div>
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-2">Provider status</h3>
        {ai.live ? (
          <p className="text-sm text-green-700">✅ AI operational — Anthropic configured and wired end-to-end. {ai.events30d} AI-assisted actions in the last 30 days.</p>
        ) : ai.configured ? (
          <p className="text-sm text-amber-700">⚠️ A {provLabel(ai.provider)} key is present but not wired end-to-end; AI features report as not configured until a supported provider (Anthropic) is set.</p>
        ) : (
          <p className="text-sm text-gray-500">No model provider configured — AI features are disabled platform-wide.</p>
        )}
        <p className="text-[11px] text-gray-400 mt-3">Configure providers &amp; models in <Link href="/super-admin/studio" className="text-violet-600 hover:underline">Studio</Link>. Per-tenant token budgets, prompt libraries and cost governance are a later phase.</p>
      </div>
    </div>
  );
}
