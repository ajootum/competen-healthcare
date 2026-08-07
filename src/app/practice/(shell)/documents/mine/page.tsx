import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { documentRegister } from "@/lib/practice/documents-workspace";
import { parseDocFilter } from "@/lib/practice/documents-workspace-constants";
import WorkspaceHeader from "../_workspace/WorkspaceHeader";
import RegisterTable from "../_workspace/RegisterTable";

// /practice/documents/mine -- CPR-DOC-002 s3, MY DOCUMENTS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Practitioner-generated outputs: referral letters, consultation summaries, medical certificates,
// procedure summaries, reports and forms."
//
// ⚠ MINE MEANS `created_by = me`, TAKEN FROM THE SERVER-RESOLVED CONTEXT AND NEVER FROM THE URL. It is
// not offered as a filter and it cannot be overridden by one: parseDocFilter does not read `authorId`,
// and this page applies the caller's own id on top of whatever the querystring said. A dropdown reading
// "Author: me" is one misclick -- or one edited URL -- away from being a view of somebody else's drafts
// under a heading that says My Documents.
//
// ⚠ IT OVERLAPS PATIENT DOCUMENTS ON PURPOSE, and s3 asks for exactly that: one axis is WHO the document
// is about, the other is WHO WROTE IT. A signed referral letter is in both. The alternative -- carving
// the register so nothing appears twice -- would mean a practitioner could not find their own letter in
// the tab named after them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function MyDocumentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const sp = await searchParams;
  // The caller's own id, from the server-resolved context. NOT from the querystring: `?authorId=` would
  // make My Documents a view of anybody's documents for whoever edited the URL.
  const filter = { ...parseDocFilter(sp), authorId: shell.ctx.userId };
  const admin = createAdminClient();
  const register = await documentRegister(admin, shell.ctx.workspaceId, filter);

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <WorkspaceHeader active="mine" capabilities={shell.ctx.capabilities} />
      <RegisterTable
        register={register}
        filter={filter}
        action="/practice/documents/mine"
        // Nothing on this page is an arrival somebody else recorded, but the capability is passed
        // truthfully rather than hardcoded false: a practitioner holds inbox.record, and an arrival they
        // recorded themselves is theirs to classify from here as much as from anywhere.
        canClassify={hasCapability(shell.ctx, "inbox.record")}
        emptyTitle="You have not written any documents yet"
        emptyBody={
          <>
            A document composes from what a consultation actually holds &mdash; the history, findings,
            impression, plan, diagnoses and treatment already recorded there. Open a consultation and
            generate one rather than retyping it.{" "}
            <Link href="/practice/encounters" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Go to encounters
            </Link>
            . Signing a document is a separate act from signing the encounter: a consultation can be
            complete while its referral letter is still a draft.
          </>
        }
      />
    </div>
  );
}
