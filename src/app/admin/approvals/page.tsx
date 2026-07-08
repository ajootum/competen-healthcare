import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ApprovalActions from "./ApprovalActions";

type Approval = {
  id: string;
  framework_id: string;
  framework_name: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
  status: string;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (days > 0)  return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${mins}m ago`;
}

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, org_role, hospital_id, organisation_id")
    .eq("id", user.id)
    .single();

  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) redirect("/dashboard");

  const [{ data: pending }, { data: history }] = await Promise.all([
    admin
      .from("content_approvals")
      .select("id, framework_id, framework_name, submitted_by_name, submitted_at, status")
      .eq("status", "pending")
      .order("submitted_at", { ascending: false })
      .returns<Approval[]>(),

    admin
      .from("content_approvals")
      .select("id, framework_id, framework_name, submitted_by_name, submitted_at, status, reviewed_by_name, reviewed_at, comment")
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false })
      .limit(20)
      .returns<(Approval & { reviewed_by_name?: string | null; reviewed_at?: string | null; comment?: string | null })[]>(),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Content Approvals</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Review competency frameworks submitted for clinical governance approval.
        </p>
      </div>

      {/* Pending */}
      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
          Pending Review ({(pending ?? []).length})
        </h2>

        {!(pending ?? []).length ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-gray-500 text-sm font-medium">All clear</p>
            <p className="text-gray-400 text-xs mt-1">No frameworks are waiting for review.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Framework</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Submitted By</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">When</th>
                  <th className="text-right px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(pending ?? []).map(a => (
                  <tr key={a.id} className="hover:bg-gray-50/40">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-amber-400 rounded-full shrink-0" />
                        <p className="font-medium text-gray-900">{a.framework_name ?? a.framework_id}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs text-gray-500">{a.submitted_by_name ?? "—"}</td>
                    <td className="px-4 py-4 text-xs text-gray-400">{timeAgo(a.submitted_at)}</td>
                    <td className="px-5 py-4 text-right">
                      <ApprovalActions approval={a} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History */}
      {(history ?? []).length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recent Decisions</h2>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Framework</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Decision</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Reviewed By</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(history ?? []).map(a => (
                  <tr key={a.id} className="hover:bg-gray-50/40 opacity-80">
                    <td className="px-5 py-3 font-medium text-gray-800 text-sm">{a.framework_name ?? a.framework_id}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                        a.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                      }`}>
                        {a.status === "approved" ? "✅ Approved" : "❌ Rejected"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{(a as { reviewed_by_name?: string | null }).reviewed_by_name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 italic max-w-xs truncate">{(a as { comment?: string | null }).comment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
