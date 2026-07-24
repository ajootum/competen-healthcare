import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPosConfig } from "@/lib/operations/pos-config";
import { CONFIG_NEXT_PHASE, configRule } from "@/lib/operations/pos-config-schema";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import PosTabs from "../PosTabs";
import ConfigConsole from "./ConfigConsole";

export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Configuration & Rules (POS-112) — the governed, versioned, effective-dated configuration that
// parameterises patient operations. Real: observation frequency by acuity and escalation PEWS
// thresholds / SLAs, editable with an append-a-new-version history (op_config_rules, migration 086).
// Honest next-phase: bed/ward type registry, forms/custom fields, permission matrix, AI rules — and
// progressive wiring of each consumer to read these overrides (called out per domain).
const fmtDateTime = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString([], { day: "2-digit", month: "short" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`; };

export default async function PatientOpsConfiguration() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadPosConfig(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Configuration &amp; Rules</h1><p className="text-sm text-gray-500">The governed, versioned rules that parameterise patient operations.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <PosTabs />

      {!d.provisioned && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800"><b>Store not provisioned.</b> Migration 086 isn&apos;t applied yet — rules below show platform defaults and are read-only until it&apos;s run.</div>}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">Configurable rules</p><p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{d.total}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">Tenant overrides</p><p className="text-2xl font-bold tabular-nums mt-1 text-emerald-600">{d.overridden}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500">On defaults</p><p className="text-2xl font-bold tabular-nums mt-1 text-gray-500">{d.total - d.overridden}</p></div>
      </div>

      {/* Editable governed rules */}
      <ConfigConsole domains={d.domains} />

      {/* Recent changes + honest next-phase domains */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent configuration changes</h3>
          {d.recent.length === 0 ? <p className="text-sm text-gray-400">No overrides yet — all rules on platform defaults.</p> : (
            <div className="divide-y divide-gray-50">
              {d.recent.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0"><span className="text-gray-700">{configRule(r.domain, r.rule_key)?.label ?? r.rule_key}</span><span className="text-gray-400"> → {r.value?.v}</span></span>
                  <span className="text-gray-400 shrink-0 tabular-nums">v{r.version} · {r.creator?.full_name ?? "—"} · {fmtDateTime(r.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Further configuration <span className="text-[10px] font-normal text-gray-400">next-phase</span></h3>
          <div className="space-y-2">
            {CONFIG_NEXT_PHASE.map(x => (
              <div key={x.name} className="flex items-start gap-2.5"><span className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{x.icon}</span><div><p className="text-xs font-semibold text-gray-700">{x.name}</p><p className="text-[11px] text-gray-400">{x.note}</p></div></div>
            ))}
          </div>
          <Link href="/supervisor/config-centre" className="mt-3 inline-block text-[11px] font-medium text-emerald-700 hover:underline">Operational Config Centre →</Link>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Configuration &amp; Rules (POS-112) over op_config_rules (migration 086). Real: observation-frequency and escalation-threshold rules, editable with a versioned, effective-dated, audited history — changes append a new version and never rewrite the past (§14). A rule with no override falls back to its coded default. Honest next-phase: the bed/ward type registry, forms/custom-field templates, the permission matrix and AI-rules store — plus progressively wiring each engine (observation scheduler, escalation, pressure score) to read these overrides, called out per domain.</p>
    </div>
  );
}
