import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Internal-staff hub (PLA-001).
const card = "bg-white rounded-xl border border-gray-200 p-5";
const STAFF = [
  { icon: "🤝", label: "Customer Success", href: "/platform/staff/customer-success", sub: "Tenant health, onboarding, renewals", live: true },
  { icon: "🎧", label: "Support", href: "/platform/staff/support", sub: "Ticket queue", live: true },
  { icon: "💷", label: "Finance", href: "/platform/staff/finance", sub: "MRR, plan mix, billing", live: true },
  { icon: "🧭", label: "Product", href: "/platform/staff/product", sub: "Product & module governance", live: true },
  { icon: "💻", label: "Engineering", href: "/platform/staff/engineering", sub: "Release log & platform scale", live: true },
  { icon: "✨", label: "AI Operations", href: "/platform/staff/ai-ops", sub: "Provider status & AI usage", live: true },
  { icon: "🔬", label: "Quality", href: "/platform/staff/quality", sub: "Platform quality & standards", live: true },
  { icon: "🛡️", label: "Security", href: "/platform/staff/security", sub: "SOC over audit & events", live: true },
];

export default async function StaffHub() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Staff</h1>
        <p className="text-sm text-gray-500 mt-1">The internal-staff org that operates the platform · {caller.fullName ?? "Operator"}</p>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {STAFF.map(s => (
          <Link key={s.href} href={s.href} className={`${card} hover:border-violet-300 transition-colors block`}>
            <div className="flex items-center gap-2 mb-1"><span className="text-lg">{s.icon}</span><span className="font-semibold text-gray-900 text-sm">{s.label}</span>{!s.live && <span className="ml-auto text-[10px] text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">Phase 3</span>}</div>
            <p className="text-xs text-gray-500">{s.sub}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
