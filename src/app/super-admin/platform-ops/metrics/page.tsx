import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import MetricEditor from "./MetricEditor";
import { listDataFunctions } from "@/lib/config/metric-runtime";

export const dynamic = "force-dynamic";

// Metrics & Indicator Builder (NCP-005) — the type-specific formula/threshold designer on top of the governed
// METRIC objects authored in the Configuration Studio. Persists the formula, aggregation, target, RAG
// thresholds and direction onto the object's `definition` (migration 094), with live formula validation and
// dependency wiring. Real calculation runtime + benchmarking + AI narrative are honest next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function MetricsBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { data: metrics, error } = await admin.from("configuration_registry_objects")
    .select("object_key, display_name, description, data_source_key, status, definition")
    .eq("object_type", "METRIC").order("updated_at", { ascending: false }).limit(500);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const list = (metrics ?? []) as any[];
  const defined = list.filter(m => m.definition?.formula).length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Metrics & Indicator Builder</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">📐</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Metrics &amp; Indicator Builder <span className="text-gray-300 font-medium text-lg">(NCP-005)</span></h1>
          <p className="text-sm text-gray-500">Define the formula, aggregation, target and RAG thresholds for each governed metric — validated live and persisted onto the object.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Metric in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Metric Objects" value={list.length} sub="governed in the registry" />
        <Stat label="With Formula" value={defined} tone="text-[var(--cmp-text-success)]" sub="definition complete" />
        <Stat label="Awaiting Definition" value={list.length - defined} tone={list.length - defined ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} sub="need a formula" />
      </div>
      <MetricEditor metrics={list} />

      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-1">Live data functions <span className="font-normal text-gray-400">· reference these in a formula for a computed value</span></p>
        <p className="text-[10px] text-gray-400 mb-2">A formula using only these tokens (and arithmetic + round/abs/min/max/avg/sum/pct/ratio) computes a real, hospital-scoped value at runtime — e.g. <span className="font-mono text-gray-500">pct(open_escalations, patients)</span>.</p>
        <div className="flex flex-wrap gap-1.5">{listDataFunctions().map(f => <span key={f.name} className="text-[10px] bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5"><span className="font-mono text-indigo-600">{f.name}</span> <span className="text-gray-400">· {f.label}</span></span>)}</div>
      </div>

      <p className="text-[11px] text-gray-400">The formula + thresholds persist onto the metric object and its references wire into the dependency graph. The <b>live calculation runtime</b> now computes values from the data functions above (visible on metadata-driven surfaces via the Runtime Engine); historical snapshots, benchmarking and AI narrative (NCP-005 §6/§9) remain next-phase.</p>
    </div>
  );
}
