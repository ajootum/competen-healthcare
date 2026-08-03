import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getConfiguration, listLocations, configurationHistory } from "@/lib/practice/configuration";
import SettingsConsole from "./SettingsConsole";

// /practice/settings -- CPR-360. The nav has pointed at this route since Phase 0 with `built: false`.
//
// THE INERT COLUMNS ARE LISTED RATHER THAN RENDERED AS INPUTS. migration 191 created identifier_policy,
// feature_flags and date_format, and nothing has ever read any of them. Drawing a form field for a
// value no code honours is the most direct way to lie to somebody about their own configuration -- they
// would set it, save it, and watch nothing change. They are named on the page as not yet wired instead.

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.settings.manage")) redirect("/practice/home");

  const admin = createAdminClient();
  const [configuration, locations, history] = await Promise.all([
    getConfiguration(admin, shell.ctx.workspaceId),
    listLocations(admin, shell.ctx.workspaceId),
    configurationHistory(admin, shell.ctx.workspaceId),
  ]);
  if (!configuration) redirect("/practice/home");

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900">Practice settings</h1>
      <p className="mt-0.5 text-[13px] text-gray-500">
        How this practice is set up. Today here is {configuration.today} &mdash; every &ldquo;overdue&rdquo;,
        every day view and every report period is worked out from this clock.
      </p>

      <SettingsConsole
        workspace={configuration.workspace}
        config={configuration.config}
        today={configuration.today}
        inertColumns={configuration.inertColumns}
        locations={locations}
        history={history}
        canManageLocations={hasCapability(shell.ctx, "practice.locations.manage")}
      />
    </div>
  );
}
