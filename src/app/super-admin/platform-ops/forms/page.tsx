import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import FormDesigner from "./FormDesigner";
import { Stat } from "../_kit";
import { requireHqCapability } from "@/lib/hq/context";

export const dynamic = "force-dynamic";

// Form & Data-Capture Builder (NCP-003) — the field designer on top of the governed FORM objects authored in
// the Configuration Studio. Add/edit/reorder fields (28 types) + required + options, with a live preview;
// persists the field metadata onto the object's `definition` (migration 094). Conditional logic, validation
// rules, workflow binding, offline capture and the runtime form renderer are honest next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function FormsBuilder() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.operations.view");

  const { data: forms, error } = await admin.from("configuration_registry_objects")
    .select("object_key, display_name, description, status, definition")
    .eq("object_type", "FORM").order("updated_at", { ascending: false }).limit(500);
  const notReady = !!(error && /does not exist|schema cache/i.test(error.message ?? ""));
  const list = (forms ?? []) as any[];
  const withFields = list.filter(f => (f.definition?.fields?.length ?? 0) > 0).length;

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Form & Data-Capture Builder</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">📝</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Form &amp; Data-Capture Builder <span className="text-gray-500 font-medium text-lg">(NCP-003)</span></h1>
          <p className="text-sm text-gray-500">Design the fields of each governed form — types, required flags and options — with a live preview of the rendered form.</p>
        </div>
      </div>
    </>
  );

  if (notReady) return <div className="space-y-5 max-w-6xl">{header}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 092 (registry) + 094 (object definition), then author a Form in the <Link href="/super-admin/platform-ops/studio" className="underline">Configuration Studio</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-6xl">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Form Objects" value={list.length} sub="governed in the registry" />
        <Stat label="With Fields" value={withFields} tone="text-[var(--cmp-text-success)]" sub="designed" />
        <Stat label="Awaiting Design" value={list.length - withFields} tone={list.length - withFields ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-success)]"} sub="no fields yet" />
      </div>
      <FormDesigner forms={list} />
      <p className="text-[11px] text-gray-500">Fields persist onto the form object&apos;s definition. Conditional logic, validation rules, e-signatures, workflow binding, offline capture and the runtime form renderer (NCP-003 §6/§7/§8) are next-phase.</p>
    </div>
  );
}
