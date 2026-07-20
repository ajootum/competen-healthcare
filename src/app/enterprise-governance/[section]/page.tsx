import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// EGV-001 modules that reuse an existing surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; links?: { label: string; href: string }[] }> = {
  analytics: {
    title: "Enterprise Analytics (EGV-006)",
    blurb: "Cross-organisation trend analysis of competency, quality and workforce. Live comparison is on the benchmarking dashboard; the deeper analytics-intelligence suite drills into each domain.",
    links: [
      { label: "Open Enterprise Benchmarking", href: "/enterprise-governance/benchmarking" },
      { label: "Open the intelligence suite", href: "/admin/intelligence" },
    ],
  },
  ai: {
    title: "AI Enterprise Intelligence (EGV-007)",
    blurb: "Cross-tenant anomaly detection, standards-drift analysis and AI-generated governance narratives. A later phase; the benchmarking, standards and compliance signals it reasons over are already live on your dashboard.",
    links: [{ label: "Back to the Dashboard", href: "/enterprise-governance" }],
  },
  reports: {
    title: "Reports (EGV-008)",
    blurb: "Board and executive governance reports. Today's governed reporting — competency, quality and workforce — is available in the intelligence surfaces; a one-click enterprise governance board-pack export is a later EGV phase.",
    links: [{ label: "Open workforce & quality reporting", href: "/admin/intelligence" }],
  },
  settings: {
    title: "Settings (EGV-009)",
    blurb: "Enterprise governance configuration — benchmark weighting, standards-inheritance policy and governance-workflow rules. A later phase.",
  },
};

export default async function EgvSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = SECTIONS[section];
  if (!s) redirect("/enterprise-governance");

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
