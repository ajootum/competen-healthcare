import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRegistry, OBJECT_TYPE_LABEL } from "@/lib/config/registry";
import StudioForm from "./StudioForm";

export const dynamic = "force-dynamic";

// Configuration Studio — no-code authoring of governed configuration objects (of any builder type). The shared
// create-surface the NCP-001..011 builders sit on: author an object → it lands in the WCE-002 registry as a
// draft → a WCE-004 change request is raised → it publishes only through governance + the dependency gate.
// Type-specific visual designers (form fields, metric formulas, workflow nodes) are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const STATUS_TONE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", technical_review: "bg-sky-50 text-sky-700", product_review: "bg-sky-50 text-sky-700", safety_review: "bg-amber-50 text-amber-700", approved: "bg-indigo-50 text-indigo-700", active: "bg-emerald-50 text-emerald-700", published: "bg-emerald-50 text-emerald-700" };

export default async function ConfigurationStudio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const reg: any = await loadRegistry(admin);
  const provisioned = reg.provisioned;
  const objects: any[] = provisioned ? reg.objects : [];
  const existingKeys = objects.map(o => o.object_key);
  const sources = [...new Set(objects.map(o => o.data_source_key).filter(Boolean))] as string[];
  const drafts = objects.filter(o => o.source === "studio").sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))).slice(0, 12);

  const header = (
    <>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/platform-ops" className="hover:text-gray-600">Platform Operations</Link><span>/</span>
        <Link href="/super-admin/platform-ops/no-code-platform" className="hover:text-gray-600">No-Code Platform</Link><span>/</span>
        <span className="text-gray-700 font-medium">Configuration Studio</span>
      </div>
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-xl">🛠️</span>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration Studio</h1>
          <p className="text-sm text-gray-500">No-code authoring of governed configuration objects — the shared create-surface behind every NCP builder (NCP-001…011). New objects are governed &amp; dependency-gated from birth.</p>
        </div>
      </div>
    </>
  );

  if (!provisioned) return <div className="space-y-5 max-w-5xl">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Registry not provisioned</p><p className="text-sm text-amber-800 mt-1">Authoring writes to the Configuration Registry. Apply migration 092 and run <Link href="/super-admin/platform-ops/registry" className="underline">Sync from catalogue</Link>.</p></div></div>;

  return (
    <div className="space-y-5 max-w-5xl">
      {header}
      <StudioForm existingKeys={existingKeys} sources={sources} />

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-sm">Studio-authored objects <span className="text-gray-300 font-normal">({drafts.length})</span></h2>
          <Link href="/super-admin/platform-ops/registry" className="text-[11px] text-indigo-700 hover:underline">Open Registry →</Link>
        </div>
        {drafts.length ? (
          <div className="divide-y divide-gray-50">
            {drafts.map(o => (
              <div key={o.object_key} className="flex items-center gap-2 py-2">
                <span className="text-[9px] font-semibold rounded px-1.5 py-0.5 bg-gray-100 text-gray-500 shrink-0">{OBJECT_TYPE_LABEL[o.object_type] ?? o.object_type}</span>
                <div className="flex-1 min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{o.display_name}</p><p className="text-[10px] text-gray-400 font-mono truncate">{o.object_key}</p></div>
                <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${STATUS_TONE[o.status] ?? "bg-gray-100 text-gray-500"}`}>{String(o.status).replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400 py-6 text-center">No objects authored here yet. Create one above — it will appear as a governed draft.</p>}
      </div>

      <p className="text-[11px] text-gray-400">Type-specific visual designers — form fields (NCP-003), metric formulas (NCP-005), workflow nodes (NCP-004), rule tables (NCP-007), layout canvas (NCP-001) — are the next-phase depth on top of this governed authoring core.</p>
    </div>
  );
}
