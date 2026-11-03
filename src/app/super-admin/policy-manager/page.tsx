import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { POLICY_CAP } from "@/lib/assessment/studio/transitions";
import { listPolicies } from "@/lib/assessment/studio/read";
import { fmtDate } from "@/lib/assessment/studio/vocab";
import { Panel, StateChip, StudioShell, linkBtn, td, th } from "../checklist-studio/_components/studio-ui";
import PolicyEditor from "./PolicyEditor";
import { NewPolicyDialog } from "./_components/NewPolicyDialog";
import { POLICY_SCOPE_LABEL, POLICY_TYPE_LABEL } from "./policy-options";

export const dynamic = "force-dynamic";

export default async function PolicyManagerPage() {
  // Per-page guard (PLAT-ARCH-SURVEY-001 s2.5). Next 16: a layout auth check "will not prevent nested
  // route segments and Server Actions from being accessed" -- so the gate lives here, not upstairs.
  // withOwnAppointments: a platform owner's own live appointments count (the database wants appointments, not ownership).
  const ctx = await withOwnAppointments(await requireHqCapability("hq.quality.policy.view"));
  const { admin } = ctx;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const canAuthor = ctx.capabilities.includes(POLICY_CAP.author);
  const governed = await listPolicies(admin);
  const { data: policies } = await admin
    .from("policies")
    .select("id, title, policy_type, version, effective_date, review_date, is_active, created_at, hospitals(name), frameworks(name), departments(name)")
    .order("created_at", { ascending: false });

  const { data: frameworks } = await admin.from("frameworks").select("id, name").order("name");

  const TYPE_COLORS: Record<string, string> = {
    clinical: "bg-teal-50 text-teal-700",
    hr: "bg-[var(--cmp-surface-information)] text-blue-700",
    safety: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
    governance: "bg-indigo-50 text-indigo-700",
    infection_control: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
    quality: "bg-violet-50 text-violet-700",
  };

  return (
    <div className="max-w-5xl">
      <h1 className="mb-4 text-xl font-bold text-gray-900">Policy Manager</h1>
      <div className="mb-8">
        <StudioShell>
          <Panel title="Governed policies (versioned, reviewed, published)" right={<NewPolicyDialog canAuthor={canAuthor} />}>
            {governed.length === 0 ? (
              <p className="text-sm text-[var(--cmp-app-text-secondary)]">No governed policies yet. A governed policy is written as a draft, put forward for review, approved by someone who did not write it, and then published.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--cmp-app-border)]">
                  <thead><tr><th className={th}>Code</th><th className={th}>Title</th><th className={th}>Type</th><th className={th}>Scope</th><th className={th}>Latest version</th><th className={th}>Published</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody className="divide-y divide-[var(--cmp-app-border)]">
                    {governed.map((g) => (
                      <tr key={g.id}>
                        <td className={`${td} font-mono text-xs`}>{g.code}</td>
                        <td className={td}>{g.latest?.title ?? g.title}</td>
                        <td className={td}>{POLICY_TYPE_LABEL[g.policy_type] ?? g.policy_type}</td>
                        <td className={td}>{POLICY_SCOPE_LABEL[g.scope] ?? g.scope}</td>
                        <td className={td}>{g.latest ? <span className="inline-flex items-center gap-2">v{g.latest.version_no} <StateChip state={g.latest.state} /></span> : <StateChip state={null} />}</td>
                        <td className={td}>{g.published ? `v${g.published.version_no}, ${fmtDate(g.published.published_at)}` : "None yet"}</td>
                        <td className={td}><Link href={`/super-admin/policy-manager/${g.id}`} className={linkBtn}>Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </StudioShell>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Legacy policy records</h2>
          <p className="text-gray-500 text-sm mt-0.5">{(policies ?? []).length} flat policy records — create, version, and link to frameworks or departments. These are not reviewed or published through the governed lifecycle above.</p>
        </div>
        <PolicyEditor frameworks={frameworks ?? []} />
      </div>

      <div className="flex flex-col gap-3">
        {(policies ?? []).map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-gray-900">{p.title}</p>
                  <span className="text-[10px] text-gray-500">v{p.version}</span>
                  {!p.is_active && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Inactive</span>}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] text-gray-500">
                  {(p.hospitals as unknown as { name: string } | null)?.name && <span>🏥 {(p.hospitals as unknown as { name: string }).name}</span>}
                  {(p.frameworks as unknown as { name: string } | null)?.name && <span>📋 {(p.frameworks as unknown as { name: string }).name}</span>}
                  {(p.departments as unknown as { name: string } | null)?.name && <span>🏢 {(p.departments as unknown as { name: string }).name}</span>}
                  {p.effective_date && <span>Effective: {new Date(p.effective_date).toLocaleDateString()}</span>}
                  {p.review_date && <span>Review: {new Date(p.review_date).toLocaleDateString()}</span>}
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ml-4 flex-shrink-0 ${TYPE_COLORS[p.policy_type] ?? "bg-gray-100 text-gray-600"}`}>
                {p.policy_type.replace("_", " ")}
              </span>
            </div>
          </div>
        ))}

        {!(policies ?? []).length && (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <p className="text-2xl mb-2">📄</p>
            <p className="text-gray-500 text-sm">No policies yet — click &quot;+ New Policy&quot; to create one</p>
          </div>
        )}
      </div>
    </div>
  );
}
