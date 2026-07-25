import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MigrationToolkit from "./MigrationToolkit";

export const dynamic = "force-dynamic";

// Configuration Migration Toolkit (NCP-020) — export dependency-closed config bundles and import them with a
// dry-run + dependency-ordered, checkpointed (rollback-capable) apply. Cross-region transfer and cryptographic
// signing (NCP-020 §6/§12) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function MigrationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { data: objects } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name").order("object_type").order("display_name").limit(2000);
  const { data: jobs, error } = await admin.from("configuration_migration_jobs")
    .select("id, job_type, status, object_count, summary, note, created_by_name, created_at").order("created_at", { ascending: false }).limit(50);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const listJ = (jobs ?? []) as any[];
  const imports = listJ.filter(j => j.job_type === "import").length;
  const exports = listJ.filter(j => j.job_type === "export").length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Migration Toolkit</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🚚</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Migration Toolkit <span className="text-gray-300 font-medium text-lg">(NCP-020)</span></h1>
          <p className="text-sm text-gray-500">Move configuration between environments and tenants — export dependency-closed bundles, import with a dry-run and rollback.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 098 (migration jobs), then export or import bundles here.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Bundleable Objects" value={(objects ?? []).length} sub="in the registry" />
        <Stat label="Imports" value={imports} tone="text-indigo-600" sub="applied to this environment" />
        <Stat label="Exports" value={exports} tone="text-sky-600" sub="bundles built" />
      </div>
      <MigrationToolkit objects={(objects ?? []) as any[]} jobs={listJ} />
      <p className="text-[11px] text-gray-400">Exports close over dependencies so bundles are self-contained; imports validate schema + prerequisites, apply in dependency order, snapshot every touched object and are fully rollback-capable. Cross-region transfer, encrypted transfer and cryptographic signing (NCP-020 §6/§12) are next-phase.</p>
    </div>
  );
}
