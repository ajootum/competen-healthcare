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
import { STARTERS } from "@/lib/assessment/studio/starters";
import { acceptProposedRules, isProposedRules } from "@/lib/assessment/import/scoring";
import type { ProposalRecord } from "@/lib/assessment/import/propose";
import type { ProfileId } from "@/lib/assessment/import/profiles";
import { ScoringEvaluationPanel } from "./ScoringEvaluationPanel";
import { IssueList, Notice, Panel, callApi, useAction } from "./studio-ui";

export interface RuleTemplateOption { id: string; label: string }

const hasRules = (d: unknown): d is RulesDoc => !!d && typeof d === "object" && Array.isArray((d as RulesDoc).outcomes);

export function ScoringTab({ versionId, versionNo, instrumentCode, content, contentDirty, initialScoring, initialTests, templates, templateId, editable, importId = null, proposal = null }: {
  versionId: string; versionNo: number; instrumentCode: string; content: EditorContent; contentDirty: boolean;
  initialScoring: Record<string, unknown>; initialTests: unknown[]; templates: RuleTemplateOption[]; templateId: string | null; editable: boolean;
  /** the import this draft came from, when it was imported: enables the proposal from the source workbook */
  importId?: string | null;
  /** the latest recorded proposal (its flags), shown while the rules still carry the proposal mark */
  proposal?: ProposalRecord | null;
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
  // Owner GO 3 Nov 2026: the deterministic proposal from the stored source workbook, for a draft imported earlier.
  const propose = () => run("propose", () => callApi<{ flags: { message: string }[] }>(url, "POST", { action: "propose_from_workbook" }),
    { ok: "Scoring was proposed from the source workbook. Read the flags, then accept or change the rules.", onOk: () => router.refresh() });
  const applyProfile = (profileId: ProfileId) => run("profile", () => callApi<{ flags: { message: string }[] }>(url, "POST", { action: "apply_profile", profileId }),
    { ok: "The profile was applied to this draft: content settings, rules and tests. Read the flags, then accept or change the rules.", onOk: () => router.refresh() });
  const proposed = isProposedRules(doc);
  const accept = () => { if (!doc) return; setDoc(acceptProposedRules(doc)); setDirty(true); };
  const starterFit = (unfit: string | null) => unfit === null;

  return (
    <div className="space-y-4">
      {!editable && <Notice>Scoring can be changed only on a draft, by a person who holds the author capability.</Notice>}
      {contentDirty && <Notice tone="warning">The content has unsaved changes. The builder uses them, but the server checks the saved content. Save the content first.</Notice>}
      <ScoringEvaluationPanel def={def} doc={doc} tests={tests} live={live} editable={editable} busy={busy !== null} onApply={applyProfile} />
      {proposed && doc && (
        <Panel title="Proposed from the source workbook: review before submitting">
          <p className="text-sm">These rules and their saved tests were proposed by the importer from what the sheet holds. Nothing was inferred silently: every assumption is listed. Accept them as your own rules, change them in the builder below, or start again from a starter.</p>
          {proposal && proposal.flags.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {proposal.flags.map((f, i) => <li key={i} className={f.severity === "warn" ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-app-text-secondary)]"}>{f.message}</li>)}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn kind="primary" disabled={!editable || busy !== null} onClick={accept}>Accept as my rules</Btn>
            {importId && <Btn disabled={!editable || busy !== null} onClick={() => { if (window.confirm("Replace the current rules with a fresh proposal from the source workbook?")) void propose(); }}>{busy === "propose" ? "Proposing…" : "Propose again from the workbook"}</Btn>}
            <span className="text-xs text-[var(--cmp-app-text-secondary)]">Accepting removes the proposal mark; save the scoring afterwards.</span>
          </div>
        </Panel>
      )}
      <Panel title="Starter rule sets">
        <p className="text-xs text-[var(--cmp-app-text-secondary)]">Copied into this draft as your own editable rules: no published template is needed. The draft still goes through independent review and publication.</p>
        <ul className="mt-2 grid gap-2 md:grid-cols-3">
          {STARTERS.map((s) => {
            const unfit = s.unfit(def);
            return (
              <li key={s.id} className="rounded-lg border border-[var(--cmp-app-border)] p-3">
                <p className="text-sm font-semibold">{s.label}</p>
                <p className="mt-1 text-xs text-[var(--cmp-app-text-secondary)]">{s.summary}</p>
                {unfit && <p className="mt-1 text-xs text-[var(--cmp-text-warning)]">{unfit}</p>}
                <Btn size="sm" className="mt-2" disabled={!editable || !starterFit(unfit) || busy !== null} onClick={() => { if (!doc || window.confirm("Replace the current rules with this starter?")) { setDoc(s.build(def)); setDirty(true); } }}>Use this starter</Btn>
              </li>
            );
          })}
        </ul>
        {importId && !proposed && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn disabled={!editable || busy !== null} onClick={() => { if (!doc || window.confirm("Replace the current rules with the proposal from the source workbook?")) void propose(); }}>{busy === "propose" ? "Proposing…" : "Propose scoring from the source workbook"}</Btn>
            <span className="text-xs text-[var(--cmp-app-text-secondary)]">Deterministic, from the stored workbook this draft was imported from. Every assumption comes back as a flag.</span>
          </div>
        )}
      </Panel>
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
