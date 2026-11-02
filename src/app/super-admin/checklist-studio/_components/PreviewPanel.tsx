"use client";
// Checklist Studio: Preview. The runner in Standard and Guided mode with sample answers. NOTHING is written anywhere: the answers live in
// this component only, and the outcome is computed in the browser by the same engine that scores a real assessment.
import { useMemo, useState } from "react";
import { AssessmentRunner } from "@/components/assessment";
import type { RunnerMode } from "@/components/assessment";
import { Btn } from "@/components/assessment/ui";
import { presetAllNA, presetAllSatisfactory, presetBlank, presetOneCriticalFailed, STANDARD_CHECKLIST_LAYOUT, type LayoutDoc, type Responses, type RulesDoc } from "@/lib/assessment/core";
import { toDefinition } from "@/lib/assessment/studio/assemble";
import type { EditorContent } from "@/lib/assessment/studio/types";
import { Notice } from "./studio-ui";

const hasRules = (d: unknown): d is RulesDoc => !!d && typeof d === "object" && Array.isArray((d as RulesDoc).outcomes);

export function PreviewPanel({ content, versionNo, instrumentCode, title, scoring, layout }: {
  content: EditorContent; versionNo: number; instrumentCode: string; title: string; scoring: Record<string, unknown>; layout: Record<string, unknown> | null;
}) {
  const [responses, setResponses] = useState<Responses>({});
  const [mode, setMode] = useState<RunnerMode>("standard");
  const def = useMemo(() => toDefinition(content, { instrumentCode, versionNo }), [content, instrumentCode, versionNo]);
  const rules = hasRules(scoring) ? scoring : null;
  const layoutDoc = (layout as unknown as LayoutDoc | null) ?? STANDARD_CHECKLIST_LAYOUT;
  if (def.items.length === 0) return <Notice>Add items on the Content tab to preview them.</Notice>;
  return (
    <div className="space-y-3">
      <Notice>Preview only. Sample answers stay in this page and are never saved. {rules ? "The outcome uses the saved scoring rules." : "No scoring rules are saved yet, so there is no outcome to preview."}</Notice>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Sample answers">
        <Btn size="sm" onClick={() => setResponses(presetBlank())}>Blank</Btn>
        <Btn size="sm" onClick={() => setResponses(presetAllSatisfactory(def))}>All satisfactory</Btn>
        <Btn size="sm" onClick={() => setResponses(presetOneCriticalFailed(def))}>One critical failed</Btn>
        <Btn size="sm" onClick={() => setResponses(presetAllNA(def))}>All not applicable</Btn>
      </div>
      <AssessmentRunner
        def={def} layout={layoutDoc} responses={responses} onChange={(next) => setResponses(next)} rules={rules} mode={mode} onModeChange={setMode}
        title={title} subtitle="Preview" breakpoint="auto" modeSwitch
      />
    </div>
  );
}
