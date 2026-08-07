import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { practiceLifecycle } from "@/lib/practice/lifecycle";
import PracticeLifecycleConsole from "./PracticeLifecycleConsole";

// CPR-LIFE-001 s8 -- PRACTICE SETUP: THE PRACTICE LIFECYCLE PAGE.
//
// ⚠ s8's BREADCRUMB NAMES A DOMAIN THAT DOES NOT EXIST, AND THIS PAGE SAYS WHERE IT ACTUALLY IS.
//
// s8 reads "Location: Practice Setup -> Security & Data -> Practice Lifecycle" and that is the whole of
// the specification's navigation text. SETUP_DOMAINS holds three domains -- foundation, operations and
// administration -- and there is no `Security & Data`. Inventing a fourth domain would be a real
// restructure of a frozen surface on the strength of a breadcrumb, so this is the nineteenth Setup
// module in `administration`, beside Import & Export and Team & Permissions, and the breadcrumb below
// says where it is rather than where a document imagined it.
//
// ⚠ IT IS NOT A SIDEBAR ITEM AND MUST NOT BECOME ONE. PRIMARY_ORDER is nine flat items pinned by sixteen
// assertions in practice-current-activity-harness, and the harness's orphan scan reads the TOP-LEVEL
// directories of (shell) -- so a child of an existing section needs no allowlist entry and changes no
// count. /practice/setup/clinical-parameters and /practice/setup/availability-booking are the precedent.
// navigation.ts is untouched by this build.

export const dynamic = "force-dynamic";

export default async function PracticeLifecyclePage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // ⚠ practice.lifecycle.view, NOT practice.archive. Migration 247 granted the view to practitioner as
  // well as to practice_owner: reading what state your practice is in is not the same act as changing
  // it, and a practitioner who cannot see it has no way to know why the diary stopped filling. The
  // VERBS are gated separately, inside the console and again in the engine.
  if (!hasCapability(shell.ctx, "practice.lifecycle.view")) redirect("/practice/setup");

  const admin = createAdminClient();
  const lifecycle = await practiceLifecycle(admin, shell.ctx);

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-info)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            ⟳
          </span>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="text-[11px] font-semibold text-[var(--cp-primary-deep)]">
              <Link href="/practice/setup" className="hover:underline">← Practice Setup</Link>
              <span className="mx-1 text-gray-400">/</span>
              <span className="text-gray-500">Practice Administration</span>
              <span className="mx-1 text-gray-400">/</span>
              <span className="text-gray-500">Practice Lifecycle</span>
            </nav>
            <h1 className="text-2xl font-bold text-gray-900">Practice Lifecycle</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              Safe alternatives to deleting a practice. Archive it, suspend it or restore it &mdash; each
              is reversible, each stops the diary, and none of them removes a single record.
            </p>
          </div>
        </div>

        <PracticeLifecycleConsole lifecycle={lifecycle} />
      </div>
    </div>
  );
}
