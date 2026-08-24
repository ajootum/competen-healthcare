import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listStyles, getStyle, DESIGN_CAPABILITY } from "@/lib/practice/document-design";
import { PLATFORM_BASELINE } from "@/lib/practice/document-style";
import DesignConsole from "./DesignConsole";

// CPR-DOC-CONFIG-001 s3 -- Practice Setup -> Documents and Letterhead -> Document Design.
//
// WHAT LOADS: the practice's styles, and the tokens of the one to open. A practice that has never
// configured anything opens on the platform baseline, which is a real style rather than an empty form
// -- section 2's "safe CP default when the Practice has never configured documents".

export const dynamic = "force-dynamic";

export default async function DocumentDesignSettings() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const canManage = hasCapability(shell.ctx, DESIGN_CAPABILITY);
  const admin = createAdminClient();
  const { styles } = await listStyles(admin, shell.ctx);

  // Open on the draft if there is one, otherwise the published style, otherwise the baseline.
  const opening = styles.find(s => s.status === "draft") ?? styles.find(s => s.status === "published") ?? null;
  const loaded = opening ? await getStyle(admin, shell.ctx, opening.id) : null;

  return (
    <div className="flex flex-col gap-3 p-4">
      <header>
        <h1 className="text-[17px] font-bold text-gray-900">Document design</h1>
        <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-gray-500">
          Set how your generated documents look once, and every letter, summary and instruction sheet
          made from now on follows it. Nothing you have already signed or issued changes.
        </p>
      </header>

      <DesignConsole
        styles={styles}
        initialTokens={loaded?.tokens ?? PLATFORM_BASELINE}
        initialId={loaded?.summary.status === "draft" ? loaded.summary.id : null}
        canManage={canManage}
      />
    </div>
  );
}
