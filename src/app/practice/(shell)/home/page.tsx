import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";

// CPR-001 V3 Practice Command Centre -- the default authorised landing (SHELL-001 s8).
//
// EVERY NUMBER ON THIS PAGE IS A REAL QUERY AGAINST THE CALLER'S OWN WORKSPACE, and the widgets whose
// engines have not shipped SAY WHICH PHASE BRINGS THEM instead of rendering fake zeros dressed as
// activity. CPR-001 V3 specifies Today's Activity, Patient Actions, Practice Metrics, Intelligence and
// Recent Activity; today the truthful subset is workspace status, entitlement, locations, team and the
// audit trail -- which is real recent activity, because provisioning and onboarding wrote it.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function PracticeHome() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  const admin = createAdminClient();

  const [{ count: locations }, { count: members }, { data: entitlement }, { data: events }] = await Promise.all([
    admin.from("practice_location").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_membership").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    admin.from("practice_entitlement").select("plan_code, status, ends_at").eq("workspace_id", ctx.workspaceId).in("status", ["active", "trial"]).limit(1).maybeSingle(),
    admin.from("practice_audit_event").select("event_type, occurred_at").eq("workspace_id", ctx.workspaceId).order("occurred_at", { ascending: false }).limit(8),
  ]);

  // Request-time is the CORRECT time here: this is a force-dynamic server component, rendered once per
  // request, and "days left on the trial" is a fact about now. The impure-render rule exists for client
  // components that re-render; a per-request server render is exactly the place a clock read belongs.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const trialDaysLeft = entitlement?.ends_at
    ? Math.max(0, Math.ceil((new Date(entitlement.ends_at).getTime() - now) / 86400000))
    : null;

  const metrics = [
    { label: "Practice locations", value: String(locations ?? 0) },
    { label: "Team members", value: String(members ?? 0) },
    { label: "Plan", value: entitlement?.status === "trial" ? `Trial${trialDaysLeft !== null ? ` · ${trialDaysLeft}d left` : ""}` : (entitlement?.plan_code ?? "—") },
    { label: "Workspace", value: ctx.workspaceStatus },
  ];

  // The clinical widgets, named honestly by the phase that ships them (CPR-BUILD-000).
  const upcoming = [
    { title: "Today's appointments", phase: "Phase 1 — Calendar & scheduling" },
    { title: "Find patient / register walk-in", phase: "Phase 2 — Patient identity" },
    { title: "New encounter", phase: "Phase 3 — Clinical encounter" },
    { title: "Follow-ups due", phase: "Phase 4 — Continuity" },
    { title: "Practice intelligence", phase: "Phase 5 — Case memory" },
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Practice Command Centre</h1>
      <p className="mt-1 text-[13px] text-gray-500">
        Your workspace is provisioned and active. The clinical workspaces light up here phase by phase.
      </p>

      {/* Practice metrics -- real counts from this workspace's rows */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{m.label}</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid lg:grid-cols-2 gap-4">
        {/* Recent activity -- the audit trail is real from the first provisioning event */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Recent activity</h2>
          {((events ?? []) as any[]).length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No activity recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {((events ?? []) as any[]).map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-gray-700 font-mono truncate">{e.event_type}</span>
                  <span className="text-gray-400 shrink-0" suppressHydrationWarning>
                    {new Date(e.occurred_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* What arrives next -- honest, phase-labelled, not disabled buttons pretending to be features */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Arriving on this dashboard</h2>
          <p className="mt-1 text-[11px] text-gray-400">
            These CPR-001 widgets render only when their engines ship. Nothing here fakes a zero.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {upcoming.map(u => (
              <li key={u.title} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-gray-700">{u.title}</span>
                <span className="text-gray-400 shrink-0">{u.phase}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
