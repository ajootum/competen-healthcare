import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { investigationCatalogue } from "@/lib/practice/investigations";
import InvestigationCatalogueConsole from "./InvestigationCatalogueConsole";

// CINV-CAP-001 s5 -- PRACTICE SETUP: THE INVESTIGATIONS PAGE.
//
// s5 names six things and this page is those six:
//   "Practice Setup -> Investigations exposes the practice catalogue / enable or disable master items
//    without deleting them / override display name while preserving the master ID relationship / create
//    a custom investigation / custom items require name, category and active status / a practice may add
//    a custom item to Quick Add immediately."
//
// ⚠ IT IS NOT A SIDEBAR ITEM AND IT DOES NOT NEED TO BE. navigation.ts carries a freeze notice and
// PRIMARY_ORDER is pinned by sixteen assertions. This route is NESTED UNDER /practice/setup for the
// reason /practice/setup/clinical-parameters gives verbatim: the orphan scan reads the TOP-LEVEL
// directories of (shell), so a child of an existing section needs no allowlist entry and changes no
// count. /practice/setup/availability-booking is the precedent and clinical-parameters is the second.
//
// ⚠ THE READ GATE IS THE ENCOUNTER CAPABILITY, NOT THE CONFIGURATION ONE. Somebody who records
// investigations should be able to SEE what this practice offers. The controls are gated separately,
// inside the console, from canConfigure -- the same split /practice/setup/clinical-parameters makes
// between parameter.view and parameter.configure.
//
// ⚠ WHAT IS NOT ON THIS PAGE. There is no "sync with the master catalogue" button and no import. Master
// catalogue edits are platform governance (s10) and this product has no route into them from a practice,
// so drawing one would be a control that does nothing.

export const dynamic = "force-dynamic";

export default async function PracticeInvestigationsSetupPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.edit") && !hasCapability(shell.ctx, "investigation.configure"))
    redirect("/practice/setup");

  const admin = createAdminClient();
  const library = await investigationCatalogue(admin, shell.ctx, shell.ctx.userId);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            &#9673;
          </span>
          <div className="min-w-0 flex-1">
            <Link href="/practice/setup" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              &larr; Practice Setup
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Investigations</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              What this practice can select when recording an investigation, what it is called here, and
              the bundles your team reuses. Everything is switched on to begin with &mdash; you turn things
              off, rename them, or add your own.
            </p>
          </div>
        </div>

        {/* ⚠ THE BOUNDARY BELONGS ON THE CONFIGURATION SCREEN TOO, not only on the capture screen.
            Somebody enabling forty tests here is exactly the person who needs to know that enabling one
            does not connect this product to a laboratory. */}
        <p className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[12px] text-gray-600">
          {library.boundary}
        </p>

        <InvestigationCatalogueConsole
          library={library}
          canConfigure={hasCapability(shell.ctx, "investigation.configure")}
        />
      </div>
    </div>
  );
}
