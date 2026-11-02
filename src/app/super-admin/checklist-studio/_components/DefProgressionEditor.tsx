"use client";
// Checklist Studio: edits a progression rule set. Progression is not scoring: it places a person on a stage scale from the evidence of
// several assessments, and never from one score unless a rule explicitly permits it. Self-reported evidence is never offered.
import { useMemo, useState } from "react";
import { ProgressionRulesBuilder } from "@/components/assessment";
import { Btn, SelectIn } from "@/components/assessment/ui";
import { PROGRESSION_SCHEMA, validateProgression, type InstrumentDef, type ProgressionDoc, type StageScale } from "@/lib/assessment/core";
import { Notice, Panel, callApi, useAction } from "./studio-ui";
import type { DesignChoice } from "./DefRuleTemplateEditor";

/** Conservative: no stage is reachable until the author writes a rule, repeated evidence is required, nothing from a single assessment. */
export const blankProgression = (): ProgressionDoc => ({
  schema: PROGRESSION_SCHEMA,
  notStaged: "unstaged",
  target: { fromProgramme: true },
  evidence: { attestation: ["assessor_evaluated"] },
  stageRules: [],
  repeated: "latest",
  conflicting: "lowest",
  permitOrdinalMean: false,
  permitSingleAssessment: false,
});

const hasDoc = (d: unknown): d is ProgressionDoc => !!d && typeof d === "object" && Array.isArray((d as ProgressionDoc).stageRules);

export function DefProgressionEditor({ versionId, initialRules, initialTests, stageScaleVersionId, stageScale, description, designs, editable }: {
  versionId: string; initialRules: Record<string, unknown>; initialTests: unknown[]; stageScaleVersionId: string; stageScale: StageScale; description: string | null;
  designs: DesignChoice[]; editable: boolean;
}) {
  const [doc, setDoc] = useState<ProgressionDoc | null>(hasDoc(initialRules) ? initialRules : null);
  const [desc, setDesc] = useState(description ?? "");
  const [designId, setDesignId] = useState("");
  const [dirty, setDirty] = useState(false);
  const { busy, msg, run } = useAction();
  const def: InstrumentDef | undefined = designs.find((d) => d.id === designId)?.def;
  const validation = useMemo(() => (doc ? validateProgression(doc, stageScale, def) : null), [doc, stageScale, def]);

  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/definitions/progression/${versionId}`, "PUT", { rules: doc, tests: initialTests, stageScaleVersionId, description: desc }),
    { ok: "Saved.", onOk: () => setDirty(false) });

  return (
    <div className="space-y-4">
      {!editable && <Notice tone="info">This version is read-only. Only a draft can be edited, and only by someone who holds the author capability. Duplicate it to make a new draft.</Notice>}
      <Notice tone="info">A stage placed here is evidence-supported, never verified. Self-reported assessments are not offered as evidence. The stage scale is fixed for this version.</Notice>
      <Panel title="About">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Description
          <textarea value={desc} disabled={!editable} onChange={(e) => { setDesc(e.target.value); setDirty(true); }} rows={2} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
        </label>
      </Panel>
      <Panel title="Evidence comes from (optional)">
        <SelectIn label="Checklist version" value={designId} onChange={setDesignId} options={[{ value: "", label: "Not chosen" }, ...designs.map((d) => ({ value: d.id, label: d.label }))]}
          hint="Offers its group and method names in the rule builder. Nothing is written to it." />
      </Panel>
      {doc === null ? (
        <Panel title="Rules">
          <p className="mb-3 text-sm text-[var(--cmp-app-text-secondary)]">This rule set has no rules yet. The blank start places nobody on any stage until you write a rule.</p>
          <Btn kind="primary" disabled={!editable} onClick={() => { setDoc(blankProgression()); setDirty(true); }}>Start with blank rules</Btn>
        </Panel>
      ) : (
        <ProgressionRulesBuilder doc={doc} stageScale={stageScale} def={def} readOnly={!editable} validation={validation ?? undefined} onChange={(d) => { setDoc(d); setDirty(true); }} />
      )}
      {editable && (
        <div className="space-y-2">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <Btn kind="primary" disabled={!dirty || doc === null || busy !== null} onClick={save}>{busy ? "Saving…" : "Save rules"}</Btn>
            {dirty && <span className="text-xs text-[var(--cmp-app-text-secondary)]">Unsaved changes</span>}
            {validation && validation.errors.length > 0 && <span className="text-xs text-[var(--cmp-text-error)]">{validation.errors.length} problem(s). A draft can be saved, but not put forward.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
