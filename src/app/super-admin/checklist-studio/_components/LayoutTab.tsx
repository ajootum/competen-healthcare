"use client";
// Checklist Studio, Design & Layout tab. A checklist points at PUBLISHED layout template versions: one default and any number of allowed
// ones. An instance pins the layout it started with, so a layout can never change under a person mid-assessment. A layout is drawn from a
// closed vocabulary and can neither hide nor reorder an item. To make a new layout, design a layout template and publish it.
import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutDesigner } from "@/components/assessment";
import { Btn, Check, Chip } from "@/components/assessment/ui";
import { STANDARD_CHECKLIST_LAYOUT, type LayoutDoc } from "@/lib/assessment/core";
import { toDefinition } from "@/lib/assessment/studio/assemble";
import type { EditorContent } from "@/lib/assessment/studio/types";
import { Notice, Panel, callApi, linkBtn, useAction } from "./studio-ui";

export interface LayoutOption { id: string; name: string; presentation: string; layout: Record<string, unknown> }

export function LayoutTab({ versionId, versionNo, instrumentCode, content, layouts, defaultId, allowedIds, editable }: {
  versionId: string; versionNo: number; instrumentCode: string; content: EditorContent; layouts: LayoutOption[]; defaultId: string | null; allowedIds: string[]; editable: boolean;
}) {
  const [def, setDef] = useState<string | null>(defaultId);
  const [allowed, setAllowed] = useState<string[]>(allowedIds);
  const [dirty, setDirty] = useState(false);
  const [look, setLook] = useState<string | null>(defaultId ?? layouts[0]?.id ?? null);
  const { busy, msg, run } = useAction();
  const definition = useMemo(() => toDefinition(content, { instrumentCode, versionNo }), [content, instrumentCode, versionNo]);
  const shown = layouts.find((l) => l.id === look);
  const toggle = (id: string) => { setAllowed((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id])); setDirty(true); };
  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/versions/${versionId}/layouts`, "PUT", { defaultLayoutVersionId: def, allowed }), { ok: "Layouts saved.", onOk: () => setDirty(false) });

  return (
    <div className="space-y-4">
      {!editable && <Notice>Layouts can be changed only on a draft, by a person who holds the author capability.</Notice>}
      <Panel title="Layouts this checklist can be answered in" right={<Link href="/super-admin/checklist-studio/layout-templates" className={linkBtn}>Design a layout template</Link>}>
        {layouts.length === 0 ? (
          <p className="text-sm text-[var(--cmp-app-text-secondary)]">No layout template is published yet. Without one, the built-in standard checklist layout is used. Design and publish a layout template to offer others.</p>
        ) : (
          <ul className="space-y-2">
            {layouts.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cmp-app-border)] p-2">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex min-h-9 items-center gap-2 text-sm font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)]">
                    <input type="radio" name="default-layout" checked={def === l.id} disabled={!editable} onChange={() => { setDef(l.id); setDirty(true); }} className="h-5 w-5 accent-[var(--cmp-theme-accent)]" />
                    Default
                  </label>
                  <Check label="Also allow" checked={allowed.includes(l.id)} disabled={!editable || def === l.id} onChange={() => toggle(l.id)} />
                  <span className="text-sm">{l.name}</span>
                  <Chip>{l.presentation.replace(/_/g, " ")}</Chip>
                </div>
                <Btn size="sm" onClick={() => setLook(l.id)}>Preview</Btn>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Btn kind="primary" disabled={!editable || !dirty || busy !== null} onClick={save}>{busy === "save" ? "Saving…" : "Save layouts"}</Btn>
          {def && <Btn size="sm" disabled={!editable} onClick={() => { setDef(null); setDirty(true); }}>Use the built-in layout</Btn>}
          {dirty && <span className="text-sm text-[var(--cmp-text-warning)]">Unsaved layout changes</span>}
        </div>
        {msg && <div className="mt-2"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      </Panel>
      <Panel title={`Preview of ${shown?.name ?? "the built-in standard checklist layout"} on this checklist`}>
        <LayoutDesigner layout={(shown?.layout as unknown as LayoutDoc) ?? STANDARD_CHECKLIST_LAYOUT} def={definition} readOnly onChange={() => {}} forPublication />
      </Panel>
    </div>
  );
}
