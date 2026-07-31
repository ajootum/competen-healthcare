import { createClient, createAdminClient } from "@/lib/supabase/server";
import { holdsOfficeAppointment } from "@/lib/ogs/office";
import { redirect } from "next/navigation";
import Link from "next/link";
import { cardClass } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// CPU Library (CPO-003) — the shared Clinical Practice Unit library with
// lifecycle status, risk and reassessment cadence.
/* eslint-disable @typescript-eslint/no-explicit-any */

const statusBadge: Record<string, string> = {
  published: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", approved: "bg-[var(--cmp-surface-information)] text-blue-700",
  in_review: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", draft: "bg-gray-100 text-gray-500", archived: "bg-gray-100 text-gray-400",
};
const riskBadge: Record<string, string> = { low: "text-[var(--cmp-text-success)]", standard: "text-gray-500", high: "text-[var(--cmp-text-warning)]", critical: "text-[var(--cmp-text-critical)]" };

export default async function CpuLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r)) && !(await holdsOfficeAppointment(admin, "competency", profile?.hospital_id ?? null, roles.includes("super_admin"), user.id))) redirect("/dashboard");

  const { data: cpus } = await admin.from("clinical_practice_units")
    .select("id, name, code, risk_category, reassessment_months, pub_status, version_num").order("name").limit(2000);
  const rows = cpus ?? [];
  const published = rows.filter((c: any) => c.pub_status === "published").length;
  const card = cardClass;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CPU Library</h1>
          <p className="text-sm text-gray-500 mt-1">{rows.length} Clinical Practice Units · {published} published.</p>
        </div>
        <Link href="/admin/studio" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Open Competency Studio →</Link>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Clinical Practice Unit</th><th className="pr-3">Code</th><th className="pr-3">Risk</th><th className="pr-3">Reassessment</th><th className="pr-3">Version</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="py-3 text-gray-400">No CPUs in the library yet.</td></tr>}
              {rows.map((c: any) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-gray-800">{c.name}</td>
                  <td className="pr-3 text-xs text-gray-400">{c.code ?? "—"}</td>
                  <td className={`pr-3 text-xs ${riskBadge[c.risk_category] ?? "text-gray-500"}`}>{c.risk_category}</td>
                  <td className="pr-3 text-gray-500 tabular-nums">{c.reassessment_months ?? 12} mo</td>
                  <td className="pr-3 text-gray-500 tabular-nums">v{c.version_num ?? 0}</td>
                  <td><span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge[c.pub_status] ?? "bg-gray-100 text-gray-500"}`}>{(c.pub_status ?? "draft").replace(/_/g, " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
