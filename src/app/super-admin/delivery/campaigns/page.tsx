import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCampaigns } from "@/lib/delivery/campaigns";
import CampaignManager from "./CampaignManager";
import { requireHqCapability } from "@/lib/hq/context";

// CDP-008 — Competency Assignment & Campaign Manager. Deadline-driven competency initiatives targeting a
// cohort, with live compliance from competency decisions. Real over cdp_campaigns (144) + cmo_assignments +
// competency_decisions. Super-admin, platform-wide.

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.delivery.view");

  const [q, compsRes, profsRes] = await Promise.all([
    loadCampaigns(admin, null, true),
    admin.from("framework_competencies").select("id, name").order("name").limit(600),
    admin.from("profiles").select("role, roles").limit(8000),
  ]);
  const competencies = (compsRes.data ?? []) as { id: string; name: string }[];
  const roleSet = new Set<string>();
  for (const p of (profsRes.data ?? []) as { role: string | null; roles: string[] | null }[]) {
    (p.roles?.length ? p.roles : [p.role]).forEach(r => r && roleSet.add(r));
  }
  const roleList = [...roleSet].sort();

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-008 · Assignment & Campaign Manager</p>
          <h1 className="text-xl font-bold text-gray-900">Learning Campaigns</h1>
          <p className="text-gray-400 text-sm mt-0.5">Broadcast a competency initiative to a cohort with a deadline — and watch compliance climb, live.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Campaigns aren&apos;t provisioned — apply migration 144 (<code className="text-[11px]">cdp_campaigns</code>).</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Campaigns", value: q.kpis.total, tone: "text-gray-900" },
              { label: "Active", value: q.kpis.active, tone: "text-teal-600" },
              { label: "Mandatory open", value: q.kpis.mandatory, tone: "text-[var(--cmp-text-error)]" },
              { label: "Staff reach", value: q.kpis.reach, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>
          <CampaignManager campaigns={q.campaigns} competencies={competencies} roles={roleList} />
        </>
      )}
    </div>
  );
}
