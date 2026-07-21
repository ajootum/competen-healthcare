import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadNetworkDirectory } from "@/lib/enterprise/networks";
import NetworkDirectory from "./NetworkDirectory";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function NetworksModule() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { rows, summary } = await loadNetworkDirectory(admin);

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span><span className="text-gray-600">Networks &amp; Enterprise Groups</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Networks &amp; Enterprise Groups</h1>
        <p className="text-sm text-gray-500">Manage enterprise groups, health networks and multi-organisation hierarchies.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Networks", n: summary.total, tone: "text-gray-900" },
          { label: "Active", n: summary.active, tone: "text-green-600" },
          { label: "Member orgs", n: summary.memberOrgs, tone: "text-violet-600" },
          { label: "Unassigned orgs", n: summary.unassignedOrgs, tone: summary.unassignedOrgs ? "text-amber-600" : "text-gray-300" },
          { label: "Countries", n: summary.countries, tone: "text-indigo-600" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <NetworkDirectory rows={rows} />
    </div>
  );
}
