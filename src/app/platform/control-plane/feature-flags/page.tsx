import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadFeatureFlags } from "@/lib/platform/feature-flags";
import FlagAssign from "./FlagAssign";

export const dynamic = "force-dynamic";

// Feature Flag Management (LCP-001 §9).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function FeatureFlagsPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, flags } = await loadFeatureFlags(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
        <p className="text-sm text-gray-500 mt-1">Enable or disable modules per tenant, country, plan or cohort. Precedence: tenant › cohort › plan › country › global.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to load the flag catalogue.</div>
      ) : (
        <div className={card}>
          <div className="space-y-2">
            {flags.length === 0 && <p className="text-sm text-gray-400">No flags defined.</p>}
            {flags.map((f: any) => (
              <div key={f.key} className="flex items-start gap-3 border border-gray-100 rounded-lg px-4 py-3">
                <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${f.default_on ? "bg-green-500" : "bg-gray-300"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium text-gray-800">{f.key}</span>
                    {f.product_name && <span className="text-[10px] bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">{f.product_name}</span>}
                    <span className="text-[10px] text-gray-400">default {f.default_on ? "on" : "off"}</span>
                  </div>
                  {f.description && <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>}
                  {f.assignments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {f.assignments.map((a: any, i: number) => (
                        <span key={i} className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${a.enabled ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                          {a.scope_type}{a.scope_ref ? `:${a.scope_ref.slice(0, 12)}` : ""} {a.enabled ? "on" : "off"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <FlagAssign flagKey={f.key} />
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-400">Evaluated in code via <code className="font-mono">flagEnabled(admin, key, &#123;tenantId, planCode, country&#125;)</code>. Use <b>+ assign</b> to scope a flag to a tenant, plan, country or cohort — most-specific wins.</p>
    </div>
  );
}
