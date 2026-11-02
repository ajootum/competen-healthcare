"use client";
// Checklist Studio: edits a scoring template (a rules document and its saved tests) with the visual Rules Builder.
// A rule refers to sections, groups and items, so the builder needs a checklist to design against. The template is stored on its own,
// and it is validated again, with its saved tests, against every checklist it is copied into.
import { useMemo, useState } from "react";
import { RulesBuilder } from "@/components/assessment";
import { Btn, SelectIn } from "@/components/assessment/ui";
import { RULES_SCHEMA, validateRules, type InstrumentDef, type RulesDoc, type ScoringTestCase } from "@/lib/assessment/core";
import { Notice, Panel, callApi, useAction } from "./studio-ui";

export interface DesignChoice { id: string; label: string; def: InstrumentDef }

const EMPTY_DEF: InstrumentDef = { version_no: 1, groups: [], sections: [], items: [] };

/** A conservative starting point: the two built in gates and a fallback that is Incomplete, so nothing passes by default. */
export const blankRules = (): RulesDoc => ({
  schema: RULES_SCHEMA,
  outcomes: [
    { code: "MET", label: "Met", class: "positive" },
    { code: "NOT_MET", label: "Not met", class: "negative" },
    { code: "INC", label: "Incomplete", class: "incomplete" },
  ],
  gates: { criticalFail: "NOT_MET", mandatoryMissing: "INC" },
  rules: [],
  fallback: "INC",
});

const hasRules = (d: unknown): d is RulesDoc => !!d && typeof d === "object" && Array.isArray((d as RulesDoc).outcomes);

export function DefRuleTemplateEditor({ versionId, initialRules, initialTests, description, designs, editable }: {
  versionId: string; initialRules: Record<string, unknown>; initialTests: unknown[]; description: string | null; designs: DesignChoice[]; editable: boolean;
}) {
  const [doc, setDoc] = useState<RulesDoc | null>(hasRules(initialRules) ? initialRules : null);
  const [tests, setTests] = useState<ScoringTestCase[]>(initialTests as ScoringTestCase[]);
  const [desc, setDesc] = useState(description ?? "");
  const [designId, setDesignId] = useState(designs[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const { busy, msg, run } = useAction();
  const def = designs.find((d) => d.id === designId)?.def ?? EMPTY_DEF;
  const validation = useMemo(() => (doc ? validateRules(def, doc) : null), [def, doc]);

  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/definitions/rule-template/${versionId}`, "PUT", { rules: doc, tests, description: desc }),
    { ok: "Saved.", onOk: () => setDirty(false) });

  return (
    <div className="space-y-4">
      {!editable && <Notice tone="info">This version is read-only. Only a draft can be edited, and only by someone who holds the author capability. Duplicate it to make a new draft.</Notice>}
      <Notice tone="info">A scoring template is checked again, with its saved tests, against every checklist it is copied into. A rule that names a section, group or item that checklist does not have is refused there. Design against a checklist that looks like the ones you will copy it into.</Notice>
      <Panel title="About">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Description
          <textarea value={desc} disabled={!editable} onChange={(e) => { setDesc(e.target.value); setDirty(true); }} rows={2} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
        </label>
      </Panel>
      <Panel title="Design against">
        {designs.length === 0 ? <p className="text-sm text-[var(--cmp-app-text-secondary)]">No checklist exists yet to design against. Create a checklist first, then come back to build the rules.</p> : (
          <SelectIn label="Checklist version" value={designId} onChange={setDesignId} options={designs.map((d) => ({ value: d.id, label: d.label }))}
            hint="Used only to offer sections, groups and items in the builder. Nothing is written to it." />
        )}
      </Panel>
      {doc === null ? (
        <Panel title="Rules">
          <p className="mb-3 text-sm text-[var(--cmp-app-text-secondary)]">This template has no rules yet.</p>
          <Btn kind="primary" disabled={!editable} onClick={() => { setDoc(blankRules()); setDirty(true); }}>Start with blank rules</Btn>
        </Panel>
      ) : (
        <RulesBuilder def={def} doc={doc} readOnly={!editable} onChange={(d) => { setDoc(d); setDirty(true); }}
          tests={tests} onTestsChange={(t) => { setTests(t); setDirty(true); }} validation={validation ?? undefined} />
      )}
      {editable && (
        <div className="space-y-2">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex items-center gap-3">
            <Btn kind="primary" disabled={!dirty || doc === null || busy !== null} onClick={save}>{busy ? "Saving…" : "Save template"}</Btn>
            {dirty && <span className="text-xs text-[var(--cmp-app-text-secondary)]">Unsaved changes</span>}
            {validation && validation.errors.length > 0 && <span className="text-xs text-[var(--cmp-text-error)]">{validation.errors.length} problem(s) against this checklist. A draft can still be saved.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
