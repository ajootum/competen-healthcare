import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getChecklist } from "@/lib/practice/checklist";
import { CHECKLIST_CAPABILITIES, CHECKLIST_ROUTE } from "@/lib/practice/checklist-constants";
import ChecklistDefinition from "./ChecklistDefinition";

// /practice/knowledge-studio/checklists/[id] -- one checklist: its items, its approval, its readiness,
// its version history, and every completion record made against it.
//
// ⚠ THE MEMBERS LIST IS READ HERE so that "send this to a colleague" can offer names rather than asking
// somebody to paste a uuid. A pending approval assigned to nobody sits in a queue nobody reads.

export const dynamic = "force-dynamic";

export default async function ChecklistDefinitionPage({ params }: {
  params: Promise<{ checklistId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.view)) redirect("/practice/home");

  const { checklistId } = await params;
  const admin = createAdminClient();
  const detail = await getChecklist(admin, shell.ctx.workspaceId, checklistId);
  if (detail.state === "not_found") redirect(CHECKLIST_ROUTE);

  const { data: members } = await admin.from("practice_membership")
    .select("user_id").eq("workspace_id", shell.ctx.workspaceId).eq("status", "active");
  const ids = [...new Set(((members ?? []) as { user_id: string }[]).map(m => m.user_id))]
    .filter(id => id !== shell.ctx.userId); // nobody approves their own work -- delegation.ts refuses it
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };

  return (
    <div className="max-w-[1100px]">
      <ChecklistDefinition
        detail={detail}
        canManage={hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.manage)}
        canComplete={hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.complete)}
        colleagues={((profiles ?? []) as { id: string; full_name: string | null }[])
          .map(p => ({ id: p.id, name: p.full_name ?? "A colleague" }))}
      />
    </div>
  );
}
