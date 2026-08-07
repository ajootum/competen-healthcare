import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { parameterLibrary } from "@/lib/practice/parameters";
import ParameterLibraryConsole from "./ParameterLibraryConsole";

// CPR-LCP-001 s10.1 -- PRACTICE SETUP: THE CLINICAL PARAMETERS PAGE.
//
// s10.1 names six things and this page is those six and nothing else:
//   "Clinical Parameters page / Activate/deactivate core parameters / Install specialty packs /
//    Create or clone custom parameters / Set default collection frequency and visibility /
//    Configure roles permitted to change parameters"
//
// ⚠ IT IS NOT A SIDEBAR ITEM AND MUST NOT BECOME ONE. CPR-LCP-001 contains no navigation section --
// s10 is titled "User Interface Requirements" and asks for a page under Practice Setup and two panels
// inside workspaces that already exist. navigation.ts carries its own freeze notice, PRIMARY_ORDER is
// nine items pinned by sixteen assertions, and this route is NESTED UNDER /practice/setup for that
// reason: the harness's orphan scan reads the top-level directories of (shell), so a child of an
// existing section needs no allowlist entry and changes no count. /practice/setup/availability-booking
// is the precedent.
//
// ⚠ "CONFIGURE ROLES PERMITTED TO CHANGE PARAMETERS" IS RENDERED AS A STATEMENT, NOT A CONTROL.
// The permitted roles are not configurable here: they are seeded rows in practice_role_capabilities
// (migration 246 s11), granted per membership through practice_role_assignment, and edited in Team &
// Permissions. A second editor over the same grants would be a place to set a permission that the other
// one silently overwrites. So this page SHOWS which capability governs what and links to the screen that
// owns it -- the same call /practice/setup already makes about the booking page it cannot preview.
//
// ---- COLOUR IS DOING WORK HERE ---------------------------------------------------------------------
//
// A previous screen came back with "the colors are flat". Sixteen parameters in six categories rendered
// at identical weight have to be READ; the same sixteen tinted by category are FOUND. The hues are
// existing --cp tokens through palette.ts's own tintedCard/tintedChip, so nothing new is invented --
// see the note over CATEGORY_HUE in parameters-constants.ts.

export const dynamic = "force-dynamic";

export default async function ClinicalParametersPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // ⚠ parameter.view, NOT parameter.configure. LCP s11 splits reading from changing, and a team member
  // who may collect values should be able to see what the practice collects. The CONTROLS are gated
  // separately, inside the console, from canConfigure / canInstallPacks.
  if (!hasCapability(shell.ctx, "parameter.view")) redirect("/practice/setup");

  const admin = createAdminClient();
  const library = await parameterLibrary(admin, shell.ctx);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            ⚖
          </span>
          <div className="min-w-0 flex-1">
            <Link href="/practice/setup" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              ← Practice Setup
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Clinical Parameters</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              Choose what this practice measures, how often, and what counts as out of range. Nothing is
              switched on by default &mdash; a parameter is collected only where somebody activated it.
            </p>
          </div>
        </div>

        <ParameterLibraryConsole library={library} />
      </div>
    </div>
  );
}
