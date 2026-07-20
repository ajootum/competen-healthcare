import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Billing Control Centre (LCP-001 §5).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function BillingPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");

  let accounts: any[] = []; let ready = false;
  try {
    const { data, error } = await caller.admin.from("plat_billing_accounts").select("id, tenant_id, legal_name, billing_email, currency, balance, tenants(name)").order("created_at", { ascending: false }).limit(2000);
    if (!error) { accounts = data ?? []; ready = true; }
  } catch { /* pre-migration */ }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-1">Tenant billing accounts. Invoices &amp; payments activate when a payment gateway is connected.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migration <code className="font-mono text-xs">043</code> to activate billing accounts.</div>
      ) : (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Billing accounts <span className="text-gray-400 font-normal">· {accounts.length}</span></h3>
          {accounts.length === 0 ? (
            <p className="text-sm text-gray-400">No billing accounts yet. They&apos;re created when a tenant is put on a paid plan with a connected gateway.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Tenant</th><th className="pr-3">Legal name</th><th className="pr-3">Email</th><th className="pr-3 text-right">Balance</th></tr></thead>
                <tbody>
                  {accounts.map((a: any) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{a.tenants?.name ?? "—"}</td>
                      <td className="pr-3 text-gray-500">{a.legal_name ?? "—"}</td>
                      <td className="pr-3 text-gray-500">{a.billing_email ?? "—"}</td>
                      <td className="pr-3 text-right tabular-nums text-gray-600">{a.currency} {Number(a.balance ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className={`${card} border-dashed`}>
        <h3 className="font-semibold text-gray-900 mb-1">Invoices &amp; payments</h3>
        <p className="text-sm text-gray-400">The <code className="font-mono text-xs">plat_invoices</code> ledger exists, but issuing invoices, taking payments, renewals and revenue reporting need a payment gateway (Stripe / Paystack / Flutterwave). Connect one to activate this. Plan economics are already live in <Link href="/platform/staff/finance" className="text-violet-600 hover:underline">Finance</Link>.</p>
      </div>
    </div>
  );
}
