import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadFeatureFlags, WIRED_GATES } from "@/lib/platform/feature-flags";
import FlagAssign from "./FlagAssign";
import { cardClass } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// Feature Flag Management (LCP-001 §9).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = cardClass;

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
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5 text-sm text-[var(--cmp-text-warning)]">Apply migrations <code className="font-mono text-xs">040–042</code> to load the flag catalogue.</div>
      ) : (
        <div className={card}>
          <div className="space-y-2">
            {flags.length === 0 && <p className="text-sm text-gray-400">No flags defined.</p>}
            {flags.map((f: any) => (
              <div key={f.key} className="flex items-start gap-3 border border-gray-100 rounded-lg px-4 py-3">
                <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${f.default_on ? "bg-[var(--cmp-color-success)]" : "bg-gray-300"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium text-gray-800">{f.key}</span>
                    {f.product_name && <span className="text-[10px] bg-violet-50 text-violet-700 rounded-full px-2 py-0.5">{f.product_name}</span>}
                    <span className="text-[10px] text-gray-400">default {f.default_on ? "on" : "off"}</span>
                    {/* A SWITCH THAT IS WIRED TO NOTHING MUST LOOK LIKE ONE. Every key here was seeded by
                        migration 042 and, until the Executive Intelligence gate, not one of them was read
                        by any code — so this page was quietly presenting five inert rows as controls. */}
                    {WIRED_GATES[f.key]
                      ? <span title={WIRED_GATES[f.key]} className="text-[10px] bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)] rounded-full px-2 py-0.5">gates 1 surface</span>
                      : <span title="No code reads this key. Assigning it changes nothing yet." className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">not wired</span>}
                  </div>
                  {WIRED_GATES[f.key] && <p className="text-[10.5px] text-gray-500 mt-0.5">Gates: {WIRED_GATES[f.key]}</p>}
                  {f.description && <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>}
                  {f.assignments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {f.assignments.map((a: any, i: number) => (
                        <span key={i} className={`text-[10px] font-mono rounded px-1.5 py-0.5 ${a.enabled ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
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
      <p className="text-[11px] text-gray-400">Evaluated in code via <code className="font-mono">flagState(admin, key, &#123;tenantId, planCode, country&#125;)</code>, which answers <b>on</b>, <b>off</b> or <b>unresolved</b> — a flag that cannot be read is withheld and says so, never silently defaulted. Use <b>+ assign</b> to scope a flag to a tenant, plan, country or cohort — most-specific wins.</p>
      <p className="text-[11px] text-gray-400">A flag marked <b>not wired</b> has no reader in the application: assigning it is recorded, and changes nothing on any screen until a gate is added. Country assignments must match the value the tenant record actually holds — live rows hold full country names (&ldquo;Kenya&rdquo;), not ISO-2 codes.</p>
    </div>
  );
}
