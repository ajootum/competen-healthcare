import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// CPO-001 modules that reuse an existing management surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  templates: {
    title: "Position Templates (CPO-004)",
    blurb: "Map governed competencies and CPUs to organisational positions. Position templates are built and versioned in the Workforce Assignment Engine, which provisions competencies, learning and assessments from each template.",
    link: { label: "Open Position Templates", href: "/admin/positions" },
  },
  governance: {
    title: "Competency Governance (CPO-005)",
    blurb: "Approve framework and CPU changes, manage governance committees and control content lifecycle. Pending approvals and in-review content counts are on your dashboard.",
    link: { label: "Open the governance / approvals queue", href: "/admin/approvals" },
  },
  analytics: {
    title: "Competency Analytics (CPO-006)",
    blurb: "Enterprise competency attainment, coverage, gaps and trend analytics. Live compliance is summarised on your dashboard; the full analytics suite lives in the competency intelligence workspace.",
    link: { label: "Open competency analytics", href: "/admin/competencies" },
  },
  ai: {
    title: "AI Competency Intelligence (CPO-007)",
    blurb: "AI framework-optimisation, gap-prediction and standards recommendations. A later CPO phase; the governed data it reasons over is already live on your dashboard.",
    link: { label: "Open the Dashboard", href: "/competency-office" },
  },
  reports: {
    title: "Reports (CPO-008)",
    blurb: "Exportable governance and competency reports across frameworks, CPUs and compliance. A later phase; executive reporting already covers much of this.",
    link: { label: "Open executive reporting", href: "/admin/executive" },
  },
  settings: {
    title: "Settings (CPO-009)",
    blurb: "Competency Office configuration, governance thresholds and lifecycle policy. A later phase.",
  },
};

export default async function CompetencyOfficeSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/competency-office");

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
