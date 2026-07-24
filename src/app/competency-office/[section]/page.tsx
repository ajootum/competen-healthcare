import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// CMO-001 competency-operations modules. Each surfaces live data on the dashboard and routes to its
// authoritative operational surface (§6 data sources) until it gains a dedicated in-workspace page.

const SECTIONS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  readiness: {
    title: "Workforce Readiness (CMO-002)",
    blurb: "Required vs available competencies by unit — deployability and coverage. The live readiness summary (organisation readiness, high-risk units, workforce-by-CPU) is on your dashboard; per-clinician unit readiness drills into the Unit Manager competency view.",
    link: { label: "Open unit workforce readiness", href: "/unit-manager/competency" },
  },
  library: {
    title: "Competency Library (CMO-003)",
    blurb: "The governed catalogue of competencies, domains and standards. The competency hierarchy is authored and versioned in the Framework Manager.",
    link: { label: "Open the Framework Manager", href: "/competency-office/frameworks" },
  },
  evidence: {
    title: "Evidence Centre (CMO-007)",
    blurb: "The evidence-submission and review queue backing competency validation. Evidence is reviewed and linked to competencies and credentials in the educator evidence workspace.",
    link: { label: "Open the Evidence Centre", href: "/educator/evidence" },
  },
  validation: {
    title: "Competency Validation (CMO-008)",
    blurb: "Governed validation of competency decisions (validate / return / defer). Readiness recalculates immediately on validation. The awaiting-validation count is on your dashboard.",
    link: { label: "Open the validation queue", href: "/unit-manager/competency-validations" },
  },
  passports: {
    title: "Professional Passports (CMO-009)",
    blurb: "The portable competency passport per practitioner — competencies, credentials and readiness composed from the governed record. Viewed in the assessor passport surface and each practitioner's own passport.",
    link: { label: "Open professional passports", href: "/assessor/passports" },
  },
  learning: {
    title: "Learning Integration (CMO-011)",
    blurb: "Assign learning against competency gaps and track completion. Learning pathways and curricula are mapped to competencies in the curriculum surface.",
    link: { label: "Open learning & curricula", href: "/admin/curricula" },
  },
  ai: {
    title: "AI Competency Intelligence (CMO-012)",
    blurb: "Predictive gap, risk and recommendation intelligence. Explainable rule-based recommendations are live on your dashboard; the full predictive suite is a later phase.",
    link: { label: "Open the Dashboard", href: "/competency-office" },
  },
  settings: {
    title: "Settings (CMO-014)",
    blurb: "Competency operations configuration — readiness thresholds, expiry windows, governance and lifecycle policy. A later phase.",
  },
  // Retained legacy routes (not in the CMO-001 sidebar but still resolvable).
  templates: {
    title: "Position Templates",
    blurb: "Map governed competencies and CPUs to organisational positions, built and versioned in the Workforce Assignment Engine.",
    link: { label: "Open Position Templates", href: "/admin/positions" },
  },
  governance: {
    title: "Competency Governance",
    blurb: "Approve framework and CPU changes, manage governance committees and control content lifecycle. Pending approvals and in-review content counts are on your dashboard.",
    link: { label: "Open the governance / approvals queue", href: "/admin/approvals" },
  },
  reports: {
    title: "Reports",
    blurb: "Exportable governance and competency reports across frameworks, CPUs and compliance. Executive reporting covers much of this today.",
    link: { label: "Open executive reporting", href: "/admin/executive" },
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
