import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Control-plane surfaces scaffolded for Phase 2–3 (LCP-001). Schema for several
// already lands in migrations 041–042; the operating UI follows.
const SECTIONS: Record<string, { title: string; phase: string; blurb: string; table?: string }> = {
  regions: { title: "Multi-Region Management (LCP-001 §21)", phase: "Phase 2", table: "plat_regions", blurb: "Regional hosting, data-residency policies and tenant→region routing. The region reference table (Africa, Europe, Middle East, Asia, US) is seeded; tenants carry a region_code. The routing/residency console lands in Phase 2." },
  billing: { title: "Billing Control Centre (LCP-001 §5)", phase: "Phase 2", table: "plat_billing_accounts", blurb: "Invoices, payments, renewals, taxes, coupons and revenue reporting over plat_billing_accounts (+ invoices/payments children). Depends on the subscription engine, which is live. No billing store exists yet — this activates when a payment gateway is connected." },
  deployments: { title: "Global Deployment Manager (LCP-001 §7–8)", phase: "Phase 3", table: "plat_deployments", blurb: "Coordinated releases, staged rollouts, per-tenant version tracking and rollback. Depends on leaving the single managed-deployment model — genuinely infra-heavy, so it comes last." },
  standards: { title: "Global Standards Library (LCP-001 §12)", phase: "Phase 2", blurb: "Master SafeCare / JCI / WHO / ICN / NMC frameworks inherited by every tenant. The mechanism already exists — platform-global frameworks are position_library / frameworks rows with tenant_id (or hospital_id) NULL. Versioned publishing and inheritance controls land in Phase 2." },
  identity: { title: "Identity & Federation (LCP-001 §19)", phase: "Phase 3", table: "plat_idp_configs", blurb: "SSO, SAML, OIDC, Azure AD / Google / Okta, MFA enforcement and SCIM provisioning per tenant. Fully greenfield — Competen uses Supabase-native auth today. Lands in Phase 3." },
};

export default async function ControlPlaneSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/platform/control-plane");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-100 rounded-full px-2.5 py-1">{s.phase}</span>
          {s.table && <span className="inline-block text-[10px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1">{s.table}</span>}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        <Link href="/platform/control-plane" className="mt-4 inline-block text-sm font-medium text-violet-700 hover:underline">← Back to control plane</Link>
      </div>
    </div>
  );
}
