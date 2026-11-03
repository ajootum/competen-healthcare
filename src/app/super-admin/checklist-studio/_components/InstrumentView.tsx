"use client";
// Checklist Studio: versions of one instrument, duplicate-to-draft, retire, and the history timeline.
import Link from "next/link";
import { useState } from "react";
import { Btn, SelectIn } from "@/components/assessment/ui";
import { fmtDate, fmtDateTime } from "@/lib/assessment/studio/vocab";
import type { LifecycleState, TimelineEntry } from "@/lib/assessment/studio/types";
import { DefTimeline } from "./DefShared";
import { PathwayPanel } from "./PathwayPanel";
import type { PathwayModel } from "@/lib/assessment/studio/pathway";
import { Notice, Panel, StateChip, callApi, td, th, useAction } from "./studio-ui";

interface VersionSummary {
  id: string; version_no: number; state: LifecycleState; purpose_code: string; delivery_modes: string[]; authored_by: string[];
  published_at: string | null; submitted_at: string | null; created_at: string; risk: "standard" | "high";
}

export function InstrumentView(p: {
  instrumentId: string; versions: VersionSummary[]; timeline: TimelineEntry[]; names: Record<string, string>;
  purposes: { code: string; label: string; publishable: boolean }[]; canAuthor: boolean; canPublish: boolean;
  /** ASMT-PATHWAY-01: the pathway of each version, and of the identity while it has none */
  pathways?: Record<string, PathwayModel>; identityPathway?: PathwayModel | null; catalogueHref?: string;
}) {
  const { busy, msg, run, router } = useAction();
  const base = `/super-admin/checklist-studio/${p.instrumentId}/v`;
  const act = (versionId: string, action: "duplicate" | "retire") =>
    run(`${action}${versionId}`, () => callApi<{ versionId?: string }>(`/api/hq/checklist-studio/versions/${versionId}/transition`, "POST", { kind: "instrument", action }),
      { ok: action === "duplicate" ? "A new draft was made." : "Retired.", onOk: (d) => { if (action === "duplicate" && d.versionId) router.push(`${base}/${d.versionId}`); } });
  const publishable = p.purposes.filter((x) => x.publishable);
  const [purpose, setPurpose] = useState(publishable[0]?.code ?? "");
  const first = () => run("first", () => callApi<{ versionId: string }>(`/api/hq/checklist-studio/instruments/${p.instrumentId}`, "POST", { action: "first_version", purpose }), { onOk: (d) => router.push(`${base}/${d.versionId}`) });
  const latest = p.versions[0] ?? null;
  const latestPathway = latest ? p.pathways?.[latest.id] ?? null : p.identityPathway ?? null;

  return (
    <div className="space-y-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {latestPathway && (
        <PathwayPanel model={latestPathway} versionId={latest?.id ?? null} editHref={latest ? `${base}/${latest.id}` : null} catalogueHref={p.catalogueHref ?? null} versionHrefBase={base}
          onFirstVersion={!latest && p.canAuthor && purpose ? first : undefined} />
      )}
      <Panel title="Versions">
        {p.versions.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--cmp-app-text-secondary)]">This instrument was registered in the catalogue and has no version yet. Create its first draft to start authoring.</p>
            <div className="flex flex-wrap items-end gap-3">
              <SelectIn label="Purpose" value={purpose} onChange={setPurpose} options={publishable.map((x) => ({ value: x.code, label: x.label }))} />
              <Btn kind="primary" disabled={!p.canAuthor || busy !== null || !purpose} onClick={first}>Create first draft</Btn>
            </div>
            {!p.canAuthor && <p className="text-sm text-[var(--cmp-app-text-secondary)]">Needs the author capability.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--cmp-app-border)]">
              <thead><tr><th className={th}>Version</th><th className={th}>State</th><th className={th}>Next step</th><th className={th}>Purpose</th><th className={th}>Delivery</th><th className={th}>Authored by</th><th className={th}>Published</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-[var(--cmp-app-border)]">
                {p.versions.map((v) => (
                  <tr key={v.id}>
                    <td className={td}><Link href={`${base}/${v.id}`} className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2">v{v.version_no}</Link>{v.risk === "high" && <span className="ml-1 text-xs text-[var(--cmp-text-warning)]">high risk</span>}</td>
                    <td className={td}><StateChip state={v.state} /></td>
                    <td className={`${td} max-w-xs`}>{p.pathways?.[v.id] ? <><span className="font-semibold">{p.pathways[v.id].next.headline}</span>{p.pathways[v.id].next.responsible && <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{p.pathways[v.id].next.responsible}</span>}</> : ""}</td>
                    <td className={td}>{p.purposes.find((x) => x.code === v.purpose_code)?.label ?? v.purpose_code}</td>
                    <td className={td}>{v.delivery_modes.join(", ") || "none yet"}</td>
                    <td className={td}>{v.authored_by.map((a) => p.names[a] ?? "an author").join(", ")}</td>
                    <td className={td}>{fmtDate(v.published_at)}</td>
                    <td className={`${td} whitespace-nowrap`}>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`${base}/${v.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-[var(--cmp-app-control-border)] px-3 text-sm font-semibold hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)]">{v.state === "draft" ? "Edit" : "Open"}</Link>
                        <Btn size="sm" disabled={!p.canAuthor || busy !== null} onClick={() => act(v.id, "duplicate")} title={p.canAuthor ? "Make a new draft with the same content" : "Needs the author capability"}>Duplicate to draft</Btn>
                        {v.state === "published" && <Btn size="sm" kind="danger" disabled={!p.canPublish || busy !== null} onClick={() => { if (window.confirm("Retire this version?")) void act(v.id, "retire"); }}>Retire</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="History">
        {p.timeline.length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">Nothing has happened yet.</p> : <DefTimeline timeline={p.timeline} names={p.names} />}
        <p className="mt-2 text-xs text-[var(--cmp-app-text-secondary)]">Every transition and every review decision is kept. {p.timeline.length ? `Last: ${fmtDateTime(p.timeline[p.timeline.length - 1].at)}.` : ""}</p>
      </Panel>
    </div>
  );
}
