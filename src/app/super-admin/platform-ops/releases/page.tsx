import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ReleaseManager from "./ReleaseManager";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Configuration Publishing Service (NCP-019) — promote releases of configuration objects through channels
// (dev→qa→uat→pilot→production) with rollout strategy + scheduling and a validate→approve→publish→activate
// pipeline. Canary/phased execution + blue-green activation (NCP-019 §9) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ReleasesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: releases, error } = await admin.from("configuration_releases")
    .select("release_key, name, channel, rollout, scheduled_for, objects, status, validation").order("updated_at", { ascending: false }).limit(500);
  const { data: objects } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name").order("object_type").order("display_name").limit(2000);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const listR = (releases ?? []) as any[];
  const activated = listR.filter(r => r.status === "activated").length;
  const inProd = listR.filter(r => r.channel === "production" && r.status === "activated").length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Publishing Service</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🚀</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Publishing Service <span className="text-gray-500 font-medium text-lg">(NCP-019)</span></h1>
          <p className="text-sm text-gray-500">Promote configuration through release channels with a validate → approve → publish → activate pipeline and rollback.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 099 (releases), then assemble a release here.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Releases" value={listR.length} sub="across all channels" />
        <Stat label="Activated" value={activated} tone="text-[var(--cmp-text-success)]" sub="gone live" />
        <Stat label="In Production" value={inProd} tone={inProd ? "text-[var(--cmp-text-success)]" : undefined} sub="production channel" />
      </div>
      <ReleaseManager releases={listR} objects={(objects ?? []) as any[]} />
      <p className="text-[11px] text-gray-500">Each stage is gated: validate reuses the schema contract + dependency gate; activation flips objects live after snapshotting them, so a release is rollback-capable. Canary/phased execution, blue-green activation and tenant-adoption monitoring (NCP-019 §9/§10) are next-phase.</p>
    </div>
  );
}
