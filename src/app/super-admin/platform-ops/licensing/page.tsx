import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadLicensing } from "@/lib/platform/licensing";
import LicensingClient from "./LicensingClient";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const fmt = (n: number) => n.toLocaleString();

export default async function LicensingCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { planRows, summary, renewals } = await loadLicensing(admin);

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Licensing &amp; Subscription</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Licensing &amp; Subscription Centre</h1>
        <p className="text-sm text-gray-500">Manage plans, licences, subscriptions, seats and renewals.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Plans", n: fmt(summary.plans), tone: "text-gray-900" },
          { label: "Active subscriptions", n: fmt(summary.subscriptions), tone: "text-green-600" },
          { label: "Total seats", n: fmt(summary.seats), tone: "text-blue-600" },
          { label: "Trials", n: fmt(summary.trials), tone: summary.trials ? "text-amber-600" : "text-gray-300" },
          { label: "Renewing ≤30d", n: fmt(summary.renewingSoon), tone: summary.renewingSoon ? "text-orange-600" : "text-gray-300" },
          { label: `MRR (${summary.currency})`, n: fmt(summary.mrr), tone: "text-violet-600", sub: summary.mrr === 0 ? "list price 0" : undefined },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
            {(k as any).sub && <p className="text-[9px] text-gray-400">{(k as any).sub}</p>}
          </div>
        ))}
      </div>

      <LicensingClient planRows={planRows} renewals={renewals} currency={summary.currency} />
    </div>
  );
}
