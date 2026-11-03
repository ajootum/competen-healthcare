"use client";

import { useState } from "react";
import { ROLE_LABEL, type ColumnRole, type DetectedColumn, type SheetDraft, type WorkbookDraft } from "@/lib/assessment/import/types";
import { Chip, input } from "./ui";

/**
 * Correct step of the import: what the parser found on each sheet that will be registered, editable where a person's
 * judgement is needed (titles, column roles, field labels, scale level names and descriptions, section titles, item
 * prompts, what to include). The detected structure and every unplaced cell stay visible: nothing is discarded quietly.
 */
const ROLES: ColumnRole[] = ["section", "number", "criterion", "rating", "na", "option", "option_group", "text", "signoff", "ignore", "unknown"];

export default function ImportCorrect({ draft, onChange }: { draft: WorkbookDraft; onChange: (d: WorkbookDraft) => void }) {
  const names = draft.groups.flatMap(g => g.sheets);
  const sheets = draft.sheets.filter(s => names.includes(s.name));
  const [current, setCurrent] = useState(sheets[0]?.name ?? "");
  const sheet = sheets.find(s => s.name === current) ?? sheets[0];
  if (!sheet) return <p className="text-[13px] text-gray-700">No sheet is set to be registered. Go back and choose one.</p>;
  // A correction changes what a sheet contains, not which instrument it belongs to: the grouping confirmation stands.
  const update = (patch: Partial<SheetDraft>) => onChange({ ...draft, sheets: draft.sheets.map(s => s.name === sheet.name ? { ...s, ...patch } : s) });
  const setColumn = (col: DetectedColumn, patch: Partial<DetectedColumn>) => update({ columns: sheet.columns.map(c => c.col === col.col && c.header === col.header ? { ...c, ...patch } : c) });
  const topSections = sheet.sections.filter(s => !s.parentKey);
  const childrenOf = (key: string) => sheet.sections.filter(s => s.parentKey === key);
  const itemsOf = (key: string) => sheet.items.filter(i => i.sectionKey === key);

  return (
    <div className="space-y-4">
      {sheets.length > 1 && (
        <nav aria-label="Sheets" className="flex flex-wrap gap-1 border-b border-gray-200">
          {sheets.map(s => <button key={s.name} type="button" aria-current={s.name === sheet.name ? "page" : undefined} onClick={() => setCurrent(s.name)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${s.name === sheet.name ? "border-teal-700 text-teal-900" : "border-transparent text-gray-700"}`}>{s.name}</button>)}
        </nav>
      )}
      <label className="block text-[12.5px] font-semibold text-gray-800">Sheet title
        <input className={`${input} mt-1`} value={sheet.title} maxLength={200} onChange={e => update({ title: e.target.value })} />
        <span className="mt-0.5 block text-[11.5px] font-normal text-gray-600">{sheet.titleSource === "sheet_name" ? "Taken from the sheet name." : "Found in the sheet."} Header row {sheet.headerRow}. {sheet.identifiers.length ? `Identifiers: ${sheet.identifiers.join(", ")}.` : ""}{sheet.instructions.length ? ` Instructions: ${sheet.instructions.join(" ")}` : ""}</span>
      </label>

      <section>
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Columns</h3>
        <p className="text-[12px] text-gray-600">What each column of the criteria table is. A text column becomes a field on every item. Ignored and sign-off columns are recorded on the import, not imported.</p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead><tr className="bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600"><th className="px-2 py-1.5">Col</th><th className="px-2 py-1.5">Header</th><th className="px-2 py-1.5">Role</th><th className="px-2 py-1.5">Field label</th></tr></thead>
            <tbody>
              {sheet.columns.map(c => (
                <tr key={`${c.col}-${c.header}`} className={`border-t border-gray-100 ${c.role === "unknown" ? "bg-amber-50" : ""}`}>
                  <td className="px-2 py-1 font-mono">{c.letter}</td>
                  <td className="px-2 py-1">{c.header || <span className="text-gray-500">(no header)</span>}{c.value && c.role !== "text" ? <span className="text-gray-600"> = {c.value}</span> : ""}{c.groupHeader ? <span className="text-gray-600"> under {c.groupHeader}</span> : ""}</td>
                  <td className="px-2 py-1">
                    <select aria-label={`Role of column ${c.letter}`} className={`${input} !w-auto`} value={c.role} onChange={e => setColumn(c, { role: e.target.value as ColumnRole, fieldLabel: e.target.value === "text" ? (c.fieldLabel ?? c.header) : c.fieldLabel })}>
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1">{c.role === "text" ? <input aria-label={`Field label for column ${c.letter}`} className={input} value={c.fieldLabel ?? c.header} maxLength={120} onChange={e => setColumn(c, { fieldLabel: e.target.value })} /> : <span className="text-gray-500">{"—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[12px] text-gray-700">Primary response: <b>{sheet.response.primary === "rating_scale" ? "rating on the imported scale" : sheet.response.primary === "multiple_choice" ? `one of ${sheet.response.options.map(o => o.label).join(" / ")}` : "Yes / No (no response columns were found)"}</b>{sheet.response.allowNa ? ", Not applicable allowed" : ""}.</p>
      </section>

      {sheet.scale && (
        <section>
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Rating scale: {sheet.scale.title}</h3>
          <p className="text-[12px] text-gray-600">Imported as a draft scale exactly as found (rows {sheet.scale.firstRow} to {sheet.scale.lastRow}). Which values count as satisfactory is not inferred: scoring decides that in Checklist Studio.</p>
          <ul className="mt-2 space-y-1">
            {sheet.scale.levels.map(l => (
              <li key={l.value} className="grid grid-cols-[3rem_1fr] gap-2 text-[12.5px] sm:grid-cols-[3rem_12rem_1fr]">
                <span className="pt-2 font-mono font-bold">{l.value}</span>
                <input aria-label={`Name of level ${l.value}`} className={input} placeholder="Level name (none in the workbook)" value={l.label ?? ""} maxLength={120} onChange={e => update({ scale: { ...sheet.scale!, levels: sheet.scale!.levels.map(x => x.value === l.value ? { ...x, label: e.target.value || null } : x) } })} />
                <input aria-label={`Description of level ${l.value}`} className={`${input} col-span-2 sm:col-span-1`} value={l.description} maxLength={2000} onChange={e => update({ scale: { ...sheet.scale!, levels: sheet.scale!.levels.map(x => x.value === l.value ? { ...x, description: e.target.value } : x) } })} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Sections and items ({sheet.items.filter(i => i.include).length} of {sheet.items.length} items included)</h3>
        <ul className="mt-2 space-y-2">
          {topSections.map(s => (
            <li key={s.key} className="rounded-lg border border-gray-200 p-2">
              <SectionRow s={s} sheet={sheet} update={update} />
              <ItemList items={itemsOf(s.key)} sheet={sheet} update={update} />
              {childrenOf(s.key).map(c => (
                <div key={c.key} className="ml-4 mt-2 border-l-2 border-gray-200 pl-2">
                  <SectionRow s={c} sheet={sheet} update={update} sub />
                  <ItemList items={itemsOf(c.key)} sheet={sheet} update={update} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      </section>

      {sheet.unplaced.length > 0 && (
        <section>
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Unplaced text ({sheet.unplaced.length})</h3>
          <p className="text-[12px] text-gray-600">Cells the parser could not place in the structure. They stay on the import record. Copy anything that belongs in the instrument into Checklist Studio after registering.</p>
          <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2 text-[12.5px]">{sheet.unplaced.map((u, i) => <li key={i}><span className="font-mono text-gray-600">{u.col}{u.row}</span> {u.text}</li>)}</ul>
        </section>
      )}

      {sheet.flags.length > 0 && (
        <section>
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Notes from the parser</h3>
          <ul className="mt-1 space-y-0.5 text-[12.5px]">{sheet.flags.map((f, i) => <li key={i} className={f.severity === "warn" ? "text-amber-900" : "text-gray-700"}>{f.message}{f.where ? ` (${f.where})` : ""}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function SectionRow({ s, sheet, update, sub }: { s: SheetDraft["sections"][number]; sheet: SheetDraft; update: (p: Partial<SheetDraft>) => void; sub?: boolean }) {
  const set = (p: Partial<typeof s>) => update({ sections: sheet.sections.map(x => x.key === s.key ? { ...x, ...p } : x) });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="checkbox" aria-label={`Include ${s.title}`} checked={s.include} onChange={e => set({ include: e.target.checked })} />
      <Chip tone="neutral">{sub ? "Subsection" : "Section"}</Chip>
      <input aria-label={`Title of ${s.title}`} className={`${input} min-w-[12rem] flex-1 font-semibold`} value={s.title} maxLength={200} onChange={e => set({ title: e.target.value })} />
      {s.guidance !== null && <input aria-label={`Guidance of ${s.title}`} className={`${input} min-w-[10rem] flex-1`} value={s.guidance} placeholder="Guidance" maxLength={1000} onChange={e => set({ guidance: e.target.value })} />}
      <span className="text-[11px] text-gray-500">row {s.row}</span>
    </div>
  );
}

function ItemList({ items, sheet, update }: { items: SheetDraft["items"]; sheet: SheetDraft; update: (p: Partial<SheetDraft>) => void }) {
  if (!items.length) return null;
  const set = (key: string, p: Partial<SheetDraft["items"][number]>) => update({ items: sheet.items.map(x => x.key === key ? { ...x, ...p } : x) });
  return (
    <ul className="mt-1 space-y-1">
      {items.map(i => (
        <li key={i.key} className="flex flex-wrap items-start gap-2 text-[12.5px]">
          <input type="checkbox" className="mt-2" aria-label={`Include item ${i.number ?? ""}`} checked={i.include} onChange={e => set(i.key, { include: e.target.checked })} />
          <input aria-label="Item number" className={`${input} !w-14 text-center`} value={i.number ?? ""} maxLength={20} onChange={e => set(i.key, { number: e.target.value || null })} />
          <div className="min-w-[14rem] flex-1">
            <input aria-label="Item text" className={input} value={i.prompt} maxLength={2000} onChange={e => set(i.key, { prompt: e.target.value })} />
            {i.subPoints.length > 0 && <ul className="ml-3 mt-0.5 list-disc text-[12px] text-gray-700">{i.subPoints.map((p, k) => <li key={k}>{p}</li>)}</ul>}
          </div>
          <span className="pt-2 text-[11px] text-gray-500">row {i.row}</span>
        </li>
      ))}
    </ul>
  );
}
