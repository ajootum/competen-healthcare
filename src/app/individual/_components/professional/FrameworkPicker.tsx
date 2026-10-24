"use client";

import { useState } from "react";
import { Field, inputCls } from "./forms";

// Optional link to a competency in a SHARED framework (frameworks.hospital_id null). The framework list is
// rendered by the server from the shared frameworks only. Competencies are fetched from the Professional
// frameworks route, which refuses any framework that is not shared.

export type FrameworkOption = { id: string; name: string };

export default function FrameworkPicker({ frameworks, idPrefix }: { frameworks: FrameworkOption[] | null; idPrefix: string }) {
  const [fw, setFw] = useState("");
  const [comps, setComps] = useState<{ id: string; name: string; domain: string }[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  if (frameworks === null) return <p className="text-[13px] text-amber-900">The shared frameworks could not be read just now. You can still save this without one.</p>;
  // Empty is the default: Professional offers only the frameworks HQ allowlists (S1). Not "none exist".
  if (frameworks.length === 0) return <p className="text-[13px] text-gray-600">Competen Professional does not offer a competency framework yet. This works without one.</p>;

  async function choose(id: string) {
    setFw(id); setComps(null);
    if (!id) { setState("idle"); return; }
    setState("loading");
    try {
      const res = await fetch(`/api/individual/professional/frameworks?framework=${encodeURIComponent(id)}`);
      const j = await res.json();
      if (!res.ok) { setState("error"); return; }
      setComps(j.competencies ?? []); setState("idle");
    } catch { setState("error"); }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Framework (optional)" htmlFor={`${idPrefix}-fw`} hint="A shared Competen framework.">
        <select id={`${idPrefix}-fw`} name="frameworkId" value={fw} onChange={e => choose(e.target.value)} className={inputCls}>
          <option value="">None</option>
          {frameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Field>
      <Field label="Competency (optional)" htmlFor={`${idPrefix}-comp`}>
        <select id={`${idPrefix}-comp`} name="frameworkCompetencyId" disabled={!fw || !comps} className={inputCls} defaultValue="">
          <option value="">{!fw ? "Choose a framework first" : state === "loading" ? "Loading…" : state === "error" ? "Could not load competencies" : "Whole framework"}</option>
          {(comps ?? []).map(c => <option key={c.id} value={c.id}>{c.domain} · {c.name}</option>)}
        </select>
      </Field>
    </div>
  );
}
