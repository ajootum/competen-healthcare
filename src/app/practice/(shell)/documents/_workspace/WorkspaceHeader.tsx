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
          <nav aria-label="Beside this workspace" className="flex flex-col items-end gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Beside this workspace</span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {adjacent.map(a => (
                <Link
                  key={a.href} href={a.href} title={a.blurb}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-600 transition hover:border-[var(--cp-primary)]/40 hover:text-[var(--cp-primary-deep)]"
                >
                  {a.label} &rarr;
                </Link>
              ))}
            </span>
          </nav>
        )}
      </div>

      <nav aria-label="Documents areas" className="flex flex-wrap items-center gap-1 border-b border-gray-200">
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
    </header>
  );
}
