"use client";
// Checklist Studio, Content tab: "Prefill groups from framework components". The ONLY competency-specific control on the tab, with the
// criterion picker. The server adds a group for each active assessment component through the adapter (asmt_scholar_prefill_groups).
// The groups are written by that call, so the editor shows them as saved, not as an unsaved change.
import { Btn } from "@/components/assessment/ui";
import type { PrefilledGroup } from "@/lib/assessment/adapters/scholar/groups";
import { callApi, useAction } from "./studio-ui";

export function PrefillGroups({ versionId, disabled, hasGroups, onAdded }: { versionId: string; disabled: boolean; hasGroups: boolean; onAdded: (groups: PrefilledGroup[]) => void }) {
  const { busy, msg, run } = useAction();
  const go = () => run("prefill", () => callApi<{ added: number; groups: PrefilledGroup[] }>(`/api/hq/checklist-studio/versions/${versionId}/prefill-groups`, "POST"), {
    refresh: false,
    ok: "Groups added from the framework components.",
    onOk: (d) => onAdded(d.groups),
  });
  return (
    <>
      <Btn size="sm" disabled={disabled || hasGroups || busy !== null} onClick={go} title={hasGroups ? "This version already has groups." : undefined}>
        {busy ? "Adding…" : "Prefill groups from framework components"}
      </Btn>
      {msg && <span role={msg.tone === "error" ? "alert" : "status"} className={`text-xs ${msg.tone === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-app-text-secondary)]"}`}>{msg.text}</span>}
    </>
  );
}
