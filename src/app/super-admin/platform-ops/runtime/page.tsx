import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import RuntimeResolver from "./RuntimeResolver";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Configuration Runtime & Resolution Engine (NCP-015) — resolves an object's effective settings for a runtime
// context along the inheritance hierarchy with a full precedence trace. Runtime service composition (layout/
// widget/form assembly) + a distributed cache (NCP-015 §6/§7) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";

export default async function RuntimePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: objects } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name").order("object_type").order("display_name").limit(2000);
  const PRECEDENCE = ["platform", "tenant", "hospital", "unit", "role", "user"];

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Runtime &amp; Resolution</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">⚙️</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Runtime &amp; Resolution Engine <span className="text-gray-500 font-medium text-lg">(NCP-015)</span></h1>
          <p className="text-sm text-gray-500">Resolve any object&apos;s effective configuration for a runtime context, with a full precedence trace — the execution core that turns declarative config into behaviour.</p>
        </div>
      </div>

      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Resolution precedence <span className="font-normal text-gray-500">· most specific wins per attribute</span></p>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRECEDENCE.map((s, i) => <span key={s} className="flex items-center gap-1.5"><span className="text-[11px] bg-indigo-50 text-indigo-700 rounded px-2 py-1">{s}</span>{i < PRECEDENCE.length - 1 && <span className="text-gray-500 text-[10px]">→</span>}</span>)}
        </div>
      </div>

      <RuntimeResolver objects={(objects ?? []) as any[]} />
      <p className="text-[11px] text-gray-500">The engine merges the WCE-001 override layers with deterministic precedence, records which layer set each value, and <b>composes</b> pages, dashboards and navigation into the enabled-filtered model a user in that context would actually see. A distributed resolution cache (NCP-015 §7) is next-phase.</p>
    </div>
  );
}
