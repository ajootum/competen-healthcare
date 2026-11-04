"use client";
// Governed policies: the versions of one policy, duplicate-to-draft, and the history timeline.
import Link from "next/link";
import { Btn } from "@/components/assessment/ui";
import { fmtDate } from "@/lib/assessment/studio/vocab";
import type { LifecycleState, TimelineEntry } from "@/lib/assessment/studio/types";
import type { PathwayModel } from "@/lib/assessment/studio/pathway";
import { DefTimeline } from "@/app/super-admin/checklist-studio/_components/DefShared";
import { PathwayPanel } from "@/app/super-admin/checklist-studio/_components/PathwayPanel";
import { Notice, Panel, StateChip, callApi, td, th, useAction } from "@/app/super-admin/checklist-studio/_components/studio-ui";

interface VersionSummary { id: string; version_no: number; state: LifecycleState; authored_by: string[]; published_at: string | null }

export function PolicyVersionsView(p: {
  policyId: string; versions: VersionSummary[]; timeline: TimelineEntry[]; names: Record<string, string>; canAuthor: boolean;
  /** the pathway of each version */
  pathways: Record<string, PathwayModel>; identityPathway: PathwayModel | null;
}) {
  const { busy, msg, run, router } = useAction();
  const base = `/super-admin/policy-manager/${p.policyId}/v`;
  const duplicate = (versionId: string) =>
    run(`duplicate${versionId}`, () => callApi<{ versionId?: string }>(`/api/hq/checklist-studio/versions/${versionId}/transition`, "POST", { kind: "policy", action: "duplicate" }),
      { ok: "A new draft was made.", onOk: (d) => { if (d.versionId) router.push(`${base}/${d.versionId}`); } });
  const latest = p.versions[0] ?? null;
  const latestPathway = latest ? p.pathways[latest.id] ?? null : p.identityPathway;

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {latestPathway && <PathwayPanel model={latestPathway} versionId={latest?.id ?? null} editHref={latest ? `${base}/${latest.id}` : null} versionHrefBase={base} />}
      <Panel title="Versions">
        {p.versions.length === 0 ? (
          <p className="text-sm text-[var(--cmp-app-text-secondary)]">No version yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--cmp-app-border)]">
              <thead><tr><th className={th}>Version</th><th className={th}>State</th><th className={th}>Next step</th><th className={th}>Authored by</th><th className={th}>Published</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-[var(--cmp-app-border)]">
                {p.versions.map((v) => (
                  <tr key={v.id}>
                    <td className={td}><Link href={`${base}/${v.id}`} className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">v{v.version_no}</Link></td>
                    <td className={td}><StateChip state={v.state} /></td>
                    <td className={`${td} max-w-xs`}>{p.pathways[v.id] ? <><span className="font-semibold">{p.pathways[v.id].next.headline}</span>{p.pathways[v.id].next.responsible && <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{p.pathways[v.id].next.responsible}</span>}</> : ""}</td>
                    <td className={td}>{v.authored_by.map((a) => p.names[a] ?? "an author").join(", ")}</td>
                    <td className={td}>{fmtDate(v.published_at)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`${base}/${v.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-[var(--cmp-app-control-border)] px-3 text-sm font-semibold hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)]">{v.state === "draft" ? "Edit" : "Open"}</Link>
                        <Btn size="sm" disabled={!p.canAuthor || busy !== null} onClick={() => duplicate(v.id)} title={p.canAuthor ? "Make a new draft with the same text" : "Needs the policy author capability"}>Duplicate to draft</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <DefTimeline timeline={p.timeline} names={p.names} />
    </div>
  );
}
