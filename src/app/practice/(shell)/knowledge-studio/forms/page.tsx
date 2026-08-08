import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { formLibrary } from "@/lib/practice/forms";
import {
  FORM_CAPABILITIES, FORM_MODULE_NAME, FORM_LIBRARY_NAME,
} from "@/lib/practice/form-constants";
import FormLibraryView from "./FormLibraryView";

// /practice/knowledge-studio/forms -- CPR-KS-001 Phase 3, section 4. The Form Library.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE MODULE IS CALLED PRACTICE FORMS AND A FILLED-IN ONE IS A COMPLETED FORM.
//
// Never a verification, an assurance, a sign-off, a consent or a witnessed record -- each of those
// asserts something no row in this schema can support. An answer is what somebody entered. Nothing in
// this product checked it, and nothing on a form is a signature. FORM_NOT_VERIFIED says so on every
// screen this module draws and on every page it prints.
//
// ⚠ THE ROUTE IS UNDER knowledge-studio BECAUSE CPR-KS-001 IS ONE PROGRAMME, and a URL is an address
// rather than a claim -- the same reasoning Phases 1 and 2 recorded for their own addresses. It also
// means this phase adds no top-level route, so no navigation entry is claimed before the user decides
// where this belongs.
//
// ⚠ THREE STATES ON EVERY READ, AND A FAILED READ IS NEVER A ZERO.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PracticeFormsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; kind?: string; status?: string; specialty?: string; tag?: string; overdue?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, FORM_CAPABILITIES.view)) redirect("/practice/home");

  const sp = await searchParams;
  const admin = createAdminClient();

  const library = await formLibrary(admin, shell.ctx.workspaceId, {
    q: sp.q ?? null,
    kind: sp.kind ?? null,
    status: sp.status ?? null,
    specialty: sp.specialty ?? null,
    tag: sp.tag ?? null,
  });

  return (
    <div className="max-w-[1400px]">
      <FormLibraryView
        library={library}
        moduleName={FORM_MODULE_NAME}
        libraryName={FORM_LIBRARY_NAME}
        canManage={hasCapability(shell.ctx, FORM_CAPABILITIES.manage)}
        filters={{
          q: sp.q ?? "", kind: sp.kind ?? "", status: sp.status ?? "",
          specialty: sp.specialty ?? "", tag: sp.tag ?? "", overdue: sp.overdue === "1",
        }}
      />
    </div>
  );
}
