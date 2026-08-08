import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getChecklist } from "@/lib/practice/checklist";
import { letterhead } from "@/lib/practice/document-generation";
import { CHECKLIST_CAPABILITIES, CHECKLIST_ROUTE } from "@/lib/practice/checklist-constants";

// /practice/knowledge-studio/checklists/[id]/print -- a blank copy, for the wall or the trolley.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PRINT VIEW IS THE PDF EXPORT, and it is reused rather than rebuilt. A browser's print-to-PDF
// produces the letterhead and the list exactly as they are here, without this product taking on a
// rendering library, a font licence, or a second definition of what a checklist looks like. Section 3
// also lists PNG, JPEG, Word and "interactive". NONE of those exist and this page does not imply them.
//
// ⚠ ANYTHING NOT IN USE PRINTS WITH A WATERMARK. A printed draft that looks identical to the version in
// use is a list somebody pins to a theatre wall in good faith.
//
// ⚠ AND THE NOTICE GOES ON THE PAPER. Paper outlives the screen that qualified it, so the one line
// saying that nothing here checks anything is on the page itself.
//
// ⚠ A CONDITIONAL ITEM PRINTS WITH ITS CONDITION IN WORDS. On paper there is nothing to evaluate, so an
// item that would sometimes be withdrawn has to say when -- otherwise the printed list asks a question
// the electronic one would not have.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PrintChecklistPage({ params }: {
  params: Promise<{ checklistId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, CHECKLIST_CAPABILITIES.view)) redirect("/practice/home");

  const { checklistId } = await params;
  const admin = createAdminClient();
  const detail = await getChecklist(admin, shell.ctx.workspaceId, checklistId);
  if (detail.state !== "ok" || !detail.checklist) redirect(CHECKLIST_ROUTE);

  const doc = detail.checklist;
  const head = await letterhead(admin, shell.ctx.workspaceId);
  const inUse = !!doc.usable;
  const byKey = new Map(detail.items.map(i => [i.item_key, i.label]));

  const conditionInWords = (condition: unknown): string | null => {
    if (!condition || typeof condition !== "object") return null;
    const c = condition as Record<string, unknown>;
    if (typeof c.when !== "string") return null;
    const source = byKey.get(c.when) ?? c.when;
    if ("isPresent" in c) return c.isPresent === false
      ? `Only if "${source}" has not been answered.`
      : `Only once "${source}" has been answered.`;
    if ("in" in c && Array.isArray(c.in)) return `Only if "${source}" is ${c.in.map(String).join(" or ")}.`;
    if ("equals" in c) return `Only if "${source}" is ${String(c.equals)}.`;
    return null;
  };

  // A heading is drawn when this item's section differs from the one above it. Read off the PREVIOUS
  // ROW rather than carried in a mutable variable -- reassigning during a render is an error in this
  // project's lint, and rightly: the second render would start from wherever the first one finished.
  const headingFor = (item: { section: string | null }, i: number, all: { section: string | null }[]) =>
    item.section && item.section !== (all[i - 1]?.section ?? null) ? item.section : null;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <a href={`${CHECKLIST_ROUTE}/${doc.id}`} className="text-[12px] text-gray-500 hover:underline">
          &larr; Back to the checklist
        </a>
        <p className="ml-auto text-[11px] text-gray-500">
          Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      {!inUse && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 print:hidden">
          This checklist is {String(doc.stateLabel).toLowerCase()} and is not in use. It will print marked
          NOT IN USE.
        </p>
      )}

      <article className="relative text-[12px] leading-relaxed text-black">
        {!inUse && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-30deg] text-center text-[54px] font-black leading-none tracking-widest text-black/10">
              NOT IN USE
            </span>
          </span>
        )}

        {head && (
          <header className="mb-6 whitespace-pre-line border-b border-black/20 pb-3 text-center text-[11px]">
            {head}
          </header>
        )}

        <h1 className="mb-1 text-[15px] font-bold">{doc.title}</h1>
        <p className="mb-1 text-[11px] text-black/60">
          {doc.code} &middot; {doc.kindLabel} &middot; Version {doc.version} &middot; {doc.stateLabel}
          {doc.effective_from ? ` · In use from ${doc.effective_from}` : ""}
          {doc.review_on ? ` · Review by ${doc.review_on}` : ""}
        </p>
        {doc.purpose && <p className="mb-3 text-[11.5px] italic text-black/70">{doc.purpose}</p>}

        {/* ⚠ ON THE PAPER, NOT ONLY ON THE SCREEN. */}
        <p className="mb-5 border-y border-black/15 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-black/70">
          {detail.notVerified.onPaper}
        </p>

        {detail.items.length === 0 ? (
          <p className="text-black/50">[ This checklist has no items on it. ]</p>
        ) : (
          <ol className="space-y-2">
            {detail.items.map((item, i, all) => {
              const heading = headingFor(item, i, all);
              const when = conditionInWords(item.condition);
              return (
                <li key={item.id} className="break-inside-avoid">
                  {heading && (
                    <p className="mb-1 mt-3 border-b border-black/10 pb-0.5 text-[11px] font-bold uppercase tracking-wide">
                      {heading}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <span className="w-5 shrink-0 text-right text-black/50">{i + 1}.</span>
                    <span className="mt-[2px] flex shrink-0 gap-1">
                      <span className="inline-block h-3.5 w-3.5 border border-black/50" aria-hidden />
                      <span className="inline-block h-3.5 w-3.5 border border-black/50" aria-hidden />
                      <span className="inline-block h-3.5 w-3.5 border border-black/50" aria-hidden />
                    </span>
                    <span>
                      <span className="font-semibold">{item.label}</span>
                      {item.is_critical && <span className="ml-1.5 text-[10px] font-bold uppercase">critical</span>}
                      {!item.required && <span className="ml-1.5 text-[10px] uppercase text-black/50">optional</span>}
                      {item.detail && <span className="block text-[11px] text-black/60">{item.detail}</span>}
                      {/* ⚠ THE CONDITION IN WORDS. Paper cannot evaluate it. */}
                      {when && <span className="block text-[11px] italic text-black/60">{when}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <p className="mt-4 text-[10.5px] text-black/50">
          The three boxes are Done, Not done and Not applicable, in that order. On paper nobody records
          who ticked them or when.
        </p>

        <footer className="mt-8 border-t border-black/20 pt-3 text-[10.5px] text-black/70">
          {detail.approval?.status === "APPROVED" ? (
            <p>
              Approved by {detail.approval.decidedByName ?? "a colleague"}
              {detail.approval.decided_at ? ` on ${String(detail.approval.decided_at).slice(0, 10)}` : ""}
              , recorded in Competen Practice. This copy carries no handwritten signature.
            </p>
          ) : (
            <p>Not approved. This copy is not an issued checklist of this practice.</p>
          )}
          <p className="mt-1">{detail.notVerified.onPaper}</p>
        </footer>
      </article>
    </div>
  );
}
