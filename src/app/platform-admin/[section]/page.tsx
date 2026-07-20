import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// PSA-001 modules that reuse an existing surface or are a later phase.

const SECTIONS: Record<string, { title: string; blurb: string; links?: { label: string; href: string }[] }> = {
  configuration: {
    title: "Platform Configuration (PSA-003)",
    blurb: "Global configuration, feature flags, environment variables, branding and default templates. Platform settings and content configuration are managed in the super-admin Settings and Studio surfaces; environment variables live in the deployment platform (Vercel), not in the database.",
    links: [
      { label: "Open Platform Settings", href: "/super-admin/settings" },
      { label: "Open Studio", href: "/super-admin/studio" },
    ],
  },
  licensing: {
    title: "Licensing (PSA-004)",
    blurb: "Licence and subscription management. Competen has no billing/subscription store in this deployment, so licence utilisation activates once a billing system is connected. Tenant and user counts — the drivers a licence model bills against — are live in Tenant Management and Platform Analytics.",
    links: [
      { label: "Open Tenant Management", href: "/platform-admin/tenants" },
      { label: "Open Platform Analytics", href: "/platform-admin/analytics" },
    ],
  },
  infrastructure: {
    title: "Infrastructure Monitoring (PSA-005)",
    blurb: "Servers, containers, databases, storage, cache, message queues and background jobs. Competen runs on managed cloud (Vercel + Supabase), which own this telemetry — it is observed in their consoles rather than mirrored in-app, so no fabricated gauges are shown here. The service checks Competen can observe directly are on the System Health page.",
    links: [{ label: "Open System Health", href: "/platform-admin/health" }],
  },
  api: {
    title: "API Management (PSA-006)",
    blurb: "API catalogue, API keys, OAuth configuration, rate limiting, webhooks and API analytics. Competen exposes internal application APIs but has no external API-key store or gateway in this deployment, so an API-management console activates when an API gateway is introduced.",
  },
  settings: {
    title: "Settings (PSA-012)",
    blurb: "Platform Super Admin workspace preferences and platform-wide defaults.",
    links: [{ label: "Open Platform Settings", href: "/super-admin/settings" }],
  },
};

export default async function PsaSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) redirect("/platform-admin");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-100 rounded-full px-2.5 py-1 mb-3">{s.links?.length ? "Reuses existing surface" : "Not measured in-app"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.links?.map((l) => (
          <Link key={l.href} href={l.href} className="mt-3 block text-sm font-medium text-rose-700 hover:underline">{l.label} →</Link>
        ))}
      </div>
    </div>
  );
}
