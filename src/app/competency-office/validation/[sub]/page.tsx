import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ValidationTabs from "../ValidationTabs";

export const dynamic = "force-dynamic";

// Validation Queue sub-modules (CMO-005 §2). Each surfaces its live status on the Validation
// Dashboard and routes to the authoritative validation workflow, or notes its next-phase store.
const SUBS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  inbox: {
    title: "Evidence Inbox",
    blurb: "Newly submitted evidence awaiting triage and assignment. Evidence is submitted and reviewed against competencies and credentials in the educator evidence workspace; the pending count is on the dashboard.",
    link: { label: "Open the Evidence Centre", href: "/educator/evidence" },
  },
  pending: {
    title: "Pending Validation",
    blurb: "Competency decisions awaiting validation, oldest-first with SLA age. Approve / reject / request-more-evidence against the rubric is actioned in the validation surfaces; approval recalculates readiness immediately (§5).",
    link: { label: "Open the validation queue", href: "/unit-manager/competency-validations" },
  },
  ai: {
    title: "AI Evidence Review",
    blurb: "Automatic evidence quality scoring and confidence to prioritise review (§4). Explainable and recommendation-only — AI cannot approve evidence. An evidence-quality model + store is an honest next-phase build.",
  },
  committee: {
    title: "Committee Review",
    blurb: "Complex cases routed to a competency/credential committee for governed decision. A committee-review case store with membership and quorum rules is an honest next-phase build.",
  },
  appeals: {
    title: "Appeals",
    blurb: "Challenges to a rejection or restriction, reviewed by an independent reviewer with a full audit trail. An appeals case store with the review workflow is an honest next-phase build.",
  },
  bulk: {
    title: "Bulk Validation",
    blurb: "Validate multiple evidence items at once — requires elevated permission (§5). Bulk actions run against the validation surfaces; a governed bulk-validation workflow is an honest next-phase build.",
    link: { label: "Open the validation queue", href: "/unit-manager/competency-validations" },
  },
  history: {
    title: "Validation History",
    blurb: "The immutable record of validation decisions (validated / rejected / returned) with validator and reason. Recent history is on the dashboard; rejected evidence remains in audit history (§5).",
    link: { label: "Open educator validations", href: "/educator/validations" },
  },
  audit: {
    title: "Audit & Reports",
    blurb: "Validation audit trail and exports — every action is audited (§10). Competency analytics and the audit log cover much of this today.",
    link: { label: "Open competency analytics", href: "/competency-office/analytics" },
  },
};

export default async function ValidationSubPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SUBS, sub) ? SUBS[sub] : undefined;
  if (!s) redirect("/competency-office/validation");

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold text-gray-900">Validation Queue</h1><p className="text-sm text-gray-500">{s.title}</p></div>
      <ValidationTabs />
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-3xl">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">{s.link ? "Live on dashboard · authoritative surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
