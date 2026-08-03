"use client";

import { useState } from "react";
import { TEMPLATE_KINDS, MERGE_FIELDS } from "@/lib/practice/document-constants";
import { NOTE_TYPES } from "@/lib/practice/encounter-constants";

// Authoring a workspace template, and moving one through draft -> published -> retired.
//
// A NEW TEMPLATE STARTS AS A DRAFT and has to be published deliberately. applyTemplate refuses anything
// unpublished, so a half-written template cannot reach a consultation by accident -- which matters
// because the thing it would reach is a clinical record.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

type Section = { noteType: string; heading: string; prompt: string; defaultBody: string; required: boolean };

const blankSection = (): Section => ({ noteType: "subjective", heading: "", prompt: "", defaultBody: "", required: false });

export default function TemplateConsole({ templates }: {
  templates: { id: string; title: string; status: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState({
    code: "", title: "", description: "", kind: "encounter_note",
    bodyTemplate: "", includeLetterhead: true,
  });
  const [sections, setSections] = useState<Section[]>([blankSection()]);
  const isDocument = form.kind !== "encounter_note";

  async function post() {
    setBusy(true); setNotice(null);
    const res = await fetch("/api/v1/practice/note-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        // A document template sends no sections, and an encounter note sends no body: whichever is not
        // the shape being written must not arrive half-filled from a form field nobody looked at.
        sections: isDocument ? [] : sections.filter(s => s.heading.trim()),
        bodyTemplate: isDocument ? form.bodyTemplate : "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  async function setStatus(id: string, status: string) {
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/v1/practice/note-templates/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice({ kind: "err", text: data?.error?.message ?? data?.error ?? "That did not work." });
      setBusy(false); return;
    }
    window.location.reload();
  }

  const patch = (i: number, p: Partial<Section>) =>
    setSections(s => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
      {notice && (
        <p className={`mb-2 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>{notice.text}</p>
      )}

      {templates.length > 0 && (
        <div className="mb-3">
          <h2 className="text-[13px] font-bold text-gray-900">Publish or retire</h2>
          <ul className="mt-1.5 flex flex-col gap-1">
            {templates.map(t => (
              <li key={t.id} className="flex items-center gap-2 text-[12px]">
                <span className="text-gray-800">{t.title}</span>
                <span className="text-[10px] font-bold text-gray-400">{t.status}</span>
                <span className="ml-auto flex gap-1.5">
                  {t.status !== "published" && (
                    <button type="button" disabled={busy} onClick={() => setStatus(t.id, "published")}
                      className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      Publish
                    </button>
                  )}
                  {t.status !== "retired" && (
                    <button type="button" disabled={busy} onClick={() => setStatus(t.id, "retired")}
                      className="rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      Retire
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" onClick={() => setOpen(o => !o)}
        className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
        {open ? "Cancel" : "Write a template"}
      </button>

      {open && (
        <form className="mt-3 flex flex-col gap-2" onSubmit={e => { e.preventDefault(); post(); }}>
          <div className="grid grid-cols-2 gap-2">
            <input required placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={input} />
            <input required placeholder="Code (lower_case)" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className={input} />
            <select aria-label="Template kind" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} className={input}>
              {TEMPLATE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={input} />
          </div>

          {/* ── TWO SHAPES OF TEMPLATE, and `kind` decides which one you are writing (CPR-330).
              An encounter note fills five SOAP boxes and needs SECTIONS. A letter is one flowing body
              with fields merged into it and needs a BODY. Showing both at once would make every referral
              template carry five empty headings. */}
          {isDocument ? (
            <>
              <p className="mt-1 text-[11px] font-semibold text-gray-500">Body</p>
              <textarea required rows={10} value={form.bodyTemplate}
                onChange={e => setForm(f => ({ ...f, bodyTemplate: e.target.value }))}
                placeholder={"Dear {{referral.addressee}},\n\nI am referring {{patient.name}}, born {{patient.date_of_birth}}...\n\n{{practitioner.name}}"}
                className={`${input} font-mono`} />
              <label className="flex items-center gap-2 text-[11px] text-gray-600">
                <input type="checkbox" checked={form.includeLetterhead}
                  onChange={e => setForm(f => ({ ...f, includeLetterhead: e.target.checked }))} />
                Print the practice letterhead above this
              </label>
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2">
                <p className="text-[11px] font-semibold text-gray-600">Fields you can merge</p>
                <ul className="mt-1 grid sm:grid-cols-2 gap-x-3">
                  {MERGE_FIELDS.map(([field, note]) => (
                    <li key={field} className="text-[10px] text-gray-500">
                      <code className="text-gray-700">{`{{${field}}}`}</code> &mdash; {note}
                    </li>
                  ))}
                </ul>
                {/* THE RULE THE MODULE TURNS ON, said where somebody is writing the template that will
                    depend on it. */}
                <p className="mt-1.5 text-[10px] text-gray-500">
                  A field with nothing to fill it prints as a visible marker &mdash;
                  <code className="mx-1 text-gray-700">[[patient.date_of_birth not recorded]]</code>
                  &mdash; never as a blank. Generation stops and names the gaps before it produces
                  anything.
                </p>
              </div>
            </>
          ) : (
            <p className="mt-1 text-[11px] font-semibold text-gray-500">Sections</p>
          )}
          {!isDocument && sections.map((s, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 p-2">
              <select aria-label="Segment" value={s.noteType} onChange={e => patch(i, { noteType: e.target.value })} className={input}>
                {NOTE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input required={i === 0} placeholder="Heading" value={s.heading} onChange={e => patch(i, { heading: e.target.value })} className={input} />
              <input placeholder="Prompt shown beside the box (not written into the note)" value={s.prompt}
                onChange={e => patch(i, { prompt: e.target.value })} className={`${input} col-span-2`} />
              <input placeholder="Starting text written INTO the note (optional)" value={s.defaultBody}
                onChange={e => patch(i, { defaultBody: e.target.value })} className={`${input} col-span-2`} />
              <label className="col-span-2 flex items-center gap-2 text-[11px] text-gray-600">
                <input type="checkbox" checked={s.required} onChange={e => patch(i, { required: e.target.checked })} />
                Mark this section required
              </label>
            </div>
          ))}

          {!isDocument && (
            <button type="button" onClick={() => setSections(s => [...s, blankSection()])}
              className="self-start rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
              Add a section
            </button>
          )}

          <button type="submit" disabled={busy || !form.title.trim() || !form.code.trim()
            || (isDocument ? !form.bodyTemplate.trim() : !sections.some(s => s.heading.trim()))}
            className="rounded-lg bg-[var(--cp-primary)] py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            Create as a draft
          </button>
          <p className="text-[10px] text-gray-400">
            A prompt is guidance and stays out of the record. Starting text is written into the note when
            the template is applied, so anything you put there becomes clinical content somebody has to
            read and correct.
          </p>
        </form>
      )}
    </section>
  );
}
