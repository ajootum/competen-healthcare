import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEnterpriseGovernance } from "@/lib/enterprise-governance-data";
import { card, tone, pctText } from "../_ui";

export const dynamic = "force-dynamic";

// Enterprise Standards (EGV-002) — the shared master competency standards library.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function StandardsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadEnterpriseGovernance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { standards } = d;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise Standards</h1>
          <p className="text-sm text-gray-500 mt-1">The shared master competency framework library that every tenant inherits.</p>
        </div>
        <Link href="/competency-office" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Govern in Competency Office →</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{standards.total}</div><div className="text-xs text-gray-500 mt-1">Master standards</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{standards.published}</div><div className="text-xs text-gray-500 mt-1">Published</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-amber-600">{standards.draft}</div><div className="text-xs text-gray-500 mt-1">Draft</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${tone(standards.compliancePct)}`}>{pctText(standards.compliancePct)}</div><div className="text-xs text-gray-500 mt-1">Published rate</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Publication status</h3>
        <div className="h-4 flex rounded-md overflow-hidden border border-gray-200 mb-2">
          {standards.published > 0 && <div style={{ width: `${(standards.published / Math.max(standards.total, 1)) * 100}%` }} className="bg-green-500" title={`Published: ${standards.published}`} />}
          {standards.draft > 0 && <div style={{ width: `${(standards.draft / Math.max(standards.total, 1)) * 100}%` }} className="bg-amber-500" title={`Draft: ${standards.draft}`} />}
          {standards.other > 0 && <div style={{ width: `${(standards.other / Math.max(standards.total, 1)) * 100}%` }} className="bg-gray-300" title={`Other: ${standards.other}`} />}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-gray-500">
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500 mr-1 align-middle" />Published <b className="text-gray-800">{standards.published}</b></span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500 mr-1 align-middle" />Draft <b className="text-gray-800">{standards.draft}</b></span>
          <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-300 mr-1 align-middle" />Other <b className="text-gray-800">{standards.other}</b></span>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Enterprise standards are the platform master frameworks (not owned by any single tenant). Tenants inherit them and may add local frameworks. Versioning, publication and approval are governed in the <Link href="/competency-office" className="text-teal-600 hover:underline">Competency Office</Link>.</p>
    </div>
  );
}
