"use client";
// Checklist Studio: one checklist version, four tabs (Content, Scoring & Rules, Design & Layout, Settings & Review) and a Preview.
// The content is held here so every tab and the preview see the same, even unsaved, state. Only a draft, edited by a person holding the
// author capability, is editable. Saving writes only what changed and names the editor.
import { useEffect, useMemo, useState } from "react";
import { Btn } from "@/components/assessment/ui";
import { ContentTab } from "./ContentTab";
import { normalizeContent } from "@/lib/assessment/studio/assemble";
import { LayoutTab, type LayoutOption } from "./LayoutTab";
import { LifecyclePanel, type LifecyclePanelProps } from "./LifecyclePanel";
import { PreviewPanel } from "./PreviewPanel";
import { ScoringTab, type RuleTemplateOption } from "./ScoringTab";
import { SettingsTab, type SettingsTabProps } from "./SettingsTab";
import { DefTimeline } from "./DefShared";
import type { TermOption } from "./ItemEditor";
import { Notice, Panel, StateChip, callApi, useAction } from "./studio-ui";
import type { ScaleChoice } from "@/lib/assessment/studio/read";
import type { EditorContent, LifecycleState, TimelineEntry, ValidationReport } from "@/lib/assessment/studio/types";

const TABS = [
  { id: "content", label: "Content" },
  { id: "scoring", label: "Scoring & Rules" },
  { id: "layout", label: "Design & Layout" },
  { id: "settings", label: "Settings & Review" },
  { id: "preview", label: "Preview" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export interface VersionWorkspaceProps {
  versionId: string;
  instrument: { id: string; code: string; name: string };
  versionNo: number;
  state: LifecycleState;
  content: EditorContent;
  canEdit: boolean;
  canPick: boolean;
  methods: { code: string; label: string }[];
  scaleChoices: ScaleChoice[];
  terms: TermOption[];
  drift: Record<string, string[]>;
  ruleTemplates: RuleTemplateOption[];
  scoring: Record<string, unknown>;
  scoringTests: unknown[];
  scoringTemplateId: string | null;
  scoringHash: string | null;
  layouts: LayoutOption[];
  defaultLayoutId: string | null;
  allowedLayoutIds: string[];
  settings: SettingsTabProps;
  report: ValidationReport;
  lifecycle: Omit<LifecyclePanelProps, "kind" | "versionId" | "versionNo" | "state" | "versionHrefBase" | "listHref" | "report">;
  timeline: TimelineEntry[];
  title: string;
}

export function VersionWorkspace(p: VersionWorkspaceProps) {
  const [tab, setTab] = useState<TabId>("content");
  const [content, setContent] = useState<EditorContent>(() => normalizeContent(p.content));
  const [saved, setSaved] = useState<EditorContent>(() => normalizeContent(p.content));
  const { busy, msg, run } = useAction();
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(saved), [content, saved]);
  const base = `/super-admin/checklist-studio/${p.instrument.id}/v`;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/versions/${p.versionId}/content`, "PUT", { content }), { ok: "Content saved.", onOk: () => setSaved(content) });
  // The prefill call wrote the groups itself, so they go into both the editor copy and the saved copy: not an unsaved change.
  const prefilled = (groups: EditorContent["groups"]) => {
    const merge = (c: EditorContent) => normalizeContent({ ...c, groups: [...c.groups, ...groups.filter((g) => !c.groups.some((x) => x.code === g.code))] });
    setContent(merge);
    setSaved(merge);
  };
  const defaultLayout = p.layouts.find((l) => l.id === p.defaultLayoutId)?.layout ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{p.instrument.code}</span>
          <span className="text-sm">{p.instrument.name}</span>
          <span className="text-sm text-[var(--cmp-app-text-secondary)]">version {p.versionNo}</span>
          <StateChip state={p.state} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-sm font-semibold text-[var(--cmp-text-warning)]" role="status">Unsaved content changes</span>}
          {dirty && <Btn size="sm" onClick={() => setContent(saved)} disabled={busy !== null}>Discard changes</Btn>}
          <Btn kind="primary" disabled={!p.canEdit || !dirty || busy !== null} onClick={save}>{busy === "save" ? "Saving…" : "Save content"}</Btn>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div role="tablist" aria-label="Checklist sections" className="flex flex-wrap gap-1 border-b border-[var(--cmp-app-border)]">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} type="button" onClick={() => setTab(t.id)}
            className={`min-h-10 rounded-t-lg border border-b-0 px-4 text-sm font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cmp-theme-accent)] ${tab === t.id ? "border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] text-[var(--cmp-theme-ink)]" : "border-transparent text-[var(--cmp-app-text-secondary)] hover:bg-[var(--cmp-app-surface)]"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "content" && <ContentTab versionId={p.versionId} onGroupsPrefilled={prefilled} content={content} setContent={setContent} disabled={!p.canEdit} methods={p.methods} scaleChoices={p.scaleChoices} terms={p.terms} drift={p.drift} canPick={p.canPick} />}
        {tab === "scoring" && (
          <ScoringTab key={p.scoringHash ?? "none"} versionId={p.versionId} versionNo={p.versionNo} instrumentCode={p.instrument.code} content={content} contentDirty={dirty}
            initialScoring={p.scoring} initialTests={p.scoringTests} templates={p.ruleTemplates} templateId={p.scoringTemplateId} editable={p.canEdit} />
        )}
        {tab === "layout" && (
          <LayoutTab versionId={p.versionId} versionNo={p.versionNo} instrumentCode={p.instrument.code} content={content} layouts={p.layouts} defaultId={p.defaultLayoutId} allowedIds={p.allowedLayoutIds} editable={p.canEdit} />
        )}
        {tab === "settings" && (
          <div className="space-y-4">
            <SettingsTab {...p.settings} />
            <LifecyclePanel
              {...p.lifecycle} kind="instrument" versionId={p.versionId} versionNo={p.versionNo} state={p.state} report={p.report}
              versionHrefBase={base} listHref={`/super-admin/checklist-studio/${p.instrument.id}`}
            />
            <Panel title="History of this version"><DefTimeline timeline={p.timeline} names={p.lifecycle.names} /></Panel>
          </div>
        )}
        {tab === "preview" && <PreviewPanel content={content} versionNo={p.versionNo} instrumentCode={p.instrument.code} title={p.title} scoring={p.scoring} layout={defaultLayout} />}
      </div>
    </div>
  );
}
