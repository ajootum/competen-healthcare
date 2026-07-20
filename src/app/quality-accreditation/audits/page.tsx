import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Clinical Audit Centre (QAS-003) — audits and their compliance/findings.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const pct = (n: number) => (n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");

export default async function AuditCentrePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin", "assessor"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin"); const hid = profile?.hospital_id ?? null;

  const q = admin.from("audits").select("id, title, audit_type, status, compliance_pct, items_not_met, conducted_by_name, conducted_at").order("created_at", { ascending: false }).limit(200);
  const { data: audits } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const rows = audits ?? [];
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clinical Audit Centre</h1>
          <p className="text-sm text-gray-500 mt-1">{rows.length} audits · concurrent, retrospective and clinical.</p>
        </div>
        <Link href="/assessor/quality" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Run an audit →</Link>
      </div>
      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Audit</th><th className="pr-3">Type</th><th className="pr-3">Compliance</th><th className="pr-3">Findings</th><th className="pr-3">By</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-400">No audits recorded yet.</td></tr>}
              {rows.map((a: any) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-gray-800">{a.title ?? "—"}</td>
                  <td className="pr-3 text-xs text-gray-500">{(a.audit_type ?? "").replace(/_/g, " ")}</td>
                  <td className={`pr-3 tabular-nums font-medium ${a.compliance_pct != null ? pct(a.compliance_pct) : "text-gray-400"}`}>{a.compliance_pct != null ? `${a.compliance_pct}%` : "—"}</td>
                  <td className={`pr-3 tabular-nums ${a.items_not_met ? "text-amber-600" : "text-gray-500"}`}>{a.items_not_met ?? 0} not met</td>
                  <td className="pr-3 text-xs text-gray-400">{a.conducted_by_name ?? "—"}</td>
                  <td><span className={`text-[10px] px-2 py-0.5 rounded-full ${a.status === "completed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
