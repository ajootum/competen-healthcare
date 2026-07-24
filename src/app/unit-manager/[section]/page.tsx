import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// UMW-001 modules whose full workflow reuses an existing surface or is a later
// phase. Honest about what's live and where the detail lives.

const SECTIONS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  assessment: {
    title: "Assessment Oversight (UMG-006)",
    blurb: "Oversee competency assessment across the unit — active cycles, scheduled assessments and validations pending sign-off. Live counts are on your dashboard; run and review cycles in the assessment tools.",
    link: { label: "Open competency cycles", href: "/admin/cycles" },
  },
  quality: {
    title: "Quality Improvement (UMG-007)",
    blurb: "Audit compliance, CAPA (corrective/preventive actions) and quality indicators for the unit. Live compliance and open-improvement counts are on your dashboard; manage the full quality programme here.",
    link: { label: "Open the quality workspace", href: "/admin/quality" },
  },
  budget: {
    title: "Budget & Resources (UMG-008)",
    blurb: "Unit budget, cost centres and resource planning. Competen does not currently hold finance data — this module activates when a budgeting source is connected. Operational resource status (beds, staffing) is live under Unit Performance.",
    link: { label: "Open Unit Performance", href: "/unit-manager/operations?section=ward" },
  },
  reports: {
    title: "Operational Reports (UMG-009)",
    blurb: "Exportable unit reports across staffing, competency, quality and operations. A later UMW phase; the executive reporting suite already covers much of this.",
    link: { label: "Open executive reporting", href: "/admin/executive" },
  },
  ai: {
    title: "AI Leadership Advisor (UMG-010)",
    blurb: "Leadership AI — workforce-planning, capability-gap and quality recommendations for the unit. Arrives in a later phase; the metrics it reasons over are already live on your dashboard.",
    link: { label: "Open the Unit Dashboard", href: "/unit-manager" },
  },
  settings: {
    title: "Settings (UMG-011)",
    blurb: "Workspace preferences, unit configuration and thresholds. A later phase.",
  },
};

export default async function UnitManagerSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/unit-manager");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">Next phase</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
