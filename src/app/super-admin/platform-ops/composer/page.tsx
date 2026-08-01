import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadComposer } from "@/lib/config/composer";
import { CLASS_LABEL, SAFETY_LABEL } from "@/lib/config/registry";
import ScopePicker from "./ScopePicker";
import { StatWide as Stat } from "../_kit";

export const dynamic = "force-dynamic";

// Tenant Experience Composer (WCE-003) — the governed configuration overview integrating the registry
// (WCE-002) with the runtime overrides (WCE-001). Composer dashboard (§8) + registry-driven, inheritance-aware
// workspace catalogue (§5/§10). Editing delegates to the WCE-001 Designer; the deep builders are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const classTone = (c: string) => (c === "mandatory_locked" ? "bg-gray-800 text-white" : c.startsWith("mandatory") ? "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : c === "optional" ? "bg-[var(--cmp-surface-success)] text-emerald-700" : c === "conditional" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-gray-50 text-gray-500");
const actionTone = (t: string) => (t === "rose" ? "bg-[var(--cmp-color-error)]" : t === "amber" ? "bg-[var(--cmp-color-warning)]" : t === "sky" ? "bg-[var(--cmp-color-information)]" : "bg-gray-300");

export default async function TenantExperienceComposer({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const scopeType = typeof sp.scope === "string" ? sp.scope : "platform";
  const scopeRef = typeof sp.ref === "string" ? sp.ref : null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [d, hospitalsRes] = await Promise.all([
    loadComposer(admin, scopeType, scopeRef) as Promise<any>,
    admin.from("hospitals").select("id, name").order("name").limit(200),
  ]);
  const hospitals = hospitalsRes.data ?? [];
  const scopeName = scopeType === "hospital" ? (hospitals.find((h: any) => h.id === scopeRef)?.name ?? "Hospital") : "Platform default";

  const header = (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400"><Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Tenant Experience Composer</span></div>
      <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Tenant Experience Composer <span className="text-sm font-medium text-gray-400">WCE-003</span></h1>
      <p className="text-sm text-gray-500">Configure the platform experience per scope — governed by the registry (WCE-002), applied by the engine (WCE-001).</p>
    </div>
  );

  if (!d.registryProvisioned) return (
    <div data-wide className="space-y-4">{header}
      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800"><span className="font-semibold">Registry not provisioned.</span> WCE-003 configures the objects catalogued by WCE-002 — run <code className="font-mono text-[12px] bg-[var(--cmp-surface-warning)] px-1 rounded">migration 092</code> and sync the <Link href="/super-admin/platform-ops/registry" className="underline">Configuration Registry</Link> first.</div>
    </div>
  );

  return (
    <div data-wide className="space-y-4">
      {header}

      <div className={`${card} p-4 flex items-center justify-between gap-3 flex-wrap`}>
        <ScopePicker scopeType={scopeType} scopeRef={scopeRef} hospitals={hospitals} />
        <span className="text-xs text-gray-500">Configuring: <b className="text-gray-800">{scopeName}</b></span>
      </div>

      {/* Composer dashboard (§8) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">Config Health</p><p className={`text-2xl font-bold mt-0.5 ${d.health.band === "Healthy" ? "text-[var(--cmp-text-success)]" : d.health.band === "Attention" ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]"}`}>{d.health.score}%</p><p className="text-[10px] text-gray-400">{d.health.band}</p></div>
        <Stat label="Workspaces" value={d.summary.workspaces} />
        <Stat label="Enabled Modules" value={d.summary.enabledModules} tone="text-[var(--cmp-text-success)]" />
        <Stat label="Disabled Optional" value={d.summary.disabledOptional} tone={d.summary.disabledOptional ? "text-gray-600" : "text-gray-400"} />
        <Stat label="Local Overrides" value={d.summary.localOverrides} tone={d.summary.localOverrides ? "text-[var(--cmp-text-information)]" : "text-gray-400"} />
        <Stat label="Draft Changes" value={d.summary.draftChanges} tone={d.summary.draftChanges ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} />
        <Stat label="Validation Errors" value={d.summary.validationErrors} tone={d.summary.validationErrors ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Required actions (§8.4) */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Required Actions</h2>
          {d.actions.length === 0 ? <p className="text-sm text-gray-400 py-4">No outstanding configuration actions. 🎉</p> : (
            <div className="space-y-2">{d.actions.map((a: any, i: number) => (
              <Link key={i} href={a.href} className="flex items-start gap-2 rounded-lg hover:bg-gray-50 p-1.5 -mx-1.5"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${actionTone(a.tone)}`} /><div className="min-w-0"><p className="text-xs font-medium text-gray-800 leading-snug">{a.label}</p><p className="text-[10px] text-gray-400">{a.detail}</p></div></Link>
            ))}</div>
          )}
        </div>

        {/* Recent activity (§8.3) */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Recent Configuration Activity</h2><Link href="/super-admin/platform-ops/configuration" className="text-xs text-teal-700 hover:underline">Open Designer →</Link></div>
          {d.activity.length === 0 ? <p className="text-sm text-gray-400 py-4">No configuration changes recorded yet.</p> : (
            <div className="space-y-1.5">{d.activity.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs"><span className={`px-1.5 py-0.5 rounded font-semibold ${a.action === "publish" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : a.action === "rollback" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-[var(--cmp-surface-information)] text-blue-700"}`}>{a.action}</span><span className="text-gray-700 truncate flex-1">{a.config_path ?? `${a.scope_type} scope`}</span><span className="text-gray-400 shrink-0">{a.actor_name ?? "—"} · {relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Registry-driven workspace catalogue (§10) with inheritance (§5) */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap"><h2 className="text-sm font-bold text-gray-900">Workspace Catalogue <span className="text-[10px] text-gray-400 font-normal">from registry · effective at {scopeName}</span></h2><Link href="/super-admin/platform-ops/configuration" className="text-xs bg-teal-600 text-white rounded-lg px-3 py-1.5 hover:bg-teal-700 font-medium">Edit in Designer →</Link></div>
        <div className="space-y-4">
          {d.tree.map((ws: any) => (
            <div key={ws.key}>
              <div className="flex items-center gap-2 mb-1.5"><h3 className="text-sm font-bold text-gray-800">{ws.name}</h3>{ws.route && <span className="text-[10px] text-gray-400 font-mono">{ws.route}</span>}<span className={`text-[9px] px-1.5 py-0.5 rounded ${ws.wired ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-gray-100 text-gray-500"}`}>{ws.wired ? "runtime-wired" : "catalogued"}</span></div>
              <div className="space-y-1.5">
                {ws.sections.map((s: any) => (
                  <div key={s.key} className="rounded-lg border border-gray-100">
                    <ObjectRow o={s} bold />
                    {s.modules.length > 0 && <div className="pl-6 pr-2 pb-1.5 space-y-0.5">{s.modules.map((m: any) => <ObjectRow key={m.key} o={m} />)}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-3">Only registry-configurable objects are shown as editable; mandatory-locked objects are read-only (§3). Effective state resolves along Platform → Hospital → Unit → Role → User; the “source” is where the current value is set. Editing (toggle / rename / reorder / publish / rollback) runs through the WCE-001 Designer.</p>
      </div>

      {/* Honest next-phase */}
      <div className={`${card} border-dashed p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Roadmap — next-phase composer capabilities</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            ["Navigation & dashboard builders (§11–12)", "Drag-and-drop section/widget arrangement with responsive preview."],
            ["Widget library & forms composer (§13–14)", "Registry/WCE-005 widget catalogue + form/field configuration."],
            ["Permission matrix & workflows (§15–16)", "Role×object matrix, visual workflow/approval builder."],
            ["Branding, terminology & AI config (§20–21)", "Approved colour tokens, terminology sets, AI capability activation."],
            ["Change requests & phased publishing (§25–26)", "Governed change requests, sandbox→pilot→tenant rollout (WCE-004)."],
            ["Preview & testing centre (§23)", "Role/device/persona preview and validation before publish."],
          ].map(([t, x]) => <div key={t}><p className="text-xs font-semibold text-gray-600">{t}</p><p className="text-[10px] text-gray-400">{x}</p></div>)}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">WCE-003 MVP: a governed composer overview that integrates the Configuration Registry (WCE-002 — what may be configured, with each object’s configurability class, override policy and safety classification) with the runtime overrides (WCE-001 — what is configured), showing the config-health score, summary, required actions and the inheritance-aware workspace catalogue per scope. It exposes only registry-configurable objects and never invents settings (§3/§35). The actual toggle/rename/reorder/publish/rollback editing runs through the existing WCE-001 Designer; the navigation/dashboard/widget/form/workflow/permission builders, branding, templates, change-requests and phased publishing are honest next-phase. Super-admin gated.</p>
    </div>
  );
}

function ObjectRow({ o, bold }: { o: any; bold?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.enabled ? "bg-[var(--cmp-color-success)]" : "bg-gray-300"}`} title={o.enabled ? "Enabled" : "Disabled"} />
      <span className={`truncate ${bold ? "font-semibold text-gray-800" : "text-gray-700"}`}>{o.label}</span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${classTone(o.configClass)}`} title={SAFETY_LABEL[o.safety] ?? o.safety}>{CLASS_LABEL[o.configClass] ?? o.configClass}</span>
      {o.locked && <span className="text-[9px] text-gray-400 shrink-0">🔒 locked</span>}
      {o.hasLocalOverride && <span className="text-[9px] text-[var(--cmp-text-information)] shrink-0">override here</span>}
      {o.hasDraft && <span className="text-[9px] text-[var(--cmp-text-warning)] shrink-0">draft</span>}
      <span className="ml-auto text-[9px] text-gray-400 shrink-0">source: {o.source === "platform-default" ? "default" : o.source}</span>
    </div>
  );
}
