"use client";
// Checklist Studio, Settings & Review tab: purpose, methods, delivery modes, respondent roles, capabilities, evidence policy, tags,
// then the validation report, the lifecycle (submit, review decisions, approval, publish, retire) with the independence refusals.
import { useState } from "react";
import { Btn, Check, SelectIn, TextIn } from "@/components/assessment/ui";
import { DELIVERY_MODE_SUGGESTIONS, MODE_PATTERN, RESPONDENT_ROLES, RESPONDENT_ROLE_LABEL } from "@/lib/assessment/studio/vocab";
import { CAP } from "@/lib/assessment/studio/transitions";
import type { InstrumentVersionRow, ValidationReport } from "@/lib/assessment/studio/types";
import type { TermOption } from "./ItemEditor";
import { IssueList, Notice, Panel, callApi, useAction } from "./studio-ui";

export interface SettingsTabProps {
  version: Pick<InstrumentVersionRow, "id" | "title" | "summary" | "purpose_code" | "method_codes" | "requires_domain_review" | "assess_capability" | "assign_capability" | "respondent_roles" | "delivery_modes" | "evidence_policy" | "effective_from" | "review_due">;
  tagTermIds: string[];
  terms: TermOption[];
  purposes: { code: string; label: string; publishable: boolean }[];
  methods: { code: string; label: string }[];
  editable: boolean;
  canValidate: boolean;
  report: ValidationReport;
}

