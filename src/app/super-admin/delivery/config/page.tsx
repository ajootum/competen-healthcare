import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDeliveryConfig } from "@/lib/delivery/config";
import DeliveryConfigForm from "./DeliveryConfigForm";

// CDP-014 — Learning Governance & Delivery Configuration (operator view). The delivery engines used to carry
// hard-coded policy; this surface makes that policy governable and the engines read it at runtime. Real over
// cdp_delivery_config (148). Super-admin, platform-wide. Each control names the engine it steers so the
// operator can see the config is live, not decorative.

export const dynamic = "force-dynamic";

export default async function DeliveryConfigPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadDeliveryConfig(admin);

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-014 · Learning Governance & Delivery Config</p>
          <h1 className="text-xl font-bold text-gray-900">Delivery Policy</h1>
          <p className="text-gray-400 text-sm mt-0.5">The platform-wide delivery rules the runtime engines read live — set the reminder lead time, whether failed assessments auto-remediate, and whether orchestration runs.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">Delivery config isn&apos;t provisioned — apply migration 148 (<code className="text-[11px]">cdp_delivery_config</code>). The engines are running on the built-in defaults until then.</p></div>
      ) : (
        <>
          <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3 mb-5">
            <p className="text-[11px] text-violet-900"><span className="font-bold">Live control.</span> Saving here changes engine behaviour immediately — the orchestrator (CDP-001), reminder scan (CDP-011) and event consumer (CDP-015) resolve this policy on every run. WCE governs workspace composition; this governs delivery.</p>
          </div>
          <DeliveryConfigForm config={q.config} updatedBy={q.updatedBy} updatedAt={q.updatedAt} />
        </>
      )}
    </div>
  );
}
