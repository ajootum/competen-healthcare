import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getGuidance } from "@/lib/practice/knowledge";
import { KNOWLEDGE_CAPABILITIES, GUIDANCE_ROUTE } from "@/lib/practice/knowledge-constants";
import GuidanceDocument from "./GuidanceDocument";

// /practice/knowledge-studio/[id] -- one guidance document: its ten sections, its approval, its
// readiness to be published, and its version history.
//
// ⚠ THE MEMBERS LIST IS READ HERE so that "send this to a colleague" can offer names rather than
// asking somebody to paste a uuid. A pending approval assigned to nobody sits in a queue nobody reads.

export const dynamic = "force-dynamic";

export default async function GuidanceDocumentPage({ params }: {
  params: Promise<{ guidanceId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, KNOWLEDGE_CAPABILITIES.view)) redirect("/practice/home");

  const { guidanceId } = await params;
  const admin = createAdminClient();
  const detail = await getGuidance(admin, shell.ctx.workspaceId, guidanceId);
  if (detail.state === "not_found") redirect(GUIDANCE_ROUTE);

  // Active members, for the approval assignee. requestApproval() refuses anybody who is not one, so
  // offering a wider list here would only produce a refusal further down.
  const { data: members } = await admin.from("practice_membership")
    .select("user_id").eq("workspace_id", shell.ctx.workspaceId).eq("status", "active");
  const ids = [...new Set(((members ?? []) as { user_id: string }[]).map(m => m.user_id))]
    .filter(id => id !== shell.ctx.userId); // nobody approves their own work -- delegation.ts refuses it
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };

  return (
    <div className="max-w-[1100px]">
      <GuidanceDocument
        detail={detail}
        canManage={hasCapability(shell.ctx, KNOWLEDGE_CAPABILITIES.manage)}
        colleagues={((profiles ?? []) as { id: string; full_name: string | null }[])
          .map(p => ({ id: p.id, name: p.full_name ?? "A colleague" }))}
      />
    </div>
  );
}
