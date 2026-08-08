import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getForm } from "@/lib/practice/forms";
import { FORM_CAPABILITIES, FORM_ROUTE } from "@/lib/practice/form-constants";
import FormDefinition from "./FormDefinition";

// /practice/knowledge-studio/forms/[id] -- one form: its questions, its approval, its readiness, its
// version history, and every form completed against it.
//
// ⚠ THE MEMBERS LIST IS READ HERE so that "send this to a colleague" can offer names rather than asking
// somebody to paste a uuid. A pending approval assigned to nobody sits in a queue nobody reads.
//
// ⚠ EVERYTHING ON THE PAYLOAD IS PLAIN DATA. No function crosses the server-to-client boundary: that
// compiles, passes tsc and eslint, and kills the page at runtime -- this codebase has been bitten by it
// once already, and the harness walks the payload.

export const dynamic = "force-dynamic";

export default async function FormDefinitionPage({ params }: {
  params: Promise<{ formId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, FORM_CAPABILITIES.view)) redirect("/practice/home");

  const { formId } = await params;
  const admin = createAdminClient();
  const detail = await getForm(admin, shell.ctx.workspaceId, formId);
  if (detail.state === "not_found") redirect(FORM_ROUTE);

  const { data: members } = await admin.from("practice_membership")
    .select("user_id").eq("workspace_id", shell.ctx.workspaceId).eq("status", "active");
  const ids = [...new Set(((members ?? []) as { user_id: string }[]).map(m => m.user_id))]
    .filter(id => id !== shell.ctx.userId); // nobody approves their own work -- delegation.ts refuses it
  const { data: profiles } = ids.length
    ? await admin.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };

  return (
    <div className="max-w-[1100px]">
      <FormDefinition
        detail={detail}
        canManage={hasCapability(shell.ctx, FORM_CAPABILITIES.manage)}
        canFill={hasCapability(shell.ctx, FORM_CAPABILITIES.fill)}
        colleagues={((profiles ?? []) as { id: string; full_name: string | null }[])
          .map(p => ({ id: p.id, name: p.full_name ?? "A colleague" }))}
      />
    </div>
  );
}