export function SettingsTab({ version: v, tagTermIds, terms, purposes, methods, editable, canValidate, report: initial }: SettingsTabProps) {
  const [title, setTitle] = useState(v.title ?? "");
  const [summary, setSummary] = useState(v.summary ?? "");
  const [purpose, setPurpose] = useState(v.purpose_code);
  const [meths, setMeths] = useState<string[]>(v.method_codes);
  const [modes, setModes] = useState<string[]>(v.delivery_modes);
  const [custom, setCustom] = useState("");
  const [roles, setRoles] = useState<string[]>(v.respondent_roles);
  const [domain, setDomain] = useState(v.requires_domain_review);
  const [assess, setAssess] = useState(v.assess_capability ?? "");
  const [assign, setAssign] = useState(v.assign_capability ?? "");
  const [evidence, setEvidence] = useState(JSON.stringify(v.evidence_policy ?? {}, null, 2));
  const [from, setFrom] = useState(v.effective_from ?? "");
  const [due, setDue] = useState(v.review_due ?? "");
  const [tags, setTags] = useState<string[]>(tagTermIds);
  const [report, setReport] = useState(initial);
  const { busy, msg, run } = useAction();
  const toggle = (list: string[], set: (x: string[]) => void, x: string) => set(list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  let evidenceObj: Record<string, unknown> | null = null;
  try { const p = JSON.parse(evidence || "{}"); evidenceObj = p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch { evidenceObj = null; }
  const customOk = custom === "" || MODE_PATTERN.test(custom);
  const allModes = [...modes, ...(custom && customOk && !modes.includes(custom) ? [custom] : [])];
  const problem = !purpose ? "Choose a purpose." : roles.length === 0 ? "Choose at least one respondent role." : !evidenceObj ? "The evidence policy must be a JSON object." : !customOk ? "A custom mode is lower case letters and underscores only." : null;
  const groups = [...new Set(terms.map((t) => t.group))];

  const save = () => run("save", () => callApi(`/api/hq/checklist-studio/versions/${v.id}/settings`, "PUT", {
    settings: {
      title: title || null, summary: summary || null, purpose_code: purpose, method_codes: meths, requires_domain_review: domain, assess_capability: assess || null,
      assign_capability: assign || null, respondent_roles: roles, delivery_modes: allModes, evidence_policy: evidenceObj, effective_from: from || null, review_due: due || null,
    }, tags,
  }), { ok: "Settings saved.", onOk: () => { setModes(allModes); setCustom(""); } });
  const validate = () => run("validate", () => callApi<{ report: ValidationReport }>(`/api/hq/checklist-studio/versions/${v.id}/validate`, "POST", { record: true }), { ok: "Validation recorded in the history.", onOk: (d) => setReport(d.report) });

  return (
    <div className="space-y-4">
      {!editable && <Notice>Settings can be changed only on a draft, by a person who holds the author capability.</Notice>}
      <Panel title="Settings">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextIn label="Title shown to the person answering" value={title} disabled={!editable} onChange={setTitle} />
            <SelectIn label="Purpose" value={purpose} disabled={!editable} onChange={setPurpose} options={purposes.map((p) => ({ value: p.code, label: p.publishable ? p.label : `${p.label} (cannot be published)` }))} />
          </div>
          <TextIn label="Summary" value={summary} disabled={!editable} onChange={setSummary} />
          <fieldset><legend className="mb-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Assessment methods</legend>
            <div className="flex flex-wrap gap-x-4">{methods.map((m) => <Check key={m.code} label={m.label} checked={meths.includes(m.code)} disabled={!editable} onChange={() => toggle(meths, setMeths, m.code)} />)}</div></fieldset>
          <fieldset><legend className="mb-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Delivery modes (at least one before it can be put forward)</legend>
            <div className="flex flex-wrap gap-x-4">
              {[...DELIVERY_MODE_SUGGESTIONS.map((m) => m), ...modes.filter((m) => !DELIVERY_MODE_SUGGESTIONS.some((s) => s.code === m)).map((m) => ({ code: m, label: m }))].map((m) => (
                <Check key={m.code} label={m.label} checked={modes.includes(m.code)} disabled={!editable} onChange={() => toggle(modes, setModes, m.code)} />
              ))}
            </div>
            <TextIn label="Another mode (optional)" value={custom} disabled={!editable} onChange={setCustom} placeholder="for example peer_review" />
          </fieldset>
          <fieldset><legend className="mb-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Respondent roles</legend>
            <div className="flex flex-wrap gap-x-4">{RESPONDENT_ROLES.map((r) => <Check key={r} label={RESPONDENT_ROLE_LABEL[r]} checked={roles.includes(r)} disabled={!editable} onChange={() => toggle(roles, setRoles, r)} />)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectIn label="Capability needed to assess" value={assess} disabled={!editable} onChange={setAssess} options={[{ value: "", label: "The default assessment capability" }, { value: CAP.assess, label: CAP.assess }]} />
            <SelectIn label="Capability needed to assign an assessor" value={assign} disabled={!editable} onChange={setAssign} options={[{ value: "", label: "The default assignment capability" }, { value: CAP.assign, label: CAP.assign }]} />
          </div>
          <Check label="Requires a domain review before approval" checked={domain} disabled={!editable} onChange={setDomain} hint="A second, independent review by someone who holds the domain review right" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Effective from<input type="date" value={from} disabled={!editable} onChange={(e) => setFrom(e.target.value)} className="min-h-9 rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-2 text-sm text-[var(--cmp-app-text)]" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Review due<input type="date" value={due} disabled={!editable} onChange={(e) => setDue(e.target.value)} className="min-h-9 rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-2 text-sm text-[var(--cmp-app-text)]" /></label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Evidence policy (JSON, advanced)
            <textarea value={evidence} disabled={!editable} rows={3} onChange={(e) => setEvidence(e.target.value)} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 font-mono text-xs text-[var(--cmp-app-text)]" />
          </label>
          {terms.length > 0 && (
            <fieldset className="space-y-2"><legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Tags (who and what it is for)</legend>
              {groups.map((g) => (
                <div key={g}><p className="text-xs font-bold text-[var(--cmp-app-text-secondary)]">{g}</p>
                  <div className="flex flex-wrap gap-x-4">{terms.filter((t) => t.group === g).map((t) => <Check key={t.id} label={t.label} checked={tags.includes(t.id)} disabled={!editable} onChange={() => toggle(tags, setTags, t.id)} />)}</div></div>
              ))}
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Btn kind="primary" disabled={!editable || busy !== null || problem !== null} onClick={save}>{busy === "save" ? "Saving…" : "Save settings"}</Btn>
            {problem && <span className="text-sm text-[var(--cmp-app-text-secondary)]">{problem}</span>}
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </div>
      </Panel>

      <Panel title="Validation report" right={<Btn size="sm" disabled={!canValidate || busy !== null} onClick={validate}>{busy === "validate" ? "Checking…" : "Validate and record"}</Btn>}>
        <Notice tone={report.ok ? "success" : "error"}>{report.ok ? "No problems on the saved version." : `${report.errors.length} problem${report.errors.length === 1 ? "" : "s"} on the saved version.`}{report.tests ? ` ${report.tests.passed} saved test${report.tests.passed === 1 ? "" : "s"} pass${report.tests.failed ? `, ${report.tests.failed} fail` : ""}.` : ""}</Notice>
        <div className="mt-2 space-y-2"><IssueList issues={report.errors} tone="error" /><IssueList issues={report.warnings} tone="warning" /></div>
        <p className="mt-2 text-xs text-[var(--cmp-app-text-secondary)]">The report covers the SAVED content, scoring, tests, layouts and settings. Recording it adds a validation event to the history.</p>
      </Panel>
    </div>
  );
}
