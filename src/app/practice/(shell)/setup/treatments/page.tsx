import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { treatmentOptions, treatmentTemplates } from "@/lib/practice/treatment-capture";
import { captureSettings } from "@/lib/practice/investigations";
import TreatmentConfigurationConsole from "./TreatmentConfigurationConsole";

// CPR-TREAT-001 s6 and s7 -- PRACTICE SETUP: THE TREATMENT LISTS.
//
// ⚠ THIS PAGE IS WHAT MAKES AC-05 TRUE. "Practice can change configured options WITHOUT A SOFTWARE
// DEPLOYMENT." A configurable list with no configuration screen is a claim nobody can act on, so the
// frozen requirement in s6 is only actually met once there is a place to act on it.
//
// ⚠ NESTED UNDER /practice/setup, so it needs no navigation entry -- the same reasoning
// /practice/setup/clinical-parameters records: the orphan scan reads the top-level directories of
// (shell), and navigation.ts is frozen.
//
// ⚠ THE READ GATE IS treatment.record AND THE WRITE GATE IS treatment.configure. s6: "Safety-critical
// configuration must be permission-controlled, versioned and auditable." Changing what everybody may
// prescribe from is a different act from prescribing, so it is a different capability.

export const dynamic = "force-dynamic";

export default async function PracticeTreatmentSetupPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "treatment.record") && !hasCapability(shell.ctx, "treatment.configure"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  const [options, templates, settings] = await Promise.all([
    treatmentOptions(admin, shell.ctx),
    treatmentTemplates(admin, shell.ctx, shell.ctx.userId),
    captureSettings(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            &#9636;
          </span>
          <div className="min-w-0 flex-1">
            <Link href="/practice/setup" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              &larr; Practice Setup
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Treatment lists</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              What a prescriber can tap instead of typing: formulations, dose units, routes, frequencies,
              durations, treatment types and non-drug categories. Turn anything off, rename it for how
              this practice speaks, or add your own.
            </p>
          </div>
        </div>

        <p className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[12px] text-gray-600">
          {/* ⚠ THE BOUNDARY ON THE CONFIGURATION SCREEN TOO. Somebody building a formulary here is
              exactly the person who could come to believe this product transmits a prescription. */}
          Nothing configured on this page is clinical advice, a dose range or a safety rule. These are the
          words a prescriber selects from. What was prescribed is recorded; what was administered is not,
          because Competen Practice holds no administration chart.
        </p>

        <TreatmentConfigurationConsole
          options={options}
          templates={templates}
          reasonRequired={settings.treatmentReasonRequired}
          settingsUnreadable={settings.unreadable}
          canConfigure={hasCapability(shell.ctx, "treatment.configure")}
        />
      </div>
    </div>
  );
}
