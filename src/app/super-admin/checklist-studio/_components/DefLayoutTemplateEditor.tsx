"use client";
// Checklist Studio: edits a layout template with the Template Designer. The designer already offers desktop, tablet, mobile and print
// previews, drawn with a checklist you choose to design against (sample answers, never saved). A layout can never hide or reorder an item.
import { useMemo, useState } from "react";
import { LayoutDesigner } from "@/components/assessment";
import { Btn, SelectIn } from "@/components/assessment/ui";
import { GUIDED_ASSESSMENT_LAYOUT, STANDARD_CHECKLIST_LAYOUT, validateLayout, type InstrumentDef, type LayoutDoc } from "@/lib/assessment/core";
import { Notice, Panel, callApi, useAction } from "./studio-ui";
import type { DesignChoice } from "./DefRuleTemplateEditor";

const EMPTY_DEF: InstrumentDef = { version_no: 1, groups: [], sections: [], items: [] };

const startingLayout = (presentation: string): LayoutDoc =>
  presentation === "guided_assessment" ? GUIDED_ASSESSMENT_LAYOUT
  : presentation === "standard_checklist" ? STANDARD_CHECKLIST_LAYOUT
  : { ...STANDARD_CHECKLIST_LAYOUT, presentation: presentation as LayoutDoc["presentation"] };

export function DefLayoutTemplateEditor({ versionId, initialLayout, presentation, description, designs, editable }: {
  versionId: string; initialLayout: Record<string, unknown>; presentation: string; description: string | null; designs: DesignChoice[]; editable: boolean;
}) {
  const filled = initialLayout && typeof initialLayout === "object" && "navigation" in initialLayout;
  const [layout, setLayout] = useState<LayoutDoc>(filled ? (initialLayout as unknown as LayoutDoc) : startingLayout(presentation));
  const [desc, setDesc] = useState(description ?? "");
  const [designId, setDesignId] = useState(designs[0]?.id ?? "");
  // an empty draft starts from a built-in layout, so the first save is a change worth making
  const [dirty, setDirty] = useState(!filled);
  const { busy, msg, run } = useAction();
  const def = designs.find((d) => d.id === designId)?.def ?? EMPTY_DEF;
  const validation = useMemo(() => validateLayout(layout, def, { forPublication: true }), [layout, def]);

  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/definitions/layout-template/${versionId}`, "PUT", { layout, presentation: layout.presentation, description: desc }),
    { ok: "Saved.", onOk: () => setDirty(false) });

  return (
    <div className="space-y-4">
      {!editable && <Notice tone="info">This version is read-only. Only a draft can be edited, and only by someone who holds the author capability. Duplicate it to make a new draft.</Notice>}
      <Panel title="About">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Description
          <textarea value={desc} disabled={!editable} onChange={(e) => { setDesc(e.target.value); setDirty(true); }} rows={2} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
        </label>
      </Panel>
      <Panel title="Design against">
        {designs.length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">No checklist exists yet, so the preview has nothing to draw. Create a checklist first to see the layout on real items.</p> : (
          <SelectIn label="Checklist version for the preview" value={designId} onChange={setDesignId} options={designs.map((d) => ({ value: d.id, label: d.label }))}
            hint="Used only for the desktop, tablet, mobile and print previews. Nothing is written to it." />
        )}
      </Panel>
      <LayoutDesigner layout={layout} def={def} readOnly={!editable} validation={validation} forPublication onChange={(l) => { setLayout(l); setDirty(true); }} />
      {editable && (
        <div className="space-y-2">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <Btn kind="primary" disabled={!dirty || busy !== null} onClick={save}>{busy ? "Saving…" : "Save layout"}</Btn>
            {dirty && <span className="text-xs text-[var(--cmp-app-text-secondary)]">Unsaved changes</span>}
            {validation.errors.length > 0 && <span className="text-xs text-[var(--cmp-text-error)]">{validation.errors.length} problem(s). A draft can be saved, but it cannot be put forward until they are fixed.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
