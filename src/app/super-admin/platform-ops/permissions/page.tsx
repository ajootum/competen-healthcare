import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PermissionDesigner from "./PermissionDesigner";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Role, Permission & Visibility Designer (NCP-008) — the no-code security composer over governed PERMISSION
// objects authored in the Configuration Studio. Grants (RBAC allow/deny) + ABAC visibility rules + inheritance,
// with a live policy simulation. Persists onto object.definition (migration 094) and wires inherited sets into
// dependencies. The authorization runtime, visibility resolver, delegation + approval engines are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PermissionsBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: perms, error } = await admin.from("configuration_registry_objects")
    .select("object_key, object_type, display_name, description, status, definition")
    .eq("object_type", "PERMISSION").order("updated_at", { ascending: false }).limit(500);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const listP = (perms ?? []) as any[];
  const withGrants = listP.filter(p => (p.definition?.grants?.length ?? 0) > 0).length;
  const withRules = listP.filter(p => (p.definition?.rules?.length ?? 0) > 0).length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Role, Permission &amp; Visibility Designer</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🔐</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Role, Permission &amp; Visibility Designer <span className="text-gray-500 font-medium text-lg">(NCP-008)</span></h1>
          <p className="text-sm text-gray-500">Compose permission sets from RBAC grants and ABAC visibility rules, then simulate effective access for any context.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Permission object in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Permission Sets" value={listP.length} sub="governed in the registry" />
        <Stat label="With Grants" value={withGrants} tone="text-[var(--cmp-text-success)]" sub="RBAC configured" />
        <Stat label="With Visibility Rules" value={withRules} tone={withRules ? "text-[var(--cmp-text-information)]" : undefined} sub="ABAC-scoped" />
      </div>
      <PermissionDesigner permissions={listP} />
      <p className="text-[11px] text-gray-500">Grants + rules + inheritance persist onto the object (inherited sets become PERMISSION_REF dependencies). The authorization runtime (&lt;20ms decisions), visibility resolver, field masking, delegated administration and dual-approval publishing (NCP-008 §3/§8/§10) are next-phase.</p>
    </div>
  );
}
