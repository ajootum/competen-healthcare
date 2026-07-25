import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OBJECT_SCHEMAS } from "@/lib/config/schema";
import SchemaExplorer from "./SchemaExplorer";

export const dynamic = "force-dynamic";

// Configuration Schema & Object Model (NCP-016) — the canonical contract surface. Browse each object type's
// registry envelope + definition shape (the single source of truth the 8 designers enforce) and validate a
// candidate definition live. Schema-version migration + compatibility matrix are next-phase. Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
function Stat({ label, value, tone, sub }: { label: string; value: any; tone?: string; sub?: string }) {
  return <div className={`${card} p-4`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function SchemaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  // Ground the contract with live per-type registry counts.
  const counts: Record<string, number> = {};
  const { data: objs } = await admin.from("configuration_registry_objects").select("object_type").limit(5000);
  for (const o of (objs ?? [])) counts[o.object_type] = (counts[o.object_type] ?? 0) + 1;
  const totalTracked = OBJECT_SCHEMAS.reduce((s, x) => s + (counts[x.type] ?? 0), 0);
  const enumCount = new Set(OBJECT_SCHEMAS.flatMap(s => s.definition.filter(f => f.type === "enum").map(f => f.key))).size;

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Schema &amp; Object Model</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🗂️</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Schema &amp; Object Model <span className="text-gray-300 font-medium text-lg">(NCP-016)</span></h1>
          <p className="text-sm text-gray-500">The canonical contract every configurable object conforms to — the single source of truth the builders, runtime, migration and AI all validate against.</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Object Types" value={OBJECT_SCHEMAS.length} sub="authorable in the Studio" />
        <Stat label="Registry Objects" value={totalTracked} sub="conform to these schemas" />
        <Stat label="Enum Vocabularies" value={enumCount} tone="text-sky-600" sub="controlled value sets" />
      </div>

      <SchemaExplorer schemas={OBJECT_SCHEMAS} counts={counts} />
      <p className="text-[11px] text-gray-400">The schemas here are the portable contract; the live per-type validators in the objects API enforce the same rules at author time. Schema-version migration, the compatibility matrix and signed schema packages (NCP-016 §7/§9) are next-phase.</p>
    </div>
  );
}
