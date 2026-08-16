import { redirect } from "next/navigation";
import PrintButton from "../../../PrintButton";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getGuidance } from "@/lib/practice/knowledge";
import { letterhead } from "@/lib/practice/document-generation";
import { KNOWLEDGE_CAPABILITIES, GUIDANCE_ROUTE } from "@/lib/practice/knowledge-constants";

// /practice/knowledge-studio/[id]/print -- CPR-KS-001's Publishing Engine, as much of it as is true.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PRINT VIEW IS THE PDF EXPORT, and it is reused rather than rebuilt. A browser's print-to-PDF
// produces the letterhead, the sections and the approval block exactly as they are here, without this
// product taking on a rendering library, a font licence, or a second definition of what a document looks
// like. Section 3 also lists PNG, JPEG, Word and "interactive"; NONE of those exist and this page does
// not imply them.
//
// ⚠ ANYTHING NOT IN FORCE PRINTS WITH A WATERMARK. A printed draft that looks identical to a published
// one is a document somebody pins to a wall in good faith. The same rule, and the same reasoning, as the
// clinical document print route.
//
// ⚠ AND THE NOTICE GOES ON THE PAPER. The reader of a printed protocol cannot see this screen's banner,
// so the one line saying that nothing monitors what is written here is on the page itself.
//
// NOT A PATIENT RECORD, so there is no access log entry. logAccess() records reads OF A PATIENT; a
// policy belongs to no patient and filing this under one would put a name against a document that has
// none. The audit trail for guidance is practice_audit_event, written by the engine on every change.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PrintGuidancePage({ params }: {
  params: Promise<{ guidanceId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, KNOWLEDGE_CAPABILITIES.view)) redirect("/practice/home");

  const { guidanceId } = await params;
  const admin = createAdminClient();
  const detail = await getGuidance(admin, shell.ctx.workspaceId, guidanceId);
  if (detail.state !== "ok" || !detail.document) redirect(GUIDANCE_ROUTE);

  const doc = detail.document;
  const head = await letterhead(admin, shell.ctx.workspaceId);
  const inForce = !!doc.inForce;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <PrintButton />
        <a href={`${GUIDANCE_ROUTE}/${doc.id}`} className="text-[12px] text-gray-500 hover:underline">
          &larr; Back to the document
        </a>
        <p className="ml-auto text-[11px] text-gray-500">
          Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      {!inForce && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 print:hidden">
          This document is {String(doc.stateLabel).toLowerCase()} and is not in force. It will print
          marked NOT IN FORCE.
        </p>
      )}

      <article className="relative text-[12px] leading-relaxed text-black">
        {!inForce && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-30deg] text-center text-[54px] font-black leading-none tracking-widest text-black/10">
              NOT IN FORCE
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
          {doc.code} &middot; {doc.typeLabel} &middot; Version {doc.version} &middot; {doc.stateLabel}
          {doc.effective_from ? ` · In force from ${doc.effective_from}` : ""}
          {doc.review_on ? ` · Review by ${doc.review_on}` : ""}
        </p>
        {doc.summary && <p className="mb-3 text-[11.5px] italic text-black/70">{doc.summary}</p>}

        {/* ⚠ ON THE PAPER, NOT ONLY ON THE SCREEN. */}
        <p className="mb-5 border-y border-black/15 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-black/70">
          {detail.notMonitored.onPaper}
        </p>

        {detail.sections.map(s => (
          <section key={s.key} className="mb-4 break-inside-avoid">
            <h2 className="mb-1 text-[12.5px] font-bold">{s.position}. {s.heading}</h2>
            {s.body ? (
              <div className="whitespace-pre-wrap">{s.body}</div>
            ) : (
              // ⚠ NEVER A BLANK UNDER A HEADING. A heading followed by white space on printed guidance
              // reads as "nothing to say here", which is a claim this product cannot make.
              <p className="text-black/50">
                [ Nothing was written in this section. ]
              </p>
            )}
          </section>
        ))}

        <footer className="mt-8 border-t border-black/20 pt-3 text-[10.5px] text-black/70">
          {detail.approval?.status === "APPROVED" ? (
            <p>
              Approved by {detail.approval.decidedByName ?? "a colleague"}
              {detail.approval.decided_at ? ` on ${String(detail.approval.decided_at).slice(0, 10)}` : ""}
              , recorded in Competen Practice. This copy carries no handwritten signature.
            </p>
          ) : (
            <p>Not approved. This copy is not an issued document of this practice.</p>
          )}
          <p className="mt-1">{detail.notMonitored.onPaper}</p>
        </footer>
      </article>
    </div>
  );
}
