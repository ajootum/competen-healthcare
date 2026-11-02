"use client";
// Checklist Studio: the library table, its filters and the New instrument dialog.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Btn, Check, SelectIn, TextIn } from "@/components/assessment/ui";
import { DELIVERY_MODE_SUGGESTIONS, KIND_PATTERN, MODE_PATTERN, RESPONDENT_ROLES, RESPONDENT_ROLE_LABEL, fmtDate } from "@/lib/assessment/studio/vocab";
import { LIFECYCLE_STATES, STATE_LABEL, type LibraryRow } from "@/lib/assessment/studio/types";
import type { Registries } from "@/lib/assessment/studio/read";
import { DefModal } from "./DefShared";
import { Notice, StateChip, callApi, td, th, useAction } from "./studio-ui";

function NewInstrument({ registries, onClose }: { registries: Registries; onClose: () => void }) {
  const { busy, msg, run, router } = useAction();
  const publishable = registries.purposes.filter((p) => p.publishable);
  const [family, setFamily] = useState(registries.families[0]?.code ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("assessment");
  const [purpose, setPurpose] = useState(publishable[0]?.code ?? "");
  const [methods, setMethods] = useState<string[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [roles, setRoles] = useState<string[]>(["self"]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const customOk = custom === "" || MODE_PATTERN.test(custom);
  const problem = !family ? "Choose a family." : !name.trim() ? "Give the checklist a name." : !KIND_PATTERN.test(kind) ? "The kind is lower case letters, numbers and underscores." : !purpose ? "Choose a purpose." : roles.length === 0 ? "Choose at least one respondent role." : !customOk ? "A custom mode is lower case letters and underscores only." : null;

  const create = () => run("create", () => callApi<{ instrumentId: string; versionId: string }>("/api/hq/checklist-studio/instruments", "POST", {
    family, name, description, kind, purpose, methods, respondentRoles: roles, deliveryModes: [...modes, ...(custom && customOk ? [custom] : [])],
  }), { refresh: false, onOk: (d) => router.push(`/super-admin/checklist-studio/${d.instrumentId}/v/${d.versionId}`) });

  return (
    <DefModal title="New instrument" onClose={onClose}>
      <p className="text-sm text-[var(--cmp-app-text-secondary)]">This registers the instrument in the catalogue with its permanent code and starts version 1 as a draft. The family, kind and code cannot change afterwards.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectIn label="Family" value={family} onChange={setFamily} options={registries.families.length ? registries.families.map((f) => ({ value: f.code, label: `${f.code}, ${f.label}` })) : [{ value: "", label: "No family is configured" }]} />
        <TextIn label="Kind" value={kind} onChange={setKind} hint="A short word such as assessment or audit" />
      </div>
      <TextIn label="Name" value={name} onChange={setName} />
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-sm text-[var(--cmp-app-text)]" />
      </label>
      <SelectIn label="Purpose" value={purpose} onChange={setPurpose} options={publishable.map((p) => ({ value: p.code, label: p.label }))} hint="Only a purpose that can be published is offered" />
      <fieldset className="space-y-1"><legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Assessment methods</legend>
        <div className="flex flex-wrap gap-x-4">{registries.methods.map((m) => <Check key={m.code} label={m.label} checked={methods.includes(m.code)} onChange={() => toggle(methods, setMethods, m.code)} />)}
          {registries.methods.length === 0 && <span className="text-sm text-[var(--cmp-app-text-secondary)]">No methods are configured.</span>}</div>
      </fieldset>
      <fieldset className="space-y-1"><legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Who answers it</legend>
        <div className="flex flex-wrap gap-x-4">{RESPONDENT_ROLES.map((r) => <Check key={r} label={RESPONDENT_ROLE_LABEL[r]} checked={roles.includes(r)} onChange={() => toggle(roles, setRoles, r)} />)}</div>
      </fieldset>
      <fieldset className="space-y-1"><legend className="text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Delivery modes (needed before it can be put forward)</legend>
        <div className="flex flex-wrap gap-x-4">{DELIVERY_MODE_SUGGESTIONS.map((m) => <Check key={m.code} label={m.label} checked={modes.includes(m.code)} onChange={() => toggle(modes, setModes, m.code)} />)}</div>
        <TextIn label="Another mode (optional)" value={custom} onChange={setCustom} placeholder="for example peer_review" />
      </fieldset>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {problem && <p className="text-sm text-[var(--cmp-app-text-secondary)]">{problem}</p>}
      <div className="flex justify-end gap-2"><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" disabled={busy !== null || problem !== null} onClick={create}>{busy ? "Creating…" : "Create instrument"}</Btn></div>
    </DefModal>
  );
}

export function LibraryTable({ rows, registries, canAuthor }: { rows: LibraryRow[]; registries: Registries; canAuthor: boolean }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");
  const [state, setState] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (!needle || r.code.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle))
      && (!family || r.family_code === family) && (!state || (state === "none" ? r.latest_state === null : r.latest_state === state)));
  }, [rows, q, family, state]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
        <TextIn label="Search code or name" value={q} onChange={setQ} className="min-w-52 flex-1" />
        <SelectIn label="Family" value={family} onChange={setFamily} options={[{ value: "", label: "All families" }, ...registries.families.map((f) => ({ value: f.code, label: `${f.code}, ${f.label}` }))]} />
        <SelectIn label="Latest version" value={state} onChange={setState} options={[{ value: "", label: "Any state" }, ...LIFECYCLE_STATES.map((s) => ({ value: s, label: STATE_LABEL[s] })), { value: "none", label: "No version yet" }]} />
        <Btn kind="primary" disabled={!canAuthor} onClick={() => setOpen(true)}>New instrument</Btn>
      </div>
      {!canAuthor && <p className="text-sm text-[var(--cmp-app-text-secondary)]">Creating needs the author capability, held through a Checklist Studio appointment.</p>}
      <p className="text-sm text-[var(--cmp-app-text-secondary)]" role="status">Showing {shown.length} of {rows.length}</p>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 text-sm text-[var(--cmp-app-text-secondary)]">{rows.length === 0 ? "No instrument exists yet. Create the first one." : "Nothing matches these filters."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]">
          <table className="min-w-full divide-y divide-[var(--cmp-app-border)]">
            <thead><tr><th className={th}>Code</th><th className={th}>Name</th><th className={th}>Family</th><th className={th}>Version</th><th className={th}>State</th><th className={th}>Last activity</th></tr></thead>
            <tbody className="divide-y divide-[var(--cmp-app-border)]">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--cmp-app-bg)]">
                  <td className={`${td} font-mono text-xs`}><Link className="font-semibold text-[var(--cmp-theme-ink)] underline underline-offset-2" href={`/super-admin/checklist-studio/${r.id}`}>{r.code}</Link></td>
                  <td className={td}>{r.name}</td>
                  <td className={td}>{r.family_label ?? r.family_code ?? ""}</td>
                  <td className={td}>{r.latest_version_no ? `v${r.latest_version_no}` : ""}{r.published_version_no && r.published_version_no !== r.latest_version_no ? ` (v${r.published_version_no} live)` : ""}</td>
                  <td className={td}><StateChip state={r.latest_state} /></td>
                  <td className={td}>{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <NewInstrument registries={registries} onClose={() => setOpen(false)} />}
    </div>
  );
}
