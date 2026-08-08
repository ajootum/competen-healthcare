import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getFormSubmission } from "@/lib/practice/forms";
import { FORM_CAPABILITIES, FORM_ROUTE } from "@/lib/practice/form-constants";
import FormFill from "./FormFill";

// /practice/knowledge-studio/forms/[id]/submissions/[submissionId] -- one completed form, being filled
// in or being read afterwards.
//
// ⚠ THE QUESTIONS AND THE ANSWERS GO TO THE CLIENT AS PLAIN DATA. No function is put on the payload: a
// function crossing a server-to-client boundary compiles, passes tsc and eslint, and kills the page at
// runtime -- this codebase has been bitten by it once already, and the harness walks the payload.

export const dynamic = "force-dynamic";

export default async function FormSubmissionPage({ params }: {
  params: Promise<{ formId: string; submissionId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, FORM_CAPABILITIES.view)) redirect("/practice/home");

  const { formId, submissionId } = await params;
  const admin = createAdminClient();
  const detail = await getFormSubmission(admin, shell.ctx.workspaceId, submissionId);
  if (detail.state === "not_found") redirect(`${FORM_ROUTE}/${formId}`);

  return (
    <div className="max-w-[820px]">
      <FormFill
        detail={detail}
        formId={formId}
        canFill={hasCapability(shell.ctx, FORM_CAPABILITIES.fill)}
      />
    </div>
  );
}
