"use client";
// Checklist Studio: optional mapping of a rating scale onto a published stage scale (owner decision 2, 3 Nov 2026).
// The person assigns a stage to each rating level by hand. Nothing is prefilled from numeric values. The result is a NEW
// DRAFT stage scale carrying the bands, reviewed and published by independent people; the rating scale itself is unchanged.
import { useState } from "react";
import { Btn, Chip, Check, SelectIn, TextIn } from "@/components/assessment/ui";
import type { ScaleLevelRow } from "@/lib/assessment/studio/types";
import type { ExistingMapping } from "@/lib/assessment/adapters/scholar/stage-mapping";
import { Notice, Panel, callApi, useAction } from "./studio-ui";

type Target = { id: string; code: string; name: string; versionNo: number; stages: { code: string; label: string; ordinal: number }[] };

export function StageMappingPanel({ ratingVersionId, ratingCode, levels, targets, mappings, canAuthor }: {
  ratingVersionId: string; ratingCode: string; levels: ScaleLevelRow[]; targets: Target[]; mappings: ExistingMapping[]; canAuthor: boolean;
}) {
  const [targetId, setTargetId] = useState("");
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { busy, msg, run, router } = useAction();
  const target = targets.find((t) => t.id === targetId) ?? null;
  const assigned = levels.filter((l) => assign[l.code]).length;
  const sorted = [...levels].sort((a, b) => a.ordinal - b.ordinal);

  const create = () => run("map", () => callApi<{ stageVersionId: string; code: string; created: string }>(`/api/hq/checklist-studio/definitions/scale/${ratingVersionId}`, "POST", {
    action: "stage_mapping", stageVersionId: targetId, note, confirmed,
    assignments: sorted.map((l) => ({ levelCode: l.code, stageCode: assign[l.code] || null })),
  }), { refresh: false, onOk: (d) => router.push(`/super-admin/checklist-studio/scales/v/${d.stageVersionId}`) });

  return (
    <Panel title="Mapping to a staging scale (optional)">
      <p className="text-xs text-[var(--cmp-app-text-secondary)]">
        This scale keeps its own levels and descriptions as imported. If its levels should also place a person on a staging scale (for example the Competen proficiency stages),
        assign a stage to each level here by hand. Nothing is inferred from matching numbers. The mapping becomes a <b>new draft stage scale</b> ({ratingCode}-STAGES)
        that someone else reviews and publishes, and this rating scale is not changed.
      </p>
      {mappings.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {mappings.map((m) => (
            <li key={m.stageVersionId} className="flex flex-wrap items-center gap-2">
              <a className="font-semibold underline" href={`/super-admin/checklist-studio/scales/v/${m.stageVersionId}`}>{m.code} v{m.versionNo}</a>
              <Chip tone={m.state === "published" ? "success" : m.state === "draft" ? "neutral" : "info"}>{m.state.replace("_", " ")}</Chip>
              <span className="text-xs text-[var(--cmp-app-text-secondary)]">{m.bands.map((b) => `${b.stageCode}: levels ${b.fromOrdinal}${b.toOrdinal !== b.fromOrdinal ? ` to ${b.toOrdinal}` : ""}`).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
      {!canAuthor ? <p className="mt-2 text-xs text-[var(--cmp-app-text-secondary)]">Making a mapping draft needs the author capability.</p> : targets.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--cmp-app-text-secondary)]">No published stage scale exists yet, so there is nothing to map onto. Publish a stage scale under Scales first.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <SelectIn label="Stage scale to map onto (published)" value={targetId} onChange={(v) => { setTargetId(v); setAssign({}); setConfirmed(false); }}
            options={[{ value: "", label: "Choose a stage scale" }, ...targets.map((t) => ({ value: t.id, label: `${t.name} (${t.code}) v${t.versionNo}, ${t.stages.length} stages` }))]} />
          {target && (
            <>
              <ul className="space-y-2">
                {sorted.map((l) => (
                  <li key={l.code} className="grid gap-2 sm:grid-cols-[1fr_16rem] sm:items-end">
                    <div className="text-sm"><span className="font-mono text-xs text-[var(--cmp-app-text-secondary)]">{l.code}</span> <span className="font-semibold">{l.label}</span>{l.description ? <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{l.description}</span> : null}</div>
                    <SelectIn label={`Stage for level ${l.code}`} value={assign[l.code] ?? ""} onChange={(v) => { setAssign((p) => ({ ...p, [l.code]: v })); setConfirmed(false); }}
                      options={[{ value: "", label: "Not mapped" }, ...target.stages.map((s) => ({ value: s.code, label: s.label }))]} />
                  </li>
                ))}
              </ul>
              <TextIn label="Note for the reviewer (optional)" value={note} onChange={setNote} placeholder="Why these stages, and what was left unmapped" />
              <Check label="I assigned each stage by hand and reviewed the mapping. Nothing was inferred from the numeric values." checked={confirmed} onChange={setConfirmed} />
              {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              <div className="flex flex-wrap items-center gap-3">
                <Btn kind="primary" disabled={busy !== null || !confirmed || assigned === 0} onClick={create}>{busy ? "Creating…" : "Create mapping draft for review"}</Btn>
                <span className="text-xs text-[var(--cmp-app-text-secondary)]">{assigned} of {levels.length} levels assigned{assigned < levels.length ? "; the rest stay unmapped" : ""}.</span>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
