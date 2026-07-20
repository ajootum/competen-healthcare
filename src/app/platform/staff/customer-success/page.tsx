import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadCustomerSuccess } from "@/lib/platform/staff-data";

export const dynamic = "force-dynamic";

// Customer Success (PCS-001) — tenant health across the platform.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";
const bandCls: Record<string, string> = { healthy: "bg-green-100 text-green-700", watch: "bg-amber-100 text-amber-700", at_risk: "bg-red-100 text-red-700" };
const bar = (n: number) => (n >= 70 ? "bg-green-500" : n >= 40 ? "bg-amber-500" : "bg-red-500");

export default async function CustomerSuccessPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, rows, summary } = await loadCustomerSuccess(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer Success</h1>
        <p className="text-sm text-gray-500 mt-1">Tenant health across the platform — adoption, lifecycle and subscription, at-risk first.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to activate tenant health.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.total}</div><div className="text-xs text-gray-500 mt-1">Tenants</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{summary.healthy}</div><div className="text-xs text-gray-500 mt-1">Healthy</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-amber-600">{summary.watch}</div><div className="text-xs text-gray-500 mt-1">Watch</div></div>
            <div className={card}><div className={`text-3xl font-bold tabular-nums ${summary.atRisk ? "text-red-600" : "text-gray-900"}`}>{summary.atRisk}</div><div className="text-xs text-gray-500 mt-1">At risk</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-blue-600">{summary.onboarding}</div><div className="text-xs text-gray-500 mt-1">Onboarding</div></div>
          </div>
          <div className={card}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Tenant</th><th className="pr-3">Lifecycle</th><th className="pr-3">Subscription</th><th className="pr-3 text-right">Users</th><th className="pr-3 w-40">Health</th></tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No tenants.</td></tr>}
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{r.name}</td>
                      <td className="pr-3 text-gray-500">{r.status}</td>
                      <td className="pr-3 text-gray-500">{r.subscription ?? <span className="text-amber-500">none</span>}</td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{r.users}</td>
                      <td className="pr-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${bar(r.health)}`} style={{ width: `${r.health}%` }} /></div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${bandCls[r.band]}`}>{r.health}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Health = lifecycle (active/trial) + adoption (users, relative to the largest tenant) + subscription. Renewals, NPS and playbooks are a later phase.</p>
        </>
      )}
    </div>
  );
}
