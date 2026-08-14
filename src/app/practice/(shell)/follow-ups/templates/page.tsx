import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listPlanTemplates } from "@/lib/practice/follow-up-plans";
import TemplateStudio from "./TemplateStudio";

// /practice/follow-ups/templates -- plan template authoring (migration 206's missing screen).
//
// ⚠ READING TAKES followup.view AND AUTHORING TAKES followup.manage, matching the API's own split --
// and deliberately NOT template.manage: a review schedule is a clinical judgement, and the people who
// make it are the people who keep the follow-ups. The route comment says the same thing in the same
// words, because a page and its API disagreeing about who may act is how a button 403s.

export const dynamic = "force-dynamic";

export default async function FollowUpTemplatesPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "followup.view")) redirect("/practice/home");

  const admin = createAdminClient();
  // Inactive included: a retired template is a decision somebody made, and a list that hides it makes
  // "where did our wound plan go" unanswerable from the screen that owns the answer.
  const templates = await listPlanTemplates(admin, shell.ctx.workspaceId, { includeInactive: true });

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Follow-up plan templates</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Reusable schedules of follow-ups &mdash; a wound-review sequence, a titration check-in
            pattern. Applying one to a patient raises each step as an ordinary follow-up.
          </p>
        </div>
        <Link href="/practice/follow-ups"
          className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Follow-up board
        </Link>
      </div>

      <TemplateStudio
        templates={templates as never[]}
        canManage={hasCapability(shell.ctx, "followup.manage")}
      />

      <p className="mt-3 text-[11.5px] text-gray-500">
        Plans are applied from a consultation&apos;s Follow-up tab, where they appear the moment one
        exists here.
      </p>
    </div>
  );
}
