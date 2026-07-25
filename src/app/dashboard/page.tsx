import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { type AppRole } from "@/lib/roles";
import { workspaceLinksForUser } from "@/lib/workspace-links";
import { loadPersonalWorkspace } from "@/lib/personal-workspace";
import { resolveDashboardManifest, inZone, type ManifestEntry } from "@/lib/orchestration/dashboard-manifest";
import { WIDGET_COMPONENTS, DEFAULT_DASHBOARD_MANIFEST } from "./dashboard-registry";
import WidgetBoundary from "./WidgetBoundary";
import type { WidgetCtx } from "./widgets";

// Personal Workspace (PW-000 / PW-001) — now COMPOSED from a resolved widget manifest (PW-014 WS2). Which widgets
// render, in what order, comes from resolveDashboardManifest (WCE config, PW-AC-06 — configurable without code);
// each widget is an isolated async server component wrapped in a boundary (PW-AC-07 — one failure never blanks the
// page). Data is loaded once (fail-soft) and passed to widgets. Scoped to the person; never expands access.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const nowMs = () => Date.now(); // module helper — direct Date.now() in render trips the purity rule
function clock() { const d = new Date(); return { hour: d.getHours(), date: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }; }

// Render one widget from the registry, isolated (PW-AC-07). Suspense makes the async widget a streaming boundary
// so a throw is caught by WidgetBoundary while siblings render.
function Widget({ entry, d, ctx }: { entry: ManifestEntry; d: any; ctx: WidgetCtx }) {
  const Comp = WIDGET_COMPONENTS[entry.key] as any;
  if (!Comp) return null;
  return (
    <WidgetBoundary name={entry.label}>
      <Suspense fallback={<div className={`${card} p-5 h-full min-h-[120px] animate-pulse`} />}>
        <Comp d={d} ctx={ctx} />
      </Suspense>
    </WidgetBoundary>
  );
}

export default async function PersonalWorkspacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  const userRoles: AppRole[] = (profile.roles?.length ? profile.roles : [profile.role]).filter(Boolean) as AppRole[];

  const [d, workspaces, manifest] = await Promise.all([
    loadPersonalWorkspace(admin, user.id, profile) as Promise<any>,
    workspaceLinksForUser(admin, user.id, userRoles).catch(() => []),
    resolveDashboardManifest(admin, { tenantId: profile.tenant_id ?? null, hospitalId: profile.hospital_id ?? null, unitId: profile.unit_id ?? null, roles: userRoles, userId: user.id }, DEFAULT_DASHBOARD_MANIFEST),
  ]);

  const { hour, date } = clock();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const ctx: WidgetCtx = { firstName: d.firstName, greeting, now: nowMs(), workspaces };
  const s = d.summary;
  const SUMMARY = [
    { icon: "🎯", label: "My Score", value: s.myScore != null ? `${s.myScore}%` : "—", tone: s.myScore != null && s.myScore >= 85 ? "text-emerald-600" : "text-amber-600", sub: null, href: "/dashboard/passport" },
    { icon: "📋", label: "Tasks", value: s.tasksDueToday, tone: s.tasksDueToday ? "text-rose-600" : "text-gray-900", sub: "Due Today", href: "/dashboard/tasks" },
    { icon: "👥", label: "Patients", value: s.patientsAssigned, tone: "text-gray-900", sub: "Assigned", href: "/dashboard/shift" },
    { icon: "✉️", label: "Messages", value: s.messagesUnread, tone: s.messagesUnread ? "text-rose-600" : "text-gray-900", sub: "Unread", href: "/dashboard/messages" },
    { icon: "⚠️", label: "Alerts", value: s.alertsHighPriority, tone: s.alertsHighPriority ? "text-rose-600" : "text-gray-900", sub: "High Priority", href: "/dashboard/notifications" },
  ];

  const main = inZone(manifest, "main"), rail = inZone(manifest, "rail"), full = inZone(manifest, "full");

  return (
    <div className="max-w-7xl space-y-4">
      {/* Header (identity chrome — always present) */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Personal Dashboard</p>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{greeting}, {d.firstName} 👋</h1>
          <p className="text-sm text-gray-400">{date}</p>
        </div>
        <div className={`${card} p-1.5 flex items-center divide-x divide-gray-100`}>
          {SUMMARY.map(k => (
            <Link key={k.label} href={k.href} className="px-3.5 py-1 flex flex-col items-center hover:bg-gray-50 rounded-lg transition-colors min-w-[74px]">
              <span className="text-[10px] text-gray-400 flex items-center gap-1">{k.icon} {k.label}</span>
              <span className={`text-lg font-bold tabular-nums ${k.tone}`}>{k.value}</span>
              {k.sub && <span className="text-[9px] text-gray-400">{k.sub}</span>}
            </Link>
          ))}
        </div>
      </div>

      {/* Composed widget grid — main + right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-min">
          {main.map(e => <div key={e.key} className={e.span === 2 ? "md:col-span-2" : ""}><Widget entry={e} d={d} ctx={ctx} /></div>)}
        </div>
        <div className="space-y-4">
          {rail.map(e => <Widget key={e.key} entry={e} d={d} ctx={ctx} />)}
        </div>
      </div>

      {/* Full-width footer row */}
      {full.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {full.map(e => <div key={e.key} className={e.span === 2 ? "lg:col-span-2" : ""}><Widget entry={e} d={d} ctx={ctx} /></div>)}
        </div>
      )}

      <p className="text-[11px] text-gray-400">Your Personal Workspace aggregates your own work across the platform — assigned patients, tasks, competencies, learning, schedule, messages and notifications. It references source records and never expands your access. Widgets are composed from a configurable manifest (each isolated so one failure never blanks the page); which widgets appear and their order can be configured without a code change.</p>
    </div>
  );
}
