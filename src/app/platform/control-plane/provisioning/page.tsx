import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";
import ProvisionForm from "./ProvisionForm";

export const dynamic = "force-dynamic";

// Tenant Provisioning Engine (LCP-001 §2).
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function ProvisioningPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");

  let templates: { code: string; name: string; departments: number; plan: string }[] = [];
  let ready = false;
  try {
    const { data } = await caller.admin.from("plat_org_templates").select("code, name, spec").eq("is_active", true).order("code");
    templates = (data ?? []).map((t: any) => ({
      code: t.code, name: t.name,
      departments: Array.isArray(t.spec?.default_departments) ? t.spec.default_departments.length : 0,
      plan: t.spec?.plan ?? "starter",
    }));
    ready = templates.length > 0;
  } catch { /* pre-migration */ }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Provisioning</h1>
        <p className="text-sm text-gray-500 mt-1">One action creates a tenant, its organisation, primary facility, default departments and subscription — idempotent, with rollback on failure.</p>
      </div>

      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to load provisioning templates and enable the engine.</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <ProvisionForm templates={templates} />
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Available templates</h3>
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.code} className="flex items-center gap-3 text-sm border border-gray-100 rounded-lg px-3 py-2">
                  <span className="font-medium text-gray-800 flex-1">{t.name}</span>
                  <span className="text-xs text-gray-400">{t.departments} depts</span>
                  <span className="text-[10px] font-mono bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">{t.plan}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Templates are defined in <code className="font-mono">plat_org_templates</code>. Every provisioning action is recorded to the Audit Centre.</p>
          </div>
        </div>
      )}
    </div>
  );
}
