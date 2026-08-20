import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import TestCentre from "./TestCentre";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Configuration Testing & Simulation Centre (NCP-012) — no-code test suites that assert expected outcomes against
// live config objects (schema/dependency/metric/rule/permission/status), executed server-side, gating promotion.
// Sandbox provisioning, synthetic data and load testing (NCP-012 §4/§6) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function TestingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: suites, error } = await admin.from("configuration_test_suites")
    .select("suite_key, name, description, cases, last_run, status").order("updated_at", { ascending: false }).limit(500);
  const { data: objects } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name").order("object_type").order("display_name").limit(2000);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const listS = (suites ?? []) as any[];
  const passing = listS.filter(s => s.status === "passing").length;
  const cases = listS.reduce((n, s) => n + (s.cases?.length ?? 0), 0);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Testing &amp; Simulation</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🧪</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Testing &amp; Simulation <span className="text-gray-500 font-medium text-lg">(NCP-012)</span></h1>
          <p className="text-sm text-gray-500">Author test suites that assert outcomes against live configuration — executed server-side, gating promotion.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 097 (test suites), then author a suite here.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Test Suites" value={listS.length} sub="governed test coverage" />
        <Stat label="Passing" value={passing} tone="text-[var(--cmp-text-success)]" sub="gate promotable" />
        <Stat label="Test Cases" value={cases} sub="across all suites" />
      </div>
      <TestCentre suites={listS} objects={(objects ?? []) as any[]} />
      <p className="text-[11px] text-gray-500">Six test types execute against the live object definitions (schema conformance, dependency safety, metric RAG, rule decision, permission policy, object status). Sandbox provisioning, synthetic-data generation, performance/load testing and CI integration (NCP-012 §4/§6) are next-phase.</p>
    </div>
  );
}
