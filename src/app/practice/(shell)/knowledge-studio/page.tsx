import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { guidanceLibrary } from "@/lib/practice/knowledge";
import {
  KNOWLEDGE_CAPABILITIES, GUIDANCE_MODULE_NAME, GUIDANCE_LIBRARY_NAME,
} from "@/lib/practice/knowledge-constants";
import GuidanceLibraryView from "./GuidanceLibraryView";

// /practice/knowledge-studio -- CPR-KS-001 Phase 1. The Guidance Library.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE MODULE IS CALLED PRACTICE GUIDANCE, NOT KNOWLEDGE STUDIO, AND THE ROUTE IS A LEFTOVER ADDRESS.
//
// Two reasons, and the second is the one that matters. First, `/super-admin/ckp/studio` and
// loadKnowledgeStudio() are already called Knowledge Studio, and two things with one name in one product
// is a support call that begins "no, the other one". Second and more importantly: "studio" and
// "designer" name a TOOL, and naming a tool that holds standing clinical instructions as though it acts
// on them is the exact mistake this programme refused for its algorithm engine. The asset is named for
// what it produces. See knowledge-constants.ts.
//
// ⚠ THREE STATES ON EVERY READ, AND A FAILED READ IS NEVER A ZERO. The store for this phase is NOT YET
// APPLIED in this deployment, so the honest first state is `absent`: the page says which migration is
// missing and offers nothing it cannot do. It is not an empty library, and it must never render as one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PracticeGuidancePage({ searchParams }: {
  searchParams: Promise<{ q?: string; type?: string; status?: string; specialty?: string; tag?: string; overdue?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, KNOWLEDGE_CAPABILITIES.view)) redirect("/practice/home");

  const sp = await searchParams;
  const admin = createAdminClient();

  const library = await guidanceLibrary(admin, shell.ctx.workspaceId, {
    q: sp.q ?? null,
    docType: sp.type ?? null,
    status: sp.status ?? null,
    specialty: sp.specialty ?? null,
    tag: sp.tag ?? null,
  });

  return (
    <div className="max-w-[1400px]">
      <GuidanceLibraryView
        library={library}
        moduleName={GUIDANCE_MODULE_NAME}
        libraryName={GUIDANCE_LIBRARY_NAME}
        canManage={hasCapability(shell.ctx, KNOWLEDGE_CAPABILITIES.manage)}
        filters={{
          q: sp.q ?? "", type: sp.type ?? "", status: sp.status ?? "",
          specialty: sp.specialty ?? "", tag: sp.tag ?? "", overdue: sp.overdue === "1",
        }}
      />
    </div>
  );
}
