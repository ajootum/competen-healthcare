"use client";
// Checklist Studio: the review queue as a table. Opening a row goes to the version, where the decision is recorded.
import Link from "next/link";
import { Chip } from "@/components/assessment/ui";
import { td, th } from "./studio-ui";

export interface ReviewRow {
  key: string; kind: string; code: string; name: string; versionNo: number; submittedBy: string; submittedAt: string;
  governance: number; domain: number; requiresDomainReview: boolean; href: string;
}

export function DefReviewQueue({ rows, canReview }: { rows: ReviewRow[]; canReview: boolean }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text-secondary)]">
      {canReview ? "Nothing is waiting for your decision. Versions you wrote, edited or submitted never appear here." : "Nothing to show."}
    </p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]">
      <table className="min-w-full divide-y divide-[var(--cmp-app-border)]">
        <thead><tr><th className={th}>What</th><th className={th}>Code and name</th><th className={th}>Version</th><th className={th}>Submitted by</th><th className={th}>Submitted</th><th className={th}>Approvals so far</th><th className={th}><span className="sr-only">Open</span></th></tr></thead>
        <tbody className="divide-y divide-[var(--cmp-app-border)]">
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-[var(--cmp-app-bg)]">
              <td className={td}><Chip>{r.kind}</Chip></td>
              <td className={td}><span className="font-mono text-xs">{r.code}</span> {r.name}</td>
              <td className={td}>v{r.versionNo}</td>
              <td className={td}>{r.submittedBy}</td>
              <td className={td}>{r.submittedAt}</td>
              <td className={td}>Governance {r.governance}{r.requiresDomainReview ? `, domain ${r.domain}` : ""}</td>
              <td className={td}><Link href={r.href} className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">Open to review</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
