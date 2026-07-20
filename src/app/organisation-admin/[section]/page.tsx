import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ADM-001 modules that reuse an existing surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; links?: { label: string; href: string }[] }> = {
  departments: {
    title: "Departments (ADM-004)",
    blurb: "Create and manage departments and units within each facility. Department structure is live in Organisation Structure; full CRUD (create, rename, assign specialties and leaders) is in the departments admin surface.",
    links: [
      { label: "Manage departments", href: "/admin/departments" },
      { label: "View organisation structure", href: "/organisation-admin/structure" },
    ],
  },
  roles: {
    title: "Roles & Permissions (ADM-006)",
    blurb: "Role assignment across the organisation is summarised live on your dashboard and per-user in the directory. Each user's org role is set when they are invited or edited. Fine-grained permission editing (custom RBAC/ABAC policies) is a later ADM phase; today roles map to portal access via the org-role hierarchy.",
    links: [
      { label: "View users & their org roles", href: "/organisation-admin/users" },
      { label: "Invite users / assign roles", href: "/admin/invite" },
    ],
  },
  templates: {
    title: "Position Templates (ADM-007)",
    blurb: "Position Templates define the competencies, learning, assessments and workspaces a role receives — assigning a template to a person provisions all of it through the Workforce Assignment Engine. Template status is summarised on your dashboard.",
    links: [{ label: "Manage position templates", href: "/admin/positions" }],
  },
  configuration: {
    title: "System Configuration (ADM-008)",
    blurb: "Organisation-level configuration — branding, CPD targets, assessment defaults and platform behaviour. Managed in Settings and the configuration Studio.",
    links: [
      { label: "Open Settings", href: "/admin/settings" },
      { label: "Open Studio", href: "/admin/studio" },
    ],
  },
  settings: {
    title: "Settings (ADM-011)",
    blurb: "Organisation profile, contact details and workspace preferences.",
    links: [{ label: "Open Settings", href: "/admin/settings" }],
  },
};

export default async function OrgAdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/organisation-admin");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">{s.links?.length ? "Reuses existing surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.links?.map((l) => (
          <Link key={l.href} href={l.href} className="mt-3 block text-sm font-medium text-teal-700 hover:underline">{l.label} →</Link>
        ))}
      </div>
    </div>
  );
}
