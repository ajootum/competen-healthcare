import Link from "next/link";
import { DOC_TABS, DOC_ADJACENT } from "@/lib/practice/documents-workspace-constants";

// CPR-DOC-002 s3.1's SUB-NAVIGATION, AS TABS INSIDE THE WORKSPACE.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s3.1, verbatim: "Keep a single primary sidebar item labelled Documents. Remove Messages and Results &
// Incoming from the permanent navigation. Sub-navigation should appear inside the workspace as tabs or
// segmented controls."
//
// ⚠ THIS COMPONENT IS WHAT MAKES THAT NAV CHANGE SAFE TO MAKE. /practice/messages and /practice/inbox
// are BUILT PAGES that work. Removing them from the sidebar without a way in first would leave two
// working screens unreachable -- the exact defect that stranded /practice/setup and /practice/pathways
// in this codebase, both found by a person rather than by a test. They are rendered below as ADJACENT
// links on every tab of this workspace, not as tabs: s3.1 is explicit that communication is not a
// document type, and the incoming register's patient-linked rows already appear inside Patient
// Documents.
//
// ⚠ A TAB IS ONLY DRAWN IF ITS PAGE EXISTS AND THIS CALLER MAY OPEN IT. Templates takes template.manage,
// exactly as /practice/documents/templates itself does; drawing it for somebody the route will bounce is
// a link to a redirect. `Shared & Issued` is one of s3's six areas and is s20 Phase 2 -- so it is NOT
// DRAWN AT ALL, rather than drawn disabled with an apology under it. s18 forbids "not built" messages in
// production UI and this codebase forbids controls that do nothing; the one move that satisfies both is
// to not draw the control.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function WorkspaceHeader({ active, capabilities }: {
  active: string;
  capabilities: string[];
}) {
  const tabs = DOC_TABS.filter(t => t.capability === null || capabilities.includes(t.capability));
  const adjacent = DOC_ADJACENT.filter(a => capabilities.includes(a.capability));

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Documents</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-gray-500">
            Everything this practice wrote, received or filed against a patient, across every location.
            Patient-linked documents also appear in that patient&rsquo;s own record &mdash; nothing here
            needs uploading twice.
          </p>
        </div>
        {adjacent.length > 0 && (
          /* Below md this wrapped block lands under the description, so it reads left-to-right like
             everything above it; from md up it is the right-hand column it has always been. The links
             take s4's 44px floor on a phone. */
          <nav aria-label="Beside this workspace" className="flex flex-col gap-1 max-md:items-start md:items-end">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Beside this workspace</span>
            <span className="flex flex-wrap gap-1.5 max-md:justify-start md:justify-end">
              {adjacent.map(a => (
                <Link
                  key={a.href} href={a.href} title={a.blurb}
                  className="flex items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-600 transition hover:border-[var(--cp-primary)]/40 hover:text-[var(--cp-primary-deep)] max-md:min-h-[var(--cp-touch)] max-md:px-3"
                >
                  {a.label} &rarr;
                </Link>
              ))}
            </span>
          </nav>
        )}
      </div>

      {/* ══ CPR-MOB-001 s12 row 1, AND THE ROW THAT NAMES THIS EXACT TAB SET ═══════════════════════════
          s12: "Section navigation → Use a compact selector for My Documents, Templates, Shared & Issued,
          Review & Tasks, Library, Overview", and then, separately and emphatically, "Seven-tab desktop
          structure → Do not force all tabs to fit horizontally on mobile."

          THE DESKTOP ROW IS UNCHANGED AND IS SIMPLY NOT DRAWN BELOW md. Same markup, same order, same
          `aria-current="page"`, same DOC_TABS filter — s19's "change hierarchy by breakpoint without
          changing source-of-truth semantics", and the reason a desktop screenshot at md is identical to
          the one before this change.

          ⚠ SectionTabs THE PRIMITIVE WAS NOT ADOPTED, AND NEITHER WAS ITS <select>. Its READING is
          adopted whole — seven is past its own threshold of five, so this is a "large set" and it
          degrades rather than squeezing. But the primitive drives client tab STATE through `onSelect`,
          and these seven are ROUTES: seven server-rendered pages, each with its own capability gate and
          its own querystring. Handing them to a <select> would convert seven real links into a
          script-driven navigation and cost the practitioner prefetch, middle-click, the back button and
          `aria-current="page"` — and with JS off it would leave a phone with NO way out of this
          workspace at all, because the desktop row beside it is hidden by CSS. 4b rejected SectionTabs
          twice for exactly this (URL-driven navigation); this is the third.

          SO THE COMPACT SELECTOR IS A NATIVE <details> OVER THE SAME SEVEN <Link>s. Collapsed it is one
          row naming the section you are in; opened it is seven full-width 44px destinations, stacked —
          which is what "do not force all tabs to fit horizontally" asks for, and it is not a horizontal
          scroll strip either. It needs no JavaScript, it announces as a disclosure, and a navigation
          closes it because the next page renders it closed on the section you just chose. */}
      <nav aria-label="Documents areas" className="max-md:hidden flex flex-wrap items-center gap-1 border-b border-gray-200">
        {tabs.map(t => {
          const on = t.key === active;
          return (
            <Link
              key={t.key} href={t.href} title={t.blurb}
              aria-current={on ? "page" : undefined}
              className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[12.5px] font-semibold transition ${
                on
                  ? "border-[var(--cp-primary)] text-[var(--cp-primary-deep)]"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <details className="md:hidden rounded-xl border border-gray-200 bg-white">
        {/* ⚠ THE LABEL IS VISIBLE AND NAMES THE GROUP (s16: placeholders are not labels). "Section" then
            the section — so a person arriving mid-task reads where they are before they read what else
            there is. */}
        {/* ⚠ THE AFFORDANCE IS A WORD, NOT A CARET. s17 requires an accessible name for an icon-only
            control; the cheaper way to satisfy it is to not have an icon-only control. "Change" says
            what the disclosure does, and the default triangle is suppressed on both engines —
            `list-none` covers Firefox and the ::-webkit-details-marker rule covers Safari, which
            ignores it. */}
        <summary className="flex min-h-[var(--cp-touch)] cursor-pointer list-none items-center gap-2 px-3.5 text-[13px] [&::-webkit-details-marker]:hidden">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Section</span>
          <span className="font-semibold text-gray-900">
            {tabs.find(t => t.key === active)?.label ?? "Documents"}
          </span>
          <span className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)]">Change</span>
        </summary>
        <ul className="flex flex-col border-t border-gray-100 p-1.5">
          {tabs.map(t => {
            const on = t.key === active;
            return (
              <li key={t.key}>
                <Link
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex min-h-[var(--cp-touch)] items-center rounded-lg px-3 text-[13.5px] font-semibold ${
                    on ? "bg-[var(--cp-primary)]/[0.08] text-[var(--cp-primary-deep)]" : "text-gray-700"
                  }`}
                >
                  {t.label}
                  {/* Status never depends on colour alone (s4). The current section says so in words. */}
                  {on && <span className="ml-auto text-[10.5px] font-bold uppercase tracking-wide">Current</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </details>
    </header>
  );
}
