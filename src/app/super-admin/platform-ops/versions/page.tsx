import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import VersionManager from "./VersionManager";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Configuration Versioning & Audit Service (NCP-018) — immutable version snapshots + diff + one-click restore
// over every registry object. Snapshots accrue automatically on each definition save (objects PATCH) plus manual
// capture. Branching, release tagging and cryptographic signing (NCP-018 §6) are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function VersionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: objects } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name").order("object_type").order("display_name").limit(2000);
  const { data: snaps, error } = await admin.from("configuration_version_snapshots").select("object_key, action").limit(20000);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const total = (snaps ?? []).length;
  const tracked = new Set((snaps ?? []).map((s: any) => s.object_key)).size;
  const restores = (snaps ?? []).filter((s: any) => s.action === "restored").length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Versioning &amp; Audit</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🕰️</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Versioning &amp; Audit <span className="text-gray-500 font-medium text-lg">(NCP-018)</span></h1>
          <p className="text-sm text-gray-500">Immutable version history for every configuration object — compare any two versions and restore in one click.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 096 (version snapshots), then snapshots will accrue on every definition save.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Snapshots" value={total} sub="immutable versions" />
        <Stat label="Objects Tracked" value={tracked} tone="text-[var(--cmp-text-success)]" sub="with version history" />
        <Stat label="Restores" value={restores} tone={restores ? "text-[var(--cmp-text-warning)]" : undefined} sub="point-in-time recoveries" />
      </div>
      <VersionManager objects={(objects ?? []) as any[]} />
      <p className="text-[11px] text-gray-500">Snapshots capture the full object state (definition + governance fields) with an integrity checksum; restore writes a past state back and snapshots the restore. Branching, release tagging and cryptographic signing (NCP-018 §6) are next-phase.</p>
    </div>
  );
}
