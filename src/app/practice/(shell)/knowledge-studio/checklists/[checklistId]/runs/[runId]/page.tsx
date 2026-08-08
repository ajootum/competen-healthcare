import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getChecklistRun } from "@/lib/practice/checklist";
import { CHECKLIST_CAPABILITIES, CHECKLIST_ROUTE } from "@/lib/practice/checklist-constants";
import ChecklistRun from "./ChecklistRun";

// /practice/knowledge-studio/checklists/[id]/runs/[runId] -- one completion record, being filled in or
// being read afterwards.
//
// ⚠ THE ITEMS AND THE ANSWERS GO TO THE CLIENT AS PLAIN DATA. No function is put on the payload: a
// function crossing a server-to-client boundary compiles, passes tsc and eslint, and kills the page at
// runtime -- this codebase has been bitten by it once already, and the harness walks the payload.

export const dynamic = "force-dynamic";

export default async function ChecklistRunPage({ params }: {
  params: Promise<{ checklistId: string; runId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.view)) redirect("/practice/home");

  const { checklistId, runId } = await params;
  const admin = createAdminClient();
  const detail = await getChecklistRun(admin, shell.ctx.workspaceId, runId);
  if (detail.state === "not_found") redirect(`${CHECKLIST_ROUTE}/${checklistId}`);

  return (
    <div className="max-w-[820px]">
      <ChecklistRun
        detail={detail}
        checklistId={checklistId}
        canComplete={hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.complete)}
      />
    </div>
  );
}
