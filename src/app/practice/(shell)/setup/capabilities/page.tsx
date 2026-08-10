import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { resolveCapabilities, SETTINGS_CAPABILITY } from "@/lib/practice/capabilities";
import CapabilityConsole from "./CapabilityConsole";

// CPR-CAP-001 s4, s5 and s6 -- PRACTICE SETUP: WHAT THIS PRACTICE USES.
//
// The owner's reason for the whole framework: "because of difficulties in selling the full product, we
// want to configure CP and add products as we go". A practitioner buys booking, becomes operational
// without ever configuring clinical capture, and switches more on later. This screen is where the
// switching happens.
//
// ⚠ IT IS NOT A SIDEBAR ITEM AND IT ADDS NO NAVIGATION ENTRY. navigation.ts carries a freeze notice and
// PRIMARY_ORDER is pinned by sixteen assertions. This route is NESTED UNDER /practice/setup for the
// reason /practice/setup/clinical-parameters and /practice/setup/investigations both give: the orphan
// scan in practice-current-activity-harness reads the TOP-LEVEL directories of (shell), so a child of an
// existing section needs no allowlist entry and changes no count. A tile on the Setup landing page would
// mean editing src/lib/practice/setup.ts, which belongs to another change in flight -- it is REPORTED
// rather than taken.
//
// ⚠ THE GATE IS practice.settings.manage, WHICH ALREADY EXISTS (migration 191, on practice_owner). No
// CP.* code gates this page. The two axes stay in two namespaces.
//
// ⚠ AND THE PAGE DOES NOT GATE ITSELF ON ITS OWN SUBJECT. Nothing here is hidden because a capability is
// inactive: the screen whose job is to switch things on cannot be one of the things that gets switched
// off. That is the first place a capability-driven navigation change would go wrong.

export const dynamic = "force-dynamic";

export default async function PracticeCapabilitiesSetupPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const canManage = hasCapability(shell.ctx, SETTINGS_CAPABILITY);
  if (!canManage) redirect("/practice/setup");

  const admin = createAdminClient();
  // ⚠ A FAILED READ ARRIVES AS readable:false, NOT AS AN EMPTY SET. The console renders it as a third
  // state. See the failure-posture note on resolveCapabilities.
  const resolution = await resolveCapabilities(admin, shell.ctx.workspaceId);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            &#9678;
          </span>
          <div className="min-w-0 flex-1">
            <Link href="/practice/setup" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              &larr; Practice Setup
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">What this practice uses</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              Competen Practice is not one product. Switch on what you need now &mdash; booking and a
              calendar are enough to start &mdash; and add the rest whenever you want it. Anything that
              needs something else brings it along, and nothing you switch off is deleted.
            </p>
          </div>
        </div>

        <CapabilityConsole resolution={resolution} canManage={canManage} />
      </div>
    </div>
  );
}
