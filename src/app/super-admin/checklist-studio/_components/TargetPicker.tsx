"use client";
// Checklist Studio: what a new progression rule set places people against. Fixed at creation (the database makes it permanent).
// Two kinds: a Checklist instrument from the Studio library, or a Competency picked through the adapter (the same framework read as
// the criterion picker). This is the second place the Studio screens know about frameworks, and it reaches them only through the API.
import { useEffect, useState } from "react";
import { SelectIn } from "@/components/assessment/ui";
import type { CriterionTree, FrameworkOption } from "@/lib/assessment/adapters/scholar/criteria";
import { TARGET_KIND_COMPETENCY, TARGET_KIND_INSTRUMENT, TARGET_KIND_LABEL } from "@/lib/assessment/adapters/scholar/targets";
import { Notice, callApi } from "./studio-ui";

export interface TargetValue { kind: string; ref: string }
export interface InstrumentOption { id: string; label: string }

export function TargetPicker({ instruments, value, onChange }: { instruments: InstrumentOption[]; value: TargetValue; onChange: (v: TargetValue) => void }) {
  const [frameworks, setFrameworks] = useState<FrameworkOption[] | null>(null);
  const [code, setCode] = useState("");
  const [tree, setTree] = useState<CriterionTree | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const competency = value.kind === TARGET_KIND_COMPETENCY;

  useEffect(() => {
    if (!competency || frameworks) return;
    let live = true;
    void callApi<{ frameworks: FrameworkOption[] }>("/api/hq/checklist-studio/criteria", "GET").then((r) => { if (!live) return; if (r.ok) setFrameworks(r.data.frameworks); else setError(r.error); });
    return () => { live = false; };
  }, [competency, frameworks]);

  const chooseFramework = (c: string) => {
    setCode(c); setTree(undefined); onChange({ kind: value.kind, ref: "" });
    if (!c) return;
    void callApi<{ tree: CriterionTree | null }>(`/api/hq/checklist-studio/criteria?framework=${encodeURIComponent(c)}`, "GET").then((r) => { if (r.ok) setTree(r.data.tree); else setError(r.error); });
  };
  const competencies = tree ? tree.domains.flatMap((d) => d.competencies.map((c) => ({ value: c.id, label: `${d.name}: ${c.name}${c.code ? ` (${c.code})` : ""}` }))) : [];

  return (
    <div className="space-y-3">
      <SelectIn label="Places people against" value={value.kind} onChange={(k) => { setCode(""); setTree(undefined); onChange({ kind: k, ref: "" }); }}
        options={[{ value: TARGET_KIND_INSTRUMENT, label: TARGET_KIND_LABEL[TARGET_KIND_INSTRUMENT] }, { value: TARGET_KIND_COMPETENCY, label: TARGET_KIND_LABEL[TARGET_KIND_COMPETENCY] }]}
        hint="Fixed when the rule set is created. A rule set with another target is a new rule set." />
      {error && <Notice tone="error">{error}</Notice>}
      {!competency && (
        <SelectIn label="Checklist instrument" value={value.ref} onChange={(ref) => onChange({ kind: value.kind, ref })}
          options={[{ value: "", label: instruments.length ? "Choose a checklist from the library" : "The library has no checklist yet" }, ...instruments.map((i) => ({ value: i.id, label: i.label }))]} />
      )}
      {competency && (
        <>
          <SelectIn label="Framework" value={code} onChange={chooseFramework} options={[{ value: "", label: frameworks ? "Choose a framework" : "Loading…" }, ...(frameworks ?? []).map((f) => ({ value: f.code, label: `${f.code} ${f.version}, ${f.name} (${f.pubStatus})` }))]} />
          {code && tree === undefined && <p className="text-sm text-[var(--cmp-app-text-secondary)]">Loading competencies…</p>}
          {code && tree === null && <Notice>This framework has no competencies with criteria yet.</Notice>}
          {tree && <SelectIn label="Competency" value={value.ref} onChange={(ref) => onChange({ kind: value.kind, ref })} options={[{ value: "", label: "Choose a competency" }, ...competencies]} />}
        </>
      )}
    </div>
  );
}
