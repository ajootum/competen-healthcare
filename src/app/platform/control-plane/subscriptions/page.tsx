import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Subscription & Licensing (LCP-001 §4).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";
const ent = (e: any, k: string) => (e && e[k] != null ? String(e[k]) : "∞");

export default async function SubscriptionsPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");

  let plans: any[] = []; const subCounts = new Map<string, number>(); let ready = false;
  try {
    const [{ data: p }, { data: subs }] = await Promise.all([
      caller.admin.from("plat_plans").select("id, code, name, price_monthly, currency, entitlements, is_active").order("sort"),
      caller.admin.from("plat_subscriptions").select("plan_id, status").eq("status", "active").limit(20000),
    ]);
    plans = p ?? [];
    for (const s of subs ?? []) if (s.plan_id) subCounts.set(s.plan_id, (subCounts.get(s.plan_id) ?? 0) + 1);
    ready = plans.length > 0;
  } catch { /* pre-migration */ }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscriptions &amp; Licensing</h1>
        <p className="text-sm text-gray-500 mt-1">The plan catalogue and its entitlements. Tenants are attached to a plan at provisioning.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to load the plan catalogue.</div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(pl => {
            const e = pl.entitlements ?? {};
            return (
              <div key={pl.id} className={card}>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="font-semibold text-gray-900">{pl.name}</h3>
                  <span className="text-xs text-gray-400">{subCounts.get(pl.id) ?? 0} tenants</span>
                </div>
                <div className="text-xs text-gray-500 space-y-1 font-mono">
                  <div className="flex justify-between"><span>users</span><b className="text-gray-700">{ent(e, "max_users")}</b></div>
                  <div className="flex justify-between"><span>hospitals</span><b className="text-gray-700">{ent(e, "max_hospitals")}</b></div>
                  <div className="flex justify-between"><span>ai credits</span><b className="text-gray-700">{ent(e, "ai_credits")}</b></div>
                  <div className="flex justify-between"><span>storage gb</span><b className="text-gray-700">{ent(e, "storage_gb")}</b></div>
                  <div className="flex justify-between"><span>api access</span><b className="text-gray-700">{e?.api_access ? "yes" : "no"}</b></div>
                </div>
                <div className="mt-2 text-[10px] font-mono text-violet-600">{pl.code}</div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-400">Billing (invoices, payments, gateways) is a Phase 2 surface over <code className="font-mono">plat_billing_accounts</code>. This replaces the per-facility <code className="font-mono">hospitals.tier</code> tag with a real tenant subscription.</p>
    </div>
  );
}
