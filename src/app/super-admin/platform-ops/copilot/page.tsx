import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { aiStatus } from "@/lib/ai/config";
import Copilot from "./Copilot";

export const dynamic = "force-dynamic";

// AI Configuration Copilot (NCP-014) — natural language → ONE governed, schema-validated configuration artifact,
// authored through the normal Studio path (never writes to production). Conversation history, multi-artifact
// generation and AI simulation (NCP-014 §4/§8/§10) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";

export default async function CopilotPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const configured = aiStatus().configured;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">AI Configuration Copilot</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">✨</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI Configuration Copilot <span className="text-gray-300 font-medium text-lg">(NCP-014)</span></h1>
          <p className="text-sm text-gray-500">Describe configuration in plain English — the copilot proposes a schema-valid, governed artifact you review before authoring.</p>
        </div>
      </div>

      <div className={`${card} p-4`}>
        <p className="text-[11px] text-gray-500"><span className="font-semibold text-gray-700">Governance-first.</span> The copilot never writes to production. It converts your request into one configuration object mapped to the registry schema, validates it, and — only when you approve — authors it as a <b>draft</b> that passes through governance, the dependency gate and version history exactly like a hand-built object.</p>
      </div>

      <Copilot configured={configured} />

      <p className="text-[11px] text-gray-400">Every generation is logged by the AI Runtime Gateway (tokens/latency/cost). Conversation history, multi-object generation, AI-driven simulation and prompt libraries (NCP-014 §4/§8/§10) are next-phase.</p>
    </div>
  );
}
