import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadStudioView } from "@/lib/holdings/research/admin";
import { CAPABILITIES, LIFECYCLE_LABEL, hasAdapter } from "@/lib/holdings/research/registry";
import { FIXED_RULES, STEPS } from "@/lib/holdings/research/engine-config";
import { ResearchStudio } from "./_components/ResearchStudio";

// /super-admin/ai/research-sources -- COMPETEN-RESEARCH-01 ADDENDUM V2 item 12: the Research Sources & Evidence Studio.
//
// Opens on hq.platform.ai.view (the AI & Intelligence space). Editing needs hq.platform.research.manage (migration 630,
// granted to no position, so platform owners only until the owner grants it); approval, activation, retirement,
// publication and rollback are owner-only in admin.ts. The eight parts read the DRAFT (what publishing would put in
// force) beside what is PUBLISHED (what runs now). Adapter code and authentication stay in code; nothing here holds a key.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research sources" };

export default async function ResearchSourcesPage() {
  const ctx = await requireHqCapability("hq.platform.ai.view");
  const view = await loadStudioView(ctx.admin);
  const canEdit = ctx.isOwner || ctx.capabilities.includes("hq.platform.research.manage");
  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · AI &amp; Intelligence</p>
        <h1 className="text-xl font-bold text-gray-900">Research sources &amp; evidence</h1>
        <p className="mt-1 text-sm text-gray-600">
          The shared Research &amp; Evidence Engine: which academic sources exist, what each may do and for whom, the rules evidence must meet,
          the workflows that use it, and what it costs. A source is never operational until it is integrated, evaluated, approved and activated,
          and nothing here takes effect until an owner publishes it.
        </p>
        {!canEdit && <p className="mt-2 rounded-lg border border-[var(--cmp-color-information)] bg-[var(--cmp-surface-information)] px-3 py-2 text-[13px] text-blue-900">You can view this page. Changing it needs the research-sources right, which no position holds by default.</p>}
      </header>
      {view === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The research configuration could not be read just now (or the configuration engine, migration 076, is not on this environment).
        </p>
      ) : (
        <ResearchStudio
          view={JSON.parse(JSON.stringify(view))} canEdit={canEdit} isOwner={ctx.isOwner}
          capabilities={Object.entries(CAPABILITIES).map(([code, c]) => ({ code, ...c }))}
          steps={Object.entries(STEPS).map(([code, s]) => ({ code, ...s }))}
          lifecycleLabel={LIFECYCLE_LABEL} fixedRules={[...FIXED_RULES]}
          adapters={Object.fromEntries(Object.keys(view.draft.registry).map(id => [id, hasAdapter(id)]))}
        />
      )}
    </div>
  );
}
