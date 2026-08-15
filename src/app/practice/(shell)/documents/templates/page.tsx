import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listTemplates, getTemplate } from "@/lib/practice/documentation";
import { TEMPLATE_KINDS } from "@/lib/practice/document-constants";
import TemplateConsole from "./TemplateConsole";
import WorkspaceHeader from "../_workspace/WorkspaceHeader";

// /practice/documents/templates -- CPR-130's template library.
//
// TWO SCOPES, SHOWN AS TWO SCOPES. Platform templates are ours and are read-only to a practice; workspace
// templates are the practice's own. Merging them into one list with a subtle badge would make "why can I
// not edit this one" a support question, so they are separate sections with the reason written down.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const KIND_LABEL = Object.fromEntries(TEMPLATE_KINDS) as Record<string, string>;

export default async function TemplatesPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "template.manage")) redirect("/practice/documents");

  const admin = createAdminClient();
  const templates = await listTemplates(admin, shell.ctx.workspaceId, { includeUnpublished: true }) as any[];
  // Sections are what a template IS, so the list shows them rather than a count nobody can act on.
  const withSections = await Promise.all(
    templates.map(async t => ({ ...t, detail: await getTemplate(admin, shell.ctx.workspaceId, t.id) })),
  );
  const platform = withSections.filter(t => t.scope === "platform");
  const mine = withSections.filter(t => t.scope === "workspace");
  // The Use action needs document.author, which is a DIFFERENT capability from the template.manage
  // that opens this page -- an action a person cannot complete is not offered to them.
  const canGenerate = hasCapability(shell.ctx, "document.author");

  // The three server-side conditions generateFromTemplate enforces, decided HERE so the link is only
  // shown where following it can work: published, a document kind, and a body to merge into.
  const generable = (t: any) => t.status === "published" && t.kind !== "encounter_note" && t.mergeable;

  const card = (t: any) => (
    <li key={t.id} className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-gray-900">{t.title}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
          {KIND_LABEL[t.kind] ?? t.kind}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
          t.status === "published" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
            : t.status === "draft" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"
              : "bg-gray-100 text-gray-500"}`}>
          {t.status}
        </span>
        <span className="ml-auto font-mono text-[10px] text-gray-400">{t.code}</span>
        {canGenerate && generable(t) && (
          <a href={`/practice/reports?template=${t.id}`}
            className="rounded-lg border border-[var(--cp-primary)] px-2 py-0.5 text-[11px] font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/5">
            Use template &rarr;
          </a>
        )}
        {canGenerate && !generable(t) && t.status === "published" && t.kind !== "encounter_note" && (
          // The card wears its own reason: a published document template with no body cannot be
          // generated from, and "why is there no Use button on this one" should not be a support question.
          <span className="text-[10px] text-gray-400">sections only &mdash; no body to generate from</span>
        )}
      </div>
      {t.description && <p className="mt-1 text-[12px] text-gray-600">{t.description}</p>}
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {(t.detail?.sections ?? []).map((s: any) => (
          <li key={s.id} className="text-[11px] text-gray-500">
            <span className="font-mono text-gray-400">{s.note_type}</span> · {s.heading}
            {s.required && <span className="ml-1 text-[10px] text-gray-400">(required)</span>}
          </li>
        ))}
      </ul>
    </li>
  );

  return (
    <div className="max-w-4xl">
      {/* ⚠ THE WORKSPACE STRIP WAS MISSING ON THIS TAB AND ON LIBRARY -- TWO OF THE SEVEN.
          Both pages predate WorkspaceHeader and each grew its own "← Documents" link instead, so
          arriving here by clicking Templates DROPPED the tab strip and the only way onward was back to
          Overview. A tab that removes the tabs is a dead end wearing a tab's clothes, and it is the same
          class as the two screens this component's own header comment records being stranded before.
          The back link goes with it: the strip already contains Overview, and two ways back is one more
          than a reader needs. */}
      <WorkspaceHeader active="templates" capabilities={shell.ctx.capabilities} />
      <div className="mt-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Template library</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Headings and prompts that structure a consultation note or start a document. Applying a
            template never overwrites text you have already written.
          </p>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Your practice&apos;s templates</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            None yet. Write one below, or work from the supplied templates as they are.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">{mine.map(card)}</ul>
        )}
      </section>

      <TemplateConsole templates={mine.map(t => ({ id: t.id, title: t.title, status: t.status }))} />

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Supplied with Competen</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Available to every practice and read-only here. They are a starting point, not clinical guidance:
          each one is a set of headings and prompts, and none of them asserts anything about a patient.
        </p>
        <ul className="mt-2 flex flex-col gap-2">{platform.map(card)}</ul>
      </section>
    </div>
  );
}
