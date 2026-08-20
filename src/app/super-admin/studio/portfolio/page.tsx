import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPortfolios } from "@/lib/studio/portfolio";
import PortfolioManager from "./PortfolioManager";
import { requireHqCapability } from "@/lib/hq/context";

// CST-042 — Portfolio Assessment Designer. Portfolio templates with required-evidence sections
// (cst_portfolio_templates + cst_portfolio_sections, migration 135). Each section requires a number of
// evidence artefacts of a type at a weight; weights should sum to 100% before activation.

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const pf = await loadPortfolios(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-042 · Portfolio Assessment</p>
          <h1 className="text-xl font-bold text-gray-900">Portfolio Designer</h1>
          <p className="text-gray-500 text-sm mt-0.5">Design portfolio templates — required-evidence sections, artefact counts and weighting.</p>
        </div>
        <Link href="/super-admin/studio/assessment" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Assessment</Link>
      </div>

      {!pf.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 135 (<code className="text-[11px]">cst_portfolio_templates</code>) to enable the Portfolio designer.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Templates", value: pf.kpis.total, tone: "text-gray-900" },
              { label: "Active", value: pf.kpis.active, tone: "text-teal-600" },
              { label: "Draft", value: pf.kpis.draft, tone: "text-gray-500" },
              { label: "Sections", value: pf.kpis.sections, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <PortfolioManager templates={pf.templates} />

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Design here, collect elsewhere.</span> This defines the portfolio blueprint — sections, required evidence and weighting. Learner evidence submission, supervisor review and progression against the template are the next-phase runtime (the worker&apos;s live record lives in the Competency Passport).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
