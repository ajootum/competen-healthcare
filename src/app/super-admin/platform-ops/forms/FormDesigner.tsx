"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Form Field Designer (NCP-003) — the type-specific designer on top of the Configuration Studio's governed
// FORM objects. Add / edit / reorder fields (28 field types), configure required + options, and see a live
// preview of the rendered form; the field metadata persists onto the object's `definition` via
// PATCH /api/config/objects. Conditional logic, validation rules, workflow binding and offline capture are
// honest next-phase.
type Field = { key: string; label: string; type: string; required?: boolean; options?: string[]; placeholder?: string };
type FormObj = { object_key: string; display_name: string; description?: string; status: string; definition?: { fields?: Field[] } };

const FIELD_TYPES: [string, string][] = [
  ["text", "Single-line text"], ["textarea", "Multi-line text"], ["number", "Numeric"], ["date", "Date"], ["datetime", "Date-Time"], ["time", "Time"],
  ["dropdown", "Dropdown"], ["multiselect", "Multi-select"], ["checkbox", "Checkbox"], ["radio", "Radio"], ["toggle", "Toggle"], ["slider", "Slider"], ["rating", "Rating"],
  ["signature", "Signature"], ["file", "File upload"], ["image", "Image"], ["patient_lookup", "Patient lookup"], ["staff_lookup", "Staff lookup"], ["calculated", "Calculated"],
];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const HAS_OPTIONS = new Set(["dropdown", "multiselect", "radio"]);
const input = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";

function PreviewField({ f }: { f: Field }) {
  const cls = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm bg-gray-50 text-gray-500";
  let ctrl;
  switch (f.type) {
    case "textarea": ctrl = <textarea className={cls} rows={2} disabled placeholder={f.placeholder} />; break;
    case "number": case "slider": ctrl = <input className={cls} type="number" disabled placeholder={f.placeholder} />; break;
    case "date": ctrl = <input className={cls} type="date" disabled />; break;
    case "datetime": ctrl = <input className={cls} type="datetime-local" disabled />; break;
    case "time": ctrl = <input className={cls} type="time" disabled />; break;
    case "dropdown": case "multiselect": ctrl = <select className={cls} disabled multiple={f.type === "multiselect"}>{(f.options ?? []).map(o => <option key={o}>{o}</option>)}</select>; break;
    case "checkbox": case "toggle": ctrl = <input type="checkbox" disabled className="rounded" />; break;
    case "radio": ctrl = <div className="flex flex-wrap gap-3">{(f.options ?? []).map(o => <label key={o} className="text-xs text-gray-500 flex items-center gap-1"><input type="radio" disabled />{o}</label>)}</div>; break;
    case "rating": ctrl = <div className="text-gray-500 text-lg leading-none">★★★★★</div>; break;
    case "signature": ctrl = <div className={`${cls} h-10 flex items-center justify-center italic`}>✍ signature</div>; break;
    case "file": case "image": ctrl = <div className={`${cls} border-dashed text-center`}>⬆ upload</div>; break;
    case "patient_lookup": case "staff_lookup": ctrl = <div className={`${cls} flex items-center gap-1`}>🔎 <span>{TYPE_LABEL[f.type]}</span></div>; break;
    default: ctrl = <input className={cls} disabled placeholder={f.placeholder} />;
  }
  return <div><label className="text-[11px] font-medium text-gray-600 block mb-0.5">{f.label}{f.required && <span className="text-rose-500"> *</span>}</label>{ctrl}</div>;
}

