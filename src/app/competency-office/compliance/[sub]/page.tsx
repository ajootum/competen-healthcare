import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ComplianceTabs from "../ComplianceTabs";

export const dynamic = "force-dynamic";

// Compliance Centre sub-modules (CMO-002 §6-16). Each surfaces its live status on the Compliance
// Dashboard and routes to its authoritative surface; the dedicated workflow (work queue, detail
// record, configuration) or its store is an honest next-phase where noted.
const SUBS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  mandatory: {
    title: "Mandatory Competencies (§6)",
    blurb: "Catalogue and applicability rules, requirement assignment by role/unit/service, completion and validity status, mass-assignment campaigns and expiry escalation. Live mandatory completion, expiry and overdue counts are on the dashboard; the unit competency matrix drills per-clinician.",
    link: { label: "Open unit competency matrix", href: "/unit-manager/competency" },
  },
  credentials: {
    title: "Professional Credentials (§7)",
    blurb: "Licences, registrations, annual practising certificates, specialty certifications, clinical privileges and scope, primary-source verification and renewal/suspension/restriction workflows. Live validity (valid / expiring / expired) is on the dashboard.",
    link: { label: "Open the credential register", href: "/admin/credentials" },
  },
  learning: {
    title: "Learning Compliance (§8)",
    blurb: "Mandatory course assignment, completion and overdue status, learning equivalency, attendance evidence and campaign management linked to remediation plans.",
    link: { label: "Open learning & curricula", href: "/admin/curricula" },
  },
  assessment: {
    title: "Assessment Compliance (§9)",
    blurb: "Required assessment schedule, knowledge/OSCE/simulation/observation status, reassessment due, assessor booking and appeal workflow. Assessment activity is on the dashboard.",
    link: { label: "Open assessment status", href: "/competency-office/assessments" },
  },
  framework: {
    title: "Framework Compliance (§10)",
    blurb: "Role/specialty framework coverage, CPU requirement mapping, required-vs-achieved competency matrix, version migration and dependency checks. Framework governance lives in the Framework Manager.",
    link: { label: "Open Competency Frameworks", href: "/competency-office/frameworks" },
  },
  regulatory: {
    title: "Regulatory Compliance (§11)",
    blurb: "Country and regulator rule packs, professional-council and statutory requirements, tenant-configured local rules with effective dates and jurisdiction, and regulatory attestation. The versioned jurisdiction rule-pack engine is an honest next-phase build.",
  },
  accreditation: {
    title: "Accreditation Compliance (§12)",
    blurb: "SafeCare, JCI, COHSASA, ISO and custom standards — standards crosswalk, element-level status and ownership, evidence repository and survey readiness. The standards-mapping + evidence-package engine is an honest next-phase build (quality standards exist in the platform).",
    link: { label: "Open quality & safety", href: "/supervisor/quality-safety" },
  },
  exceptions: {
    title: "Exceptions Management (§13)",
    blurb: "Waivers, temporary exemptions, missing-evidence and delayed-assessment exceptions, appeals and compensating controls with expiry. A competency-compliance exception store with the delegated review workflow is an honest next-phase build.",
  },
  remediation: {
    title: "Remediation Plans (§14)",
    blurb: "Closed-loop corrective plans from a gap or AI insight — actions, owners, milestones, due dates, progress and effectiveness review with recurrence monitoring. Needs a remediation store; honest next-phase.",
  },
  ai: {
    title: "AI Compliance Intelligence (§15)",
    blurb: "Expiry and non-compliance prediction, bottleneck detection, root-cause patterns and recommended actions — explainable with confidence and a human-approval feedback loop. Explainable rule-based insights are live on the dashboard; the predictive model suite is a later phase.",
    link: { label: "Open the Compliance Dashboard", href: "/competency-office/compliance" },
  },
  reports: {
    title: "Reports & Exports (§16)",
    blurb: "Compliance scorecards, regulatory and accreditation reports, expiry and risk reports and audit evidence packages with scheduled, role-secured distribution. Competency analytics cover much of this today.",
    link: { label: "Open competency analytics", href: "/competency-office/analytics" },
  },
};

export default async function ComplianceSubPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SUBS, sub) ? SUBS[sub] : undefined;
  if (!s) redirect("/competency-office/compliance");

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold text-gray-900">Compliance Centre</h1><p className="text-sm text-gray-500">{s.title}</p></div>
      <ComplianceTabs />
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-3xl">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">{s.link ? "Live on dashboard · authoritative surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
