import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPeopleDirectory } from "@/lib/enterprise/people";
import PeopleDirectory from "./PeopleDirectory";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function PeopleModule() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { rows, summary, positions } = await loadPeopleDirectory(admin);

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/super-admin/enterprise" className="hover:text-teal-700">Enterprise Administration</Link><span>/</span><span className="text-gray-600">People, Positions &amp; Roles</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">People, Positions &amp; Roles</h1>
          <p className="text-sm text-gray-500">Manage people, positions, roles, reporting lines and workspace access.</p>
        </div>
        <Link href="/super-admin/import" className="text-sm font-semibold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 px-3.5 py-2">📥 Bulk Import</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "People", n: summary.total, tone: "text-gray-900" },
          { label: "Active", n: summary.active, tone: "text-green-600" },
          { label: "Suspended", n: summary.suspended, tone: summary.suspended ? "text-rose-600" : "text-gray-300" },
          { label: "Leavers", n: summary.leavers, tone: summary.leavers ? "text-gray-500" : "text-gray-300" },
          { label: "Positions", n: summary.positions, tone: "text-violet-600" },
          { label: "No position", n: summary.noPosition, tone: summary.noPosition ? "text-amber-600" : "text-gray-300" },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.n}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <PeopleDirectory rows={rows} positions={positions} />
    </div>
  );
}
