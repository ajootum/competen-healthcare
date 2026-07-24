import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CredentialTabs from "../CredentialTabs";

export const dynamic = "force-dynamic";

// Credential Management sub-modules (CMO-003 §6-25). Each surfaces its live status on the Credential
// Dashboard and routes to its authoritative surface, or notes its next-phase store.
const SUBS: Record<string, { title: string; blurb: string; link?: { label: string; href: string } }> = {
  register: {
    title: "Staff Credential Register (§6)",
    blurb: "The searchable credential profile for every worker — by name, staff number, profession, unit, credential number, issuer, status and expiry, with saved filters and bulk actions. A live register preview is on the dashboard; the full editable register is in the credential workspace.",
    link: { label: "Open the credential register", href: "/admin/credentials" },
  },
  types: {
    title: "Credential Types & Requirements (§8)",
    blurb: "Define licence, certification and privilege requirements — identity, validity rules, evidence, applicability (role/unit/CPU/procedure), operational impact, renewal cadence and compliance mapping. A versioned credential-type configuration store is an honest next-phase build.",
    link: { label: "Open the credential register", href: "/admin/credentials" },
  },
  verification: {
    title: "Verification Queue (§9)",
    blurb: "The primary-source and document verification workbench — evidence preview, field comparison, regulator/institution checks, approve/reject/request-information and fraud flagging with SLA timers. Verification pending is on the dashboard; the verification-case workflow store is an honest next-phase build.",
    link: { label: "Open the credential register", href: "/admin/credentials" },
  },
  renewals: {
    title: "Renewals & Expiries (§10)",
    blurb: "Upcoming, overdue and completed renewals through the staged workflow (not-started → staff action → verification → approval → completed). Live upcoming expiries are on the dashboard; the renewal-case store (new version per renewal, BR-003) is an honest next-phase build.",
    link: { label: "Open the credential register", href: "/admin/credentials" },
  },
  privileges: {
    title: "Privileges & Scope of Practice (§11)",
    blurb: "Grant, restrict, suspend and review authorised clinical activities — privilege sets, scope conditions, proctoring, periodic review, with named accountable approvers. Privilege status feeds scheduling and assignment. A privilege-grant store is an honest next-phase build (clinical authorisations exist in the platform).",
    link: { label: "Open clinical authorisations", href: "/admin/authorizations" },
  },
  exceptions: {
    title: "Exceptions & Temporary Authorisations (§12)",
    blurb: "Governed deviations — temporary authorisations, waivers, grace-period approvals, conditional practice and appeals — each with a named approver, scope, risk assessment and mandatory end date (BR-008). A credential-exception store with the delegated approval workflow is an honest next-phase build.",
  },
  documents: {
    title: "Document Repository (§7)",
    blurb: "Secure credential evidence store with signed time-limited URLs, field-level masking, malware scanning, hashing and duplicate detection. Verified evidence is immutable (BR-010). The governed document repository is an honest next-phase build; evidence is attached today in the credential register.",
    link: { label: "Open the credential register", href: "/admin/credentials" },
  },
  reports: {
    title: "Reports & Audit (§25)",
    blurb: "Credential compliance registers, expiry forecasts (30/60/90/180), verification SLA, privilege coverage, restriction registers and regulator/accreditation evidence packs — with filter-context and source footnotes. Competency analytics cover much of this today.",
    link: { label: "Open competency analytics", href: "/competency-office/analytics" },
  },
};

export default async function CredentialSubPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SUBS, sub) ? SUBS[sub] : undefined;
  if (!s) redirect("/competency-office/credentialing");

  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold text-gray-900">Credential Management</h1><p className="text-sm text-gray-500">{s.title}</p></div>
      <CredentialTabs />
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-3xl">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">{s.link ? "Live on dashboard · authoritative surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
