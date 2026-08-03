import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listLibrary, listFolders, librarySummary } from "@/lib/practice/document-library";
import LibraryConsole from "./LibraryConsole";

// /practice/documents/library -- CPR-320's SHARED DOCUMENT LIBRARY.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A PLACE FOR A DOCUMENT THAT BELONGS TO THE PRACTICE RATHER THAN TO A PATIENT.
//
// A clinic protocol, a blank consent form, a referral pathway, a price list. There was nowhere for those
// before, and a practice with nowhere to put its protocol keeps it in somebody's email. Everything else
// CPR-AUDIT-001 listed as missing here had since been built elsewhere -- templates and PDF generation by
// CPR-330, files and signatures by CPR-130, the approvals queue by CPR-310 -- and building it twice
// would have been the mistake, not the fix.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// UNDER /documents, not a new top-level slug: the public marketing section shares this URL space, and a
// nested route cannot shadow it.

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: {
  searchParams: Promise<{ folderId?: string; q?: string; bin?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const { folderId, q, bin } = await searchParams;
  const admin = createAdminClient();
  const inBin = bin === "1";

  const [documents, folders, summary] = await Promise.all([
    listLibrary(admin, shell.ctx.workspaceId, { folderId: folderId || undefined, q: q || undefined, bin: inBin }),
    listFolders(admin, shell.ctx.workspaceId),
    librarySummary(admin, shell.ctx.workspaceId),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Document library</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            The practice&rsquo;s own documents &mdash; protocols, blank forms, pathways. Nothing here
            belongs to a patient; patient documents live on the patient.
          </p>
        </div>
        <Link href="/practice/documents"
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Clinical documents
        </Link>
      </div>

      <LibraryConsole
        documents={documents}
        folders={folders}
        summary={summary}
        activeFolder={folderId ?? ""}
        query={q ?? ""}
        inBin={inBin}
        canManage={hasCapability(shell.ctx, "template.manage")}
      />
    </div>
  );
}
