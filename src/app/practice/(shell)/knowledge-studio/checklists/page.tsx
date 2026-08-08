import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { checklistLibrary } from "@/lib/practice/checklist";
import {
  CHECKLIST_CAPABILITIES, CHECKLIST_MODULE_NAME, CHECKLIST_LIBRARY_NAME,
} from "@/lib/practice/checklist-constants";
import ChecklistLibraryView from "./ChecklistLibraryView";

// /practice/knowledge-studio/checklists -- CPR-KS-001 Phase 2, Engine 5. The Checklist Library.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE MODULE IS CALLED PRACTICE CHECKLISTS AND A FILLED-IN ONE IS A COMPLETION RECORD.
//
// Never a verification, an assurance, a sign-off or a compliance record -- each of those asserts
// something no row in this schema can support. A tick is somebody's claim that they did a thing.
// Nothing in this product observed the thing, and CHECKLIST_NOT_VERIFIED says so on every screen this
// module draws and on every page it prints.
//
// ⚠ THE ROUTE IS UNDER knowledge-studio BECAUSE CPR-KS-001 IS ONE PROGRAMME, and a URL is an address
// rather than a claim -- the same reasoning Phase 1 recorded for its own address. It also means this
// phase adds no top-level route, so no navigation entry is being claimed before the user decides where
// this belongs.
//
// ⚠ THREE STATES ON EVERY READ, AND A FAILED READ IS NEVER A ZERO. The store for this phase is NOT YET
// APPLIED in this deployment, so the honest first state is `absent`: the page says which migration is
// missing and offers nothing it cannot do. It is not an empty library and it must never render as one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PracticeChecklistsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; kind?: string; status?: string; specialty?: string; tag?: string; overdue?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.view)) redirect("/practice/home");

  const sp = await searchParams;
  const admin = createAdminClient();

  const library = await checklistLibrary(admin, shell.ctx.workspaceId, {
    q: sp.q ?? null,
    kind: sp.kind ?? null,
    status: sp.status ?? null,
    specialty: sp.specialty ?? null,
    tag: sp.tag ?? null,
  });

  return (
    <div className="max-w-[1400px]">
      <ChecklistLibraryView
        library={library}
        moduleName={CHECKLIST_MODULE_NAME}
        libraryName={CHECKLIST_LIBRARY_NAME}
        canManage={hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.manage)}
        filters={{
          q: sp.q ?? "", kind: sp.kind ?? "", status: sp.status ?? "",
          specialty: sp.specialty ?? "", tag: sp.tag ?? "", overdue: sp.overdue === "1",
        }}
      />
    </div>
  );
}