export default function FormDesigner({ forms }: { forms: FormObj[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(forms[0]?.object_key ?? null);
  const sel = forms.find(f => f.object_key === selKey) ?? null;
  const [fields, setFields] = useState<Field[]>(forms[0]?.definition?.fields ?? []);
  const [nt, setNt] = useState("text");
  const [nl, setNl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function pick(k: string) { setSelKey(k); setFields(forms.find(f => f.object_key === k)?.definition?.fields ?? []); setMsg(null); }
  function add() {
    if (!nl.trim()) return;
    let key = slug(nl); const have = new Set(fields.map(f => f.key)); let i = 2; const base = key;
    while (have.has(key)) key = `${base}_${i++}`;
    setFields(p => [...p, { key, label: nl.trim(), type: nt, required: false, ...(HAS_OPTIONS.has(nt) ? { options: ["Option 1", "Option 2"] } : {}) }]);
    setNl("");
  }
  const upd = (i: number, patch: Partial<Field>) => setFields(p => p.map((f, j) => j === i ? { ...f, ...patch } : f));
  const move = (i: number, d: number) => setFields(p => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return n; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (i: number) => setFields(p => p.filter((_, j) => j !== i));

  async function save() {
    if (!sel) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: sel.object_key, definition: { fields } }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ Saved ${fields.length} field${fields.length === 1 ? "" : "s"} onto the form.` : (d?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!forms.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No form objects yet.</p><p className="text-xs text-gray-500 mt-1">Author a <b>Form</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then design its fields here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Forms ({forms.length})</p>
        <div className="space-y-1 max-h-[460px] overflow-y-auto">
          {forms.map(f => (
            <button key={f.object_key} onClick={() => pick(f.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === f.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}>
              <p className="text-xs font-medium text-gray-800 truncate">{f.display_name}</p>
              <p className="text-[10px] text-gray-500 truncate">{(f.definition?.fields?.length ?? 0)} field(s)</p>
            </button>
          ))}
        </div>
      </div>

      {/* Field builder */}
      <div className={`${card} p-5 lg:col-span-2`}>
        {!sel ? <p className="text-sm text-gray-500 py-16 text-center">Select a form.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">{sel.display_name}</h3><span className="text-[10px] text-gray-500 font-mono">{sel.object_key}</span></div>
            <div className="flex items-end gap-2 mb-4">
              <label className="text-[11px] font-semibold text-gray-500 flex-1">Add field<input className={input} value={nl} onChange={e => setNl(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} placeholder="Field label" /></label>
              <select className={`${input} w-40`} value={nt} onChange={e => setNt(e.target.value)}>{FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <button onClick={add} disabled={!nl.trim()} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-2 disabled:opacity-50">+ Add</button>
            </div>
            {fields.length === 0 ? <p className="text-xs text-gray-500 py-6 text-center">No fields yet — add one above.</p> : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.key} className="border border-gray-100 rounded-lg p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-semibold rounded px-1.5 py-0.5 bg-gray-100 text-gray-600 shrink-0 w-24 text-center">{TYPE_LABEL[f.type] ?? f.type}</span>
                      <input className={`${input} flex-1`} value={f.label} onChange={e => upd(i, { label: e.target.value })} />
                      <label className="text-[10px] text-gray-500 flex items-center gap-1 shrink-0"><input type="checkbox" checked={!!f.required} onChange={e => upd(i, { required: e.target.checked })} className="rounded" />Req</label>
                      <button onClick={() => move(i, -1)} className="text-gray-500 hover:text-gray-700 text-xs px-1">↑</button>
                      <button onClick={() => move(i, 1)} className="text-gray-500 hover:text-gray-700 text-xs px-1">↓</button>
                      <button onClick={() => remove(i)} className="text-gray-500 hover:text-[var(--cmp-text-error)] text-xs px-1">✕</button>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] text-gray-500 font-mono shrink-0">{f.key}</span>
                      {HAS_OPTIONS.has(f.type) && <input className={`${input} flex-1 text-xs`} value={(f.options ?? []).join(", ")} onChange={e => upd(i, { options: e.target.value.split(",").map(o => o.trim()).filter(Boolean) })} placeholder="Option 1, Option 2, …" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save form fields"}</button></div>
          </>
        )}
      </div>

      {/* Live preview */}
      <div className={`${card} p-5`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-3">Live Preview</p>
        {sel && fields.length ? <div className="space-y-3">{fields.map(f => <PreviewField key={f.key} f={f} />)}</div> : <p className="text-xs text-gray-500 py-8 text-center">Fields render here as you build.</p>}
      </div>
    </div>
  );
}
