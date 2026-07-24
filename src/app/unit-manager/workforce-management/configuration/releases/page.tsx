import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceConfig } from "@/lib/operations/workforce-config";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import ConfigTabs from "../ConfigTabs";

export const dynamic = "force-dynamic";

// Versions, Releases & Rollback (UMW-WFM-009 §23-26) — the active config release is the current
// wps_config version (published, effective-dated by updatedAt). The full change-set → validate →
// simulate → approve → schedule → publish → rollback lifecycle needs configuration-release +
// change-set stores → honest next-phase; the state model + rollback rules are shown as reference.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const STATES = ["Draft", "Validated", "Submitted", "Approved", "Scheduled", "Effective", "Superseded", "Rolled back", "Archived"];

export default async function ReleasesConfig() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceConfig(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);
  const p = d.profile;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">⚙️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration · Versions &amp; Releases</h1><p className="text-sm text-gray-500">Change sets, validation, approvals, publishing and rollback.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <ConfigTabs />

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Active release <span className="text-[10px] text-gray-400 font-normal">CFG-REL-01 · live</span></h3>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3 flex items-center justify-between flex-wrap gap-3">
          <div><p className="text-sm font-bold text-emerald-700">wps_config v{p.version}{p.published ? "" : " (defaults)"}</p><p className="text-[11px] text-gray-600 mt-0.5">Effective {fmtDate(p.updatedAt)}{p.updatedByName ? ` · ${p.updatedByName}` : ""} · consumed by all 8 WFM modules</p></div>
          <Link href="/unit-manager/planning-studio" className="text-[11px] font-semibold rounded-lg px-3 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 shrink-0">Publish new version ↗</Link>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Publishing (versioned + audited) runs through the Workforce Planning Studio → /api/config/planning. Each publish bumps the version; consumers resolve by version (§26).</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Lifecycle state model <span className="text-[10px] text-gray-400 font-normal">§23</span></h3>
          <div className="flex flex-wrap gap-1.5">{STATES.map(st => (<span key={st} className={`text-[10px] rounded-full px-2 py-0.5 ${st === "Effective" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "border border-gray-200 text-gray-600"}`}>{st}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Draft never controls operations; only approved+effective config does (§3). Full change-set lifecycle + scheduled/future-dated releases need the release store.</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Governance controls <span className="text-[10px] text-gray-400 font-normal">§24-26</span></h3>
          <div className="flex flex-wrap gap-1.5">{["Change sets", "Cross-rule validation", "Impact analysis", "Sandbox simulation", "Segregation of duties", "Immutable checksum", "Consumer acknowledgement", "Governed rollback"].map(x => (<span key={x} className="text-[10px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{x}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Rollback creates a new release event, never erasing history (§26.1). High-risk changes need multi-role approval + simulation (Appendix B) → next-phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Versions, Releases &amp; Rollback (UMW-WFM-009 §23-26). The active release is real (wps_config version); the change-set/validation/simulation/approval/rollback governance is next-phase. <Link href="/unit-manager/workforce-management/configuration" className="text-emerald-700 hover:underline">← Dashboard</Link></p>
    </div>
  );
}
