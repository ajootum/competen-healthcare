"use client";
// Checklist Studio, definition pages: "New ..." and "Import ..." dialogs. The server makes the definition and its first draft version.
import { useState } from "react";
import { Btn, Labelled, SelectIn, TextIn, fieldBase, touchSm } from "@/components/assessment/ui";
import { PRESENTATIONS, AVAILABLE_PRESENTATIONS } from "@/lib/assessment/core";
import { CODE_PATTERN } from "@/lib/assessment/studio/vocab";
import { DefModal, NO_AUTHOR } from "./DefShared";
import { Notice, callApi, useAction } from "./studio-ui";

type DefType = "scale" | "rule_template" | "layout_template" | "progression";

const NOUN: Record<DefType, string> = { scale: "scale", rule_template: "scoring template", layout_template: "layout template", progression: "progression rule set" };

export interface DefCreateProps {
  type: DefType;
  /** where the draft is edited: `${basePath}/v/${versionId}` */
  basePath: string;
  canAuthor: boolean;
  /** published stage scale versions (progression only) */
  stageScales?: { id: string; label: string }[];
}

const PRESENTATION_LABEL: Record<string, string> = {
  standard_checklist: "Standard checklist", guided_assessment: "Guided assessment", audit_inspection: "Audit and inspection", assessment_form: "Assessment form", matrix: "Matrix",
};

export function DefCreate({ type, basePath, canAuthor, stageScales = [] }: DefCreateProps) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scaleKind, setScaleKind] = useState<"rating" | "stage">("rating");
  const [presentation, setPresentation] = useState("standard_checklist");
  const [targetKind, setTargetKind] = useState("person_stage");
  const [stage, setStage] = useState("");
  const { busy, msg, run, router } = useAction();
  const upper = code.trim().toUpperCase();
  const valid = CODE_PATTERN.test(upper) && name.trim().length > 0 && (type !== "progression" || stage !== "");

  const save = () => run("create", () => callApi<{ versionId: string }>("/api/hq/checklist-studio/definitions", "POST", {
    action: "create", type, code: upper, name: name.trim(), description, scaleKind, presentation, targetKind, stageScaleVersionId: stage || undefined,
  }), { refresh: false, onOk: (d) => router.push(`${basePath}/v/${d.versionId}`) });

  return (
    <>
      <div>
        <Btn kind="primary" disabled={!canAuthor} onClick={() => setOpen(true)}>New {NOUN[type]}</Btn>
        {!canAuthor && <span className="mt-1 block max-w-xs text-xs text-[var(--cmp-app-text-secondary)]">{NO_AUTHOR}</span>}
      </div>
      {open && (
        <DefModal title={`New ${NOUN[type]}`} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <TextIn label="Code" value={code} onChange={setCode} placeholder="for example MY-SCALE-01" hint="Capital letters, numbers and hyphens, 3 to 41 characters. It never changes." />
            {code.trim() !== "" && !CODE_PATTERN.test(upper) && <p role="alert" className="text-xs text-[var(--cmp-text-error)]">That code does not fit the pattern.</p>}
            <TextIn label="Name" value={name} onChange={setName} />
            <Labelled label="Description (optional)">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${fieldBase} ${touchSm}`} />
            </Labelled>
            {type === "scale" && (
              <SelectIn label="Kind" value={scaleKind} onChange={(v) => setScaleKind(v as "rating" | "stage")}
                options={[{ value: "rating", label: "Rating scale (answers on an item)" }, { value: "stage", label: "Stage scale (where progression places a person)" }]} />
            )}
            {type === "layout_template" && (
              <SelectIn label="Presentation" value={presentation} onChange={setPresentation}
                options={PRESENTATIONS.map((p) => ({ value: p, label: `${PRESENTATION_LABEL[p] ?? p}${AVAILABLE_PRESENTATIONS.includes(p) ? "" : " (not yet available to publish)"}` }))} />
            )}
            {type === "progression" && (
              <>
                <TextIn label="Target kind" value={targetKind} onChange={setTargetKind} hint="What this rule set places, as lower case text." />
                <SelectIn label="Stage scale" value={stage} onChange={setStage} options={[{ value: "", label: "Choose a published stage scale" }, ...stageScales.map((s) => ({ value: s.id, label: s.label }))]}
                  hint={stageScales.length === 0 ? "No published stage scale exists yet. Publish one under Scales first." : undefined} />
              </>
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Btn kind="primary" disabled={!valid || busy !== null} onClick={save}>{busy ? "Creating…" : "Create draft"}</Btn>
              <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            </div>
          </div>
        </DefModal>
      )}
    </>
  );
}

export interface SourceScaleOption { id: string; name: string; levels: number; mappings: { id: string; version: number }[] }

export function DefScaleImport({ sources, canAuthor }: { sources: SourceScaleOption[]; canAuthor: boolean }) {
  const [open, setOpen] = useState(false);
  const [scaleId, setScaleId] = useState("");
  const [mappingId, setMappingId] = useState("");
  const { busy, msg, run, router } = useAction();
  const chosen = sources.find((s) => s.id === scaleId);
  const go = () => run("import", () => callApi<{ versionId: string }>("/api/hq/checklist-studio/definitions", "POST", { action: "import_scale", scaleId, mappingId: mappingId || undefined }),
    { refresh: false, onOk: (d) => router.push(`/super-admin/checklist-studio/scales/v/${d.versionId}`) });
  return (
    <>
      <div>
        <Btn disabled={!canAuthor} onClick={() => setOpen(true)}>Import from an existing scoring scale</Btn>
        {!canAuthor && <span className="mt-1 block max-w-xs text-xs text-[var(--cmp-app-text-secondary)]">{NO_AUTHOR}</span>}
      </div>
      {open && (
        <DefModal title="Import a scale" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-[var(--cmp-app-text-secondary)]">The levels become a DRAFT response scale. With a published stage mapping, the stage scale and its bands are made too. Somebody else publishes them.</p>
            <SelectIn label="Existing scale" value={scaleId} onChange={(v) => { setScaleId(v); setMappingId(""); }}
              options={[{ value: "", label: sources.length ? "Choose a scale" : "No scale with levels was found" }, ...sources.map((s) => ({ value: s.id, label: `${s.name} (${s.levels} levels)` }))]} />
            {chosen && (
              <SelectIn label="Published stage mapping (optional)" value={mappingId} onChange={setMappingId}
                options={[{ value: "", label: "None" }, ...chosen.mappings.map((m) => ({ value: m.id, label: `Mapping version ${m.version}` }))]} />
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Btn kind="primary" disabled={!scaleId || busy !== null} onClick={go}>{busy ? "Importing…" : "Import as a draft"}</Btn>
              <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            </div>
          </div>
        </DefModal>
      )}
    </>
  );
}
