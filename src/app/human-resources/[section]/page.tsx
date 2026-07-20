import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HRM-001 modules that reuse an existing surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  recruitment: {
    title: "Recruitment (HRM-002)",
    blurb: "Applicant tracking, vacancy advertising and candidate pipeline. Competen does not yet hold applicant data, so this activates when an ATS is connected. Meanwhile, your open vacancies (established positions with no active assignment) are live on the dashboard and in Workforce Planning.",
    link: { label: "Open Workforce Planning", href: "/human-resources/planning" },
  },
  positions: {
    title: "Position Management (HRM-005)",
    blurb: "Create positions, map them to Position Templates and assign employees — the assignment provisions their workspaces, competencies, learning and assessments. Managed in the Workforce Assignment Engine.",
    link: { label: "Open Position Management", href: "/admin/positions" },
  },
  learning: {
    title: "Learning Compliance (HRM-006)",
    blurb: "Mandatory-training and learning-pathway completion across the workforce. Live compliance is summarised on your dashboard; full learning management lives in the education workspace.",
    link: { label: "Open the learning library", href: "/admin/resources" },
  },
  performance: {
    title: "Performance Management (HRM-007)",
    blurb: "Appraisals, objectives and performance reviews. A dedicated performance module is a later HRM phase; today's proxy — competency validation and assessment outcomes — is available in Staff Records and the assessment tools.",
    link: { label: "Open Staff Records", href: "/human-resources/staff" },
  },
  analytics: {
    title: "HR Analytics (HRM-008)",
    blurb: "Workforce analytics — headcount trends, turnover, vacancy and compliance. The executive intelligence suite already covers much of this.",
    link: { label: "Open executive reporting", href: "/admin/executive" },
  },
  ai: {
    title: "AI Workforce Advisor (HRM-009)",
    blurb: "Workforce-planning, succession and retention-risk AI. A later phase; the data it reasons over is already live on your dashboard.",
    link: { label: "Open the Dashboard", href: "/human-resources" },
  },
  settings: {
    title: "Settings (HRM-010)",
    blurb: "HR workspace configuration, establishment policy and data-privacy controls. A later phase.",
  },
};

export default async function HrSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = SECTIONS[section];
  if (!s) redirect("/human-resources");

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
