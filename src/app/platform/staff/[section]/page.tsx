import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Staff workspaces scaffolded for Phase 3 (PLA-001).
const SECTIONS: Record<string, { title: string; blurb: string }> = {
  product: { title: "Product Management (PRD-001)", blurb: "Govern products & modules across tenants — enablement, rollout cohorts and roadmap. Product enablement rides feature-flag assignments today (Control Plane → Feature Flags / Products); a dedicated product console lands in Phase 3." },
  engineering: { title: "Engineering (ENG-001)", blurb: "Deployments, version tracking, environment and incident tooling. Deployment orchestration and per-tenant versioning are Phase 3 (plat_deployments / plat_tenant_versions); today's operational status is in the Platform Operations workspace." },
  "ai-ops": { title: "AI Operations (AIS-001)", blurb: "Model providers, prompt libraries, token budgets and AI governance across tenants. AI provider status is live in Platform Operations → AI; full budget/routing controls are Phase 3." },
  quality: { title: "Quality & Compliance (QLT-001)", blurb: "Platform-wide quality, compliance monitoring and standards governance. The Global Standards Library (master frameworks) is the data spine; the quality console lands in Phase 3." },
  security: { title: "Security Operations (SEC-001)", blurb: "Authentication monitoring, security events and threat response. The security signal is live in Platform Operations → Security (audit trail) and the Event Centre; a dedicated SOC console is Phase 3." },
};

export default async function StaffSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/platform/staff");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-100 rounded-full px-2.5 py-1 mb-3">Phase 3</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        <Link href="/platform/control-plane" className="mt-4 inline-block text-sm font-medium text-violet-700 hover:underline">← Control plane</Link>
      </div>
    </div>
  );
}
