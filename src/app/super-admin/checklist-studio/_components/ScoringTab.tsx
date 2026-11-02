"use client";
// Checklist Studio, Scoring & Rules tab: the visual Rules Builder and Test Scoring over the CURRENT (even unsaved) content.
// "Start from template" copies a PUBLISHED scoring template into this draft, and the server re-validates it against THIS checklist.
import { useMemo, useState } from "react";
import { RulesBuilder } from "@/components/assessment";
import { Btn, SelectIn } from "@/components/assessment/ui";
import { toDefinition } from "@/lib/assessment/studio/assemble";
import { validateRules, type RulesDoc, type ScoringTestCase } from "@/lib/assessment/core";
import type { EditorContent, StudioIssue, ValidationReport } from "@/lib/assessment/studio/types";
import { blankRules } from "./DefRuleTemplateEditor";
import { IssueList, Notice, Panel, callApi, useAction } from "./studio-ui";

export interface RuleTemplateOption { id: string; label: string }

const hasRules = (d: unknown): d is RulesDoc => !!d && typeof d === "object" && Array.isArray((d as RulesDoc).outcomes);

export function ScoringTab({ versionId, versionNo, instrumentCode, content, contentDirty, initialScoring, initialTests, templates, templateId, editable }: {
  versionId: string; versionNo: number; instrumentCode: string; content: EditorContent; contentDirty: boolean;
  initialScoring: Record<string, unknown>; initialTests: unknown[]; templates: RuleTemplateOption[]; templateId: string | null; editable: boolean;
}) {
  const [doc, setDoc] = useState<RulesDoc | null>(hasRules(initialScoring) ? initialScoring : null);
  const [tests, setTests] = useState<ScoringTestCase[]>(initialTests as ScoringTestCase[]);
  const [tpl, setTpl] = useState(templates[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [server, setServer] = useState<ValidationReport | null>(null);
  const [copyIssues, setCopyIssues] = useState<StudioIssue[]>([]);
  const { busy, msg, run, router } = useAction();
  const def = useMemo(() => toDefinition(content, { instrumentCode, versionNo }), [content, instrumentCode, versionNo]);
  const live = useMemo(() => (doc ? validateRules(def, doc) : undefined), [def, doc]);
  const url = `/api/hq/checklist-studio/versions/${versionId}/scoring`;

  const save = () => run("save", () => callApi<{ validation: ValidationReport | null }>(url, "PUT", { scoring: doc, tests, templateVersionId: templateId }),
    { ok: "Scoring saved.", onOk: (d) => { setDirty(false); setServer(d.validation); } });
  const copy = () => run("copy", () => callApi<{ report: ValidationReport }>(url, "POST", { action: "copy_template", templateVersionId: tpl }),
    { ok: "The template was copied into this draft. Check the validation below.", onOk: (d) => { setCopyIssues(d.report.errors); router.refresh(); } });

  return (
    <div className="space-y-4">
      {!editable && <Notice>Scoring can be changed only on a draft, by a person who holds the author capability.</Notice>}
      {contentDirty && <Notice tone="warning">The content has unsaved changes. The builder uses them, but the server checks the saved content. Save the content first.</Notice>}
      <Panel title="Start from a template">
        <div className="flex flex-wrap items-end gap-3">
          <SelectIn label="Published scoring template" value={tpl} onChange={setTpl} className="min-w-64" options={[{ value: "", label: templates.length ? "Choose a template" : "No published template exists" }, ...templates.map((t) => ({ value: t.id, label: t.label }))]} />
          <Btn disabled={!editable || !tpl || busy !== null} onClick={() => { if (!doc || window.confirm("Replace the current rules with this template?")) void copy(); }}>{busy === "copy" ? "Copying…" : "Copy into this draft"}</Btn>
          {!doc && <Btn disabled={!editable} onClick={() => { setDoc(blankRules()); setDirty(true); }}>Start with blank rules</Btn>}
        </div>
        <p className="mt-2 text-xs text-[var(--cmp-app-text-secondary)]">A copied template is validated again against this checklist, with its saved tests. Nothing is hard-coded: outcomes, thresholds and percentages are all your rules.</p>
        {copyIssues.length > 0 && <div className="mt-2"><IssueList issues={copyIssues} tone="error" /></div>}
      </Panel>

      {doc ? (
        <RulesBuilder def={def} doc={doc} readOnly={!editable} tests={tests} validation={live}
          onChange={(d) => { setDoc(d); setDirty(true); }} onTestsChange={(t) => { setTests(t); setDirty(true); }} />
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text-secondary)]">No scoring rules yet. Copy a template or start with blank rules.</p>
      )}

      <Panel title="Save">
        <div className="flex flex-wrap items-center gap-3">
          <Btn kind="primary" disabled={!editable || !doc || !dirty || busy !== null} onClick={save}>{busy === "save" ? "Saving…" : "Save scoring"}</Btn>
          {dirty && <span className="text-sm text-[var(--cmp-text-warning)]">Unsaved scoring changes</span>}
        </div>
        {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        {server && (
          <div className="mt-3 space-y-2">
            <Notice tone={server.errors.length ? "error" : "success"}>Server check: {server.errors.length} problem{server.errors.length === 1 ? "" : "s"}, {server.warnings.length} warning{server.warnings.length === 1 ? "" : "s"}{server.tests ? `, ${server.tests.passed} test${server.tests.passed === 1 ? "" : "s"} pass` : ""}.</Notice>
            <IssueList issues={server.errors} tone="error" />
            <IssueList issues={server.warnings} tone="warning" />
          </div>
        )}
      </Panel>
    </div>
  );
}
