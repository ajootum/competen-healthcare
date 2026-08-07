import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { documentRegister } from "@/lib/practice/documents-workspace";
import { parseDocFilter, documentExportHref } from "@/lib/practice/documents-workspace-constants";
import WorkspaceHeader from "../_workspace/WorkspaceHeader";
import RegisterTable from "../_workspace/RegisterTable";

// /practice/documents/patient -- CPR-DOC-002 s3, PATIENT DOCUMENTS.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "All patient-linked documents: results, imaging, referral letters, discharge summaries, operative
// notes, photographs, external reports and insurance documents."
//
// ⚠ THE UNLINKED ONES ARE HERE TOO, AND THAT IS DELIBERATE. A strict reading of "patient-linked" would
// exclude the arrival that nobody has filed yet -- which is precisely the row that needs somebody, and
// the only place in this product from which it can be linked. Excluding it would put the work behind a
// filter nobody would think to remove. s4's attention queue counts the same rows and links here.
//
// s22: "Results & incoming nested under Documents -> Migrate to Patient Documents with broader
// classification." That is this page. The incoming register at /practice/inbox is not replaced -- it
// still owns recording an arrival and stamping it reviewed, which are its own workflows -- but its rows
// are readable and classifiable from here, which is what lets s3.1 take it out of the sidebar.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PatientDocumentsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const sp = await searchParams;
  const filter = parseDocFilter(sp);
  const admin = createAdminClient();
  const register = await documentRegister(admin, shell.ctx.workspaceId, filter);

  return (
    <div className="flex max-w-7xl flex-col gap-5">
      <WorkspaceHeader active="patient" capabilities={shell.ctx.capabilities} />
      <RegisterTable
        register={register}
        filter={filter}
        action="/practice/documents/patient"
        // s13: classifying and filing what the post brought is desk work, and inbox.record is the
        // capability migration 200 minted for exactly that. It is NOT document.author: an assistant who
        // may file a result is not thereby a person who may write a referral letter.
        canClassify={hasCapability(shell.ctx, "inbox.record")}
        emptyTitle="No documents match"
        emptyBody={
          <>
            Nothing here matches those filters. Documents reach this list three ways &mdash; written from
            a consultation, recorded as having arrived, or attached to a patient&rsquo;s record.
            {hasCapability(shell.ctx, "inbox.record") && (
              <>
                {" "}
                <Link href="/practice/inbox" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  Record something that arrived
                </Link>{" "}
                and it appears here, ready to be linked to a patient.
              </>
            )}
          </>
        }
      />

      {/* s10 "export metadata", and the honest half of s20's Phase 4.
          ⚠ THE LINK CARRIES THE FILTER THAT WAS APPLIED, not the URL that was typed, so the file holds
          exactly the rows above it. ⚠ AND IT IS ONLY DRAWN FOR SOMEBODY WHO HOLDS data.export -- the
          capability to take data off this system, which the practice assistant does not have. */}
      {hasCapability(shell.ctx, "data.export") && (
        <p className="text-[11px] text-gray-500">
          <a href={documentExportHref(filter)} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Export this list as a spreadsheet
          </a>{" "}
          &mdash; the metadata of exactly the {register.rows.length} row
          {register.rows.length === 1 ? "" : "s"} shown, and none of their content. Titles, types,
          sources, statuses, dates and patients; no letter body and no result summary. Taking it is
          recorded in this practice&rsquo;s access log.
        </p>
      )}
    </div>
  );
}
