import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// HEX-001 modules that reuse an existing surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; links?: { label: string; href: string }[] }> = {
  intelligence: {
    title: "Executive Intelligence (HEX-002)",
    blurb: "The Executive Command Center distils nursing service health into one evidence-based index across four domains — every number traceable to governed data. The wider analytics-intelligence suite drills into competency, quality, workforce and predictive views.",
    links: [
      { label: "Open the Executive Command Center", href: "/admin/executive" },
      { label: "Workforce intelligence & forecasting", href: "/admin/intelligence" },
    ],
  },
  workforce: {
    title: "Workforce Intelligence (HEX-003)",
    blurb: "Enterprise workforce readiness — headcount, establishment vs vacancy, competency currency, onboarding and learning compliance. Live on the executive dashboard and administered in the Human Resources workspace.",
    links: [
      { label: "Open Human Resources", href: "/human-resources" },
      { label: "Workforce readiness report", href: "/admin/workforce" },
    ],
  },
  financial: {
    title: "Financial Intelligence (HEX-004)",
    blurb: "Revenue, cost, margin and budget analytics. Competen holds no financial ledgers, so this module activates once a finance / ERP system is integrated. The people-cost drivers that are on platform — establishment, vacancy and headcount — are already live in Workforce readiness.",
  },
  reports: {
    title: "Executive Reports (HEX-008)",
    blurb: "Board packs and executive summaries. Today's governed reporting — workforce, quality and accreditation — is available in the intelligence surfaces; a one-click executive board-pack export is a later HEX phase.",
    links: [
      { label: "Open workforce & quality reporting", href: "/admin/intelligence" },
    ],
  },
  ai: {
    title: "AI Executive Advisor (HEX-009)",
    blurb: "Board-narrative generation, scenario modelling and strategic recommendations. A later phase; the readiness, quality, risk and initiative signals it reasons over are already live on your dashboard.",
    links: [{ label: "Back to the Executive Dashboard", href: "/hospital-executive" }],
  },
  settings: {
    title: "Settings (HEX-010)",
    blurb: "Executive workspace configuration, scorecard weighting and data-permission controls. A later phase.",
  },
};

export default async function ExecutiveSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/hospital-executive");

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
