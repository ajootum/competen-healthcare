"use client";
// Governed policies: "New governed policy" -- a small dialog. The server makes the policy and its first draft (the code is assigned by the
// database), then this page opens the draft for editing.
import { useState } from "react";
import { Btn, Labelled, SelectIn, TextIn, fieldBase } from "@/components/assessment/ui";
import { DefModal } from "@/app/super-admin/checklist-studio/_components/DefShared";
import { Notice, callApi, useAction } from "@/app/super-admin/checklist-studio/_components/studio-ui";
import { POLICY_SCOPES, POLICY_SCOPE_LABEL, POLICY_TYPES, POLICY_TYPE_LABEL } from "../policy-options";

export function NewPolicyDialog({ canAuthor }: { canAuthor: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [policyType, setPolicyType] = useState<string>(POLICY_TYPES[0]);
  const [scope, setScope] = useState<string>("holdings");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const { busy, msg, run, router } = useAction();
  const valid = title.trim().length >= 3;

  const save = () => run("create", () => callApi<{ policyId: string; versionId: string }>("/api/hq/policies", "POST", {
    title: title.trim(), policyType, scope, description, content,
  }), { refresh: false, onOk: (d) => router.push(`/super-admin/policy-manager/${d.policyId}/v/${d.versionId}`) });

  return (
    <>
      <div>
        <Btn kind="primary" disabled={!canAuthor} onClick={() => setOpen(true)}>New governed policy</Btn>
        {!canAuthor && <span className="mt-1 block max-w-xs text-xs text-[var(--cmp-app-text-secondary)]">Creating a policy needs the policy author capability, held through an appointment.</span>}
      </div>
      {open && (
        <DefModal title="New governed policy" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <TextIn label="Title" value={title} onChange={setTitle} hint="At least three characters." />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectIn label="Type" value={policyType} onChange={setPolicyType} options={POLICY_TYPES.map((t) => ({ value: t, label: POLICY_TYPE_LABEL[t] }))} />
              <SelectIn label="Scope" value={scope} onChange={setScope} options={POLICY_SCOPES.map((s) => ({ value: s, label: POLICY_SCOPE_LABEL[s] }))} />
            </div>
            <Labelled label="Description (optional)">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={fieldBase} />
            </Labelled>
            <Labelled label="First text (optional)" hint="You can write and revise the full text on the next page.">
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} className={`${fieldBase} font-mono`} />
            </Labelled>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setOpen(false)} disabled={busy !== null}>Cancel</Btn>
              <Btn kind="primary" disabled={!valid || busy !== null} onClick={save}>{busy === "create" ? "Creating…" : "Create draft"}</Btn>
            </div>
          </div>
        </DefModal>
      )}
    </>
  );
}
