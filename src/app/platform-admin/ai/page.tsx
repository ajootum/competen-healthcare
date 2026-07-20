import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPlatformAdmin } from "@/lib/platform-admin-data";

export const dynamic = "force-dynamic";

// AI Platform Operations (PSA-011) — AI provider status and platform AI usage.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function AiOpsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadPlatformAdmin(admin);
  const { ai } = d;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">AI Platform Operations</h1>
        <p className="text-sm text-gray-500 mt-1">Provider configuration and platform-wide AI usage.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className={card}><div className={`text-3xl font-bold ${ai.live ? "text-green-600" : "text-gray-400"}`}>{ai.live ? "Live" : "Off"}</div><div className="text-xs text-gray-500 mt-1">Operational status</div></div>
        <div className={card}><div className="text-lg font-bold text-gray-900">{ai.provider ? (ai.provider === "anthropic" ? "Anthropic" : ai.provider === "openai" ? "OpenAI" : ai.provider === "gemini" ? "Gemini" : ai.provider) : "—"}</div><div className="text-xs text-gray-500 mt-1">Configured provider</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{ai.events30d}</div><div className="text-xs text-gray-500 mt-1">AI events (30d)</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-2">Provider status</h3>
        {ai.live ? (
          <p className="text-sm text-green-700">✅ AI is operational — a supported model provider (Anthropic) is configured and wired end-to-end. {ai.events30d} AI-assisted actions were recorded in the last 30 days.</p>
        ) : ai.configured ? (
          <p className="text-sm text-amber-700">⚠️ A provider key is present but not wired end-to-end. AI-assisted features will report as not configured until a supported provider (Anthropic) is set.</p>
        ) : (
          <p className="text-sm text-gray-500">No model provider key is configured, so AI-assisted features are disabled platform-wide.</p>
        )}
        <p className="text-[11px] text-gray-400 mt-3">Configure the provider and models under <Link href="/super-admin/studio" className="text-rose-600 hover:underline">Studio</Link>. Per-tenant AI budgets, model routing and cost governance are a later PSA phase.</p>
      </div>
    </div>
  );
}
