import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadFinance } from "@/lib/platform/staff-data";

export const dynamic = "force-dynamic";

// Finance (FIN-001) — subscription economics across the platform.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";
const money = (n: number, c: string) => `${c} ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default async function FinancePage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const f = await loadFinance(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Finance</h1>
        <p className="text-sm text-gray-500 mt-1">Subscription economics — MRR, plan mix and billing accounts across all tenants.</p>
      </div>
      {!f.ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–043</code> to activate finance metrics.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{money(f.mrr, f.currency)}</div><div className="text-xs text-gray-500 mt-1">Monthly recurring revenue</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{f.activeSubs}</div><div className="text-xs text-gray-500 mt-1">Active subscriptions</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-blue-600">{f.trialing}</div><div className="text-xs text-gray-500 mt-1">Trials</div></div>
            <div className={card}><div className={`text-3xl font-bold tabular-nums ${f.unsubscribed ? "text-amber-600" : "text-gray-900"}`}>{f.unsubscribed}</div><div className="text-xs text-gray-500 mt-1">Without a plan</div></div>
          </div>
          <div className={card}>
            <h3 className="font-semibold text-gray-900 mb-3">Plan mix</h3>
            {f.planMix.length === 0 && <p className="text-sm text-gray-400">No subscriptions yet.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Plan</th><th className="pr-3 text-right">Tenants</th><th className="pr-3 text-right">MRR</th></tr></thead>
                <tbody>
                  {f.planMix.map((p: any) => (
                    <tr key={p.code} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{p.name} <span className="text-[10px] font-mono text-gray-400">{p.code}</span></td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{p.count}</td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{money(p.mrr, p.currency ?? f.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">MRR sums active-subscription plan prices ({money(0, f.currency)} on seeded plans until you set real prices in <code className="font-mono">plat_plans</code>). {f.billingAccounts} billing account{f.billingAccounts !== 1 ? "s" : ""} · invoices/payments connect via a gateway in <Link href="/platform/control-plane/billing" className="text-violet-600 hover:underline">Billing</Link>.</p>
        </>
      )}
    </div>
  );
}
