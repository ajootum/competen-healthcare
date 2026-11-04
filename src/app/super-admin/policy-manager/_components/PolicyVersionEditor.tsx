"use client";
// Governed policies: the editor of one version. Editable only while the version is a draft and the viewer holds the author capability.
// The text is plain text; Markdown-style headings and lists are kept as typed. The database refuses an edit to anything but a draft.
import { useEffect, useMemo, useState } from "react";
import { Btn, Labelled, TextIn, fieldBase, touchSm } from "@/components/assessment/ui";
import { Notice, Panel, callApi, useAction } from "@/app/super-admin/checklist-studio/_components/studio-ui";

export interface PolicyDraft { title: string; summary: string; content: string; effectiveFrom: string; reviewDue: string }

export function PolicyVersionEditor({ versionId, initial, editable, whyNot }: { versionId: string; initial: PolicyDraft; editable: boolean; whyNot?: string }) {
  const [saved, setSaved] = useState<PolicyDraft>(initial);
  const [draft, setDraft] = useState<PolicyDraft>(initial);
  const { busy, msg, run } = useAction();
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () => run("save", () => callApi(`/api/hq/policies/versions/${versionId}`, "PUT", {
    title: draft.title, summary: draft.summary, content: draft.content, effectiveFrom: draft.effectiveFrom, reviewDue: draft.reviewDue,
  }), { ok: "Saved.", onOk: () => setSaved(draft) });

  return (
    <Panel
      title="Policy text"
      right={(
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-sm font-semibold text-[var(--cmp-text-warning)]" role="status">Unsaved changes</span>}
          {dirty && <Btn size="sm" onClick={() => setDraft(saved)} disabled={busy !== null}>Discard changes</Btn>}
          <Btn kind="primary" disabled={!editable || !dirty || busy !== null} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</Btn>
        </div>
      )}
    >
      <div className="space-y-3">
        {!editable && <Notice>{whyNot ?? "This version cannot be edited."}</Notice>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <TextIn label="Title" value={draft.title} onChange={(v) => set("title", v)} disabled={!editable} />
        <TextIn label="Summary" value={draft.summary} onChange={(v) => set("summary", v)} disabled={!editable} hint="One or two sentences that say what the policy is for." />
        <Labelled label="Text" hint="Plain text. Markdown-style headings (#) and lists (-) are kept as typed.">
          <textarea value={draft.content} onChange={(e) => set("content", e.target.value)} disabled={!editable} rows={18} spellCheck className={`${fieldBase} font-mono leading-relaxed`} />
        </Labelled>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labelled label="Effective from" hint="Leave empty to apply from publication.">
            <input type="date" value={draft.effectiveFrom} disabled={!editable} onChange={(e) => set("effectiveFrom", e.target.value)} className={`${fieldBase} ${touchSm}`} />
          </Labelled>
          <Labelled label="Review due">
            <input type="date" value={draft.reviewDue} disabled={!editable} onChange={(e) => set("reviewDue", e.target.value)} className={`${fieldBase} ${touchSm}`} />
          </Labelled>
        </div>
      </div>
    </Panel>
  );
}
