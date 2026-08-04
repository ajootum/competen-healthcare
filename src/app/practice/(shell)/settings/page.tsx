import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getConfiguration, listLocations, configurationHistory } from "@/lib/practice/configuration";
import { resolvePreferences, configurationChecklist } from "@/lib/practice/preferences";
import SettingsConsole from "./SettingsConsole";
import PersonalisationConsole from "./PersonalisationConsole";

// /practice/settings -- CPR-360 CONFIGURATION AND PERSONALISATION.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// REBUILT AFTER CPR-AUDIT-001. What was here was workspace configuration -- practice name, timezone,
// locations, appointment length -- which is roughly a fifth of this specification and appears in its
// comp as two fields inside one panel. The commit message asserting that "nothing in this product has a
// per-user preference worth storing" was written without opening a specification that is mostly
// per-user preferences.
//
// The workspace configuration is kept in full and is still the right thing; it moved down the page, to
// where the comp puts it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NO CAPABILITY GUARDS THE PAGE. It guards the PRACTICE half, inside. Somebody who needs larger text or
// a dark screen must not have to hold an administrative permission to get it, and the previous guard
// meant exactly that -- everybody without practice.settings.manage was redirected away from their own
// accessibility settings.

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;

  const canManagePractice = hasCapability(ctx, "practice.settings.manage");
  const admin = createAdminClient();

  const [resolved, checklist, configuration, locations, history] = await Promise.all([
    resolvePreferences(admin, ctx.workspaceId, ctx.userId),
    configurationChecklist(admin, ctx.workspaceId, ctx.userId),
    canManagePractice ? getConfiguration(admin, ctx.workspaceId) : Promise.resolve(null),
    canManagePractice ? listLocations(admin, ctx.workspaceId) : Promise.resolve([]),
    canManagePractice ? configurationHistory(admin, ctx.workspaceId) : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Configuration and personalisation</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Tailor Competen Practice to your specialty, workflow and preferences.
          </p>
        </div>
        {canManagePractice && (
          // CPR-PRM-001 s9. Its own page rather than a panel here: authoring a form is a sitting's
          // work, and it has a draft/publish lifecycle that does not belong inside a settings list.
          <Link href="/practice/settings/registration-form"
            className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
            Registration form →
          </Link>
        )}
      </div>

      {/* ── The comp's Configuration Health ring, as a count and its denominator ──────────────────
          The comp draws "92% Configured". There is no formula behind that and there could not be one:
          configured is not a quantity. The CHECKLIST beside the ring is the useful part, and it is what
          survives -- each line naming something a reader can go and do. Same doctrine as CPR-270's. */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-bold text-gray-900">Set up so far</h2>
          <span className="text-[11px] text-gray-500">{checklist.done} of {checklist.total} done</span>
        </div>
        <ul className="mt-2 grid sm:grid-cols-2 gap-x-4">
          {checklist.items.map(i => (
            <li key={i.key} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5">
              <span aria-hidden className={i.done ? "text-[var(--cmp-text-success)]" : "text-gray-300"}>
                {i.done ? "✓" : "○"}
              </span>
              <span className="min-w-0">
                <Link href={i.href} className="block text-[12px] font-semibold text-gray-800 hover:underline">
                  {i.label}
                </Link>
                <span className="block text-[10px] text-gray-500">{i.hint}</span>
              </span>
              <span className="sr-only">{i.done ? "done" : "not done"}</span>
            </li>
          ))}
        </ul>
      </section>

      <PersonalisationConsole
        preferences={resolved.preferences}
        locked={resolved.locked}
        practice={resolved.practice}
      />

      {canManagePractice && configuration && (
        <>
          <h2 className="mt-6 text-[15px] font-bold text-gray-900">This practice</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Settings for everyone here, not just for you. Today is {configuration.today} &mdash; every
            &ldquo;overdue&rdquo;, every day view and every report period is worked out from this clock.
          </p>
          <SettingsConsole
            workspace={configuration.workspace}
            config={configuration.config}
            today={configuration.today}
            inertColumns={configuration.inertColumns}
            locations={locations}
            history={history}
            canManageLocations={hasCapability(ctx, "practice.locations.manage")}
          />
        </>
      )}

      {!canManagePractice && (
        <p className="mt-6 text-[11px] text-gray-500">
          Practice-wide settings &mdash; name, clock, locations &mdash; are managed by whoever holds that
          permission here. The settings above are yours and follow you between devices.
        </p>
      )}
    </div>
  );
}
