import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// QAS-001 modules that reuse an existing surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  risk: {
    title: "Risk Management (QAS-005)",
    blurb: "Clinical and operational risk register with mitigation tracking. A dedicated register is a later QAS phase; today's risk signal — critical audit findings and high-priority corrective actions — is summarised on your dashboard and in the audit centre.",
    link: { label: "Open the Audit Centre", href: "/quality-accreditation/audits" },
  },
  compliance: {
    title: "Compliance Monitoring (QAS-006)",
    blurb: "Continuous compliance against standards, mandatory training and competency. Live audit compliance and competency data feed your dashboard; the full compliance view lives in the quality workspace.",
    link: { label: "Open the quality workspace", href: "/admin/quality" },
  },
  analytics: {
    title: "Analytics (QAS-007)",
    blurb: "Quality and accreditation analytics — trends, benchmarking and readiness scoring. The accreditation intelligence suite already covers much of this.",
    link: { label: "Open accreditation analytics", href: "/admin/accreditation" },
  },
  ai: {
    title: "AI Quality Intelligence (QAS-008)",
    blurb: "Quality AI — risk prediction, root-cause analysis and accreditation-readiness recommendations. A later phase; the data it reasons over is already live on your dashboard.",
    link: { label: "Open the Dashboard", href: "/quality-accreditation" },
  },
  settings: {
    title: "Settings (QAS-009)",
    blurb: "Workspace configuration, standard frameworks (SafeCare / JCI / national) and audit templates. A later phase.",
  },
};

export default async function QualitySectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin", "assessor"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/quality-accreditation");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">{s.link ? "Reuses existing surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
