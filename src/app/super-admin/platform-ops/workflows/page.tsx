import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import WorkflowBuilder from "./WorkflowBuilder";

export const dynamic = "force-dynamic";

// Workflow & Automation Builder (NCP-004) — the node/transition designer on top of the governed WORKFLOW
// objects authored in the Configuration Studio. Compose typed nodes + transitions with a readable flow;
// persists onto object.definition (migration 094). The workflow runtime engine, SLA/escalation execution,
// retries, integrations and monitoring are honest next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function WorkflowsBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { data: workflows, error } = await admin.from("configuration_registry_objects")
    .select("object_key, display_name, description, status, definition")
    .eq("object_type", "WORKFLOW").order("updated_at", { ascending: false }).limit(500);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const list = (workflows ?? []) as any[];
  const withFlow = list.filter(w => (w.definition?.nodes?.length ?? 0) > 0).length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Workflow & Automation Builder</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🔀</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workflow &amp; Automation Builder <span className="text-gray-300 font-medium text-lg">(NCP-004)</span></h1>
          <p className="text-sm text-gray-500">Compose each governed workflow from typed nodes (task, decision, approval, timer, notification, integration, AI) and transitions.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Workflow in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Workflow Objects" value={list.length} sub="governed in the registry" />
        <Stat label="With Flow" value={withFlow} tone="text-emerald-600" sub="nodes composed" />
        <Stat label="Awaiting Design" value={list.length - withFlow} tone={list.length - withFlow ? "text-amber-600" : "text-emerald-600"} sub="no nodes yet" />
      </div>
      <WorkflowBuilder workflows={list} />
      <p className="text-[11px] text-gray-400">Nodes + transitions persist onto the workflow object. The runtime workflow engine, SLA/escalation execution, retries, checkpoints, live integrations and monitoring (NCP-004 §6/§7) are next-phase.</p>
    </div>
  );
}
