import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Placeholder for SSW-001 sections whose workflow is a later phase. Honest about
// what's coming and where the real work already lives.

const SECTIONS: Record<string, { title: string; blurb: string; ready?: { label: string; href: string } }> = {
  handover: {
    title: "Handover Centre",
    blurb: "Structured SBAR shift handover — auto-built from this shift's patients, outstanding tasks and open escalations, with read-acknowledgement by the receiving clinician. Its data foundation (shifts, tasks, escalations, op_handovers table) is in place; the workflow is the next SSW build.",
  },
  communication: {
    title: "Communication Centre",
    blurb: "Secure operational messaging — individual, group and broadcast, with priority and read-acknowledgements. A later SSW phase; the notification channel it builds on is already live.",
  },
  ai: {
    title: "AI & Intelligence",
    blurb: "Operational AI copilot — safe-staffing, workload and capacity recommendations for the shift. Arrives in a later phase; the live data it will reason over (staffing, acuity, escalations) is already on your dashboard.",
    ready: { label: "Open the Shift Dashboard", href: "/supervisor" },
  },
  analytics: {
    title: "Analytics & Reports",
    blurb: "Shift and unit operational analytics and exportable reports. A later phase; live operational metrics are already summarised on your dashboard.",
    ready: { label: "Open the Shift Dashboard", href: "/supervisor" },
  },
  settings: {
    title: "Tools & Settings",
    blurb: "Workspace preferences, thresholds (EWS trigger values, escalation SLAs) and shift configuration. A later phase.",
  },
};

export default async function SupervisorSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = SECTIONS[section];
  if (!s) redirect("/supervisor");

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">{s.title}</h1>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-teal-600 bg-teal-50 border border-teal-100 rounded-full px-2.5 py-1 mb-3">Next phase</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.ready && <Link href={s.ready.href} className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">{s.ready.label} →</Link>}
      </div>
    </div>
  );
}
