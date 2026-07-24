import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LearningTabs from "../LearningTabs";

export const dynamic = "force-dynamic";

// Learning sub-modules (UMG-005). Each surfaces its live status on the Learning Dashboard and routes
// to its authoritative surface (educator / competency workspace), or notes its next-phase store.
const SUBS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  mandatory: {
    title: "Mandatory Learning",
    blurb: "The mandatory education catalogue, staff compliance register, overdue and due-soon items, new-starter requirements, exemptions and the assignment workflow. Live compliance, overdue (expired competency) and due-30 counts are on the dashboard; assignment and content are managed in the education workspace.",
    link: { label: "Open learning & curricula", href: "/admin/curricula" },
  },
  development: {
    title: "Professional Development",
    blurb: "Individual Development Plans, leadership and specialty development, CPD, mentorship, research, improvement projects, progress reviews and evidence. A development-plan store with the review workflow is an honest next-phase build.",
    link: { label: "Open the resource library", href: "/admin/resources" },
  },
  pathways: {
    title: "Career Pathways",
    blurb: "Role progression with required competencies, experience, assessments, leadership milestones, mentor approval and a readiness score. The learning-pathway catalogue exists; per-staff pathway PROGRESSION tracking is an honest next-phase build.",
    link: { label: "Open learning pathways", href: "/admin/curricula" },
  },
  schedule: {
    title: "Education Schedule",
    blurb: "The education calendar — classroom, simulation, OSCE, orientation, bedside teaching, CPD and protected learning time with roster conflict checking. Assessment scheduling is live; an education-session + protected-learning-time store (with safe-staffing validation before approval) is an honest next-phase build.",
    link: { label: "Open the assessment calendar", href: "/competency-office/assessments" },
  },
  analytics: {
    title: "Learning Analytics",
    blurb: "Compliance and completion trends, learning hours, remediation success, pathway progression, attendance, cost of training and drill-down analytics. Live compliance and competency-gap analytics are on the dashboard; the full learning-analytics suite lives in the competency analytics workspace.",
    link: { label: "Open competency analytics", href: "/competency-office/analytics" },
  },
};

export default async function LearningSubPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SUBS, sub) ? SUBS[sub] : undefined;
  if (!s) redirect("/unit-manager/learning");

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold text-gray-900">Learning Oversight &amp; Development</h1><p className="text-sm text-gray-500">{s.title}</p></div>
      <LearningTabs />
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-3xl">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1 mb-3">{s.link ? "Live on dashboard · authoritative surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-emerald-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
