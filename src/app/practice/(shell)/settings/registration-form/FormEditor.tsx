"use client";

import { useCallback, useState } from "react";

// The no-code registration form editor -- CPR-PRM-001 s9.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE PROTECTED FIELDS ARE SHOWN, LOCKED, AND EXPLAINED -- NOT HIDDEN FROM THE EDITOR.
//
// The tempting design is to omit the fields a practice cannot change. It is the wrong one: an
// administrator who cannot see the date of birth on the list assumes the form does not ask for it, and
// then wonders why registrations fail. So they appear, with their controls disabled and a sentence
// saying why, which turns a mystery into a rule.
//
// PROBLEMS ARE SHOWN AS YOU EDIT, not at the moment you press Publish. Every save returns the whole
// validation result, so a rule that can never fire is flagged where you made it rather than found
// later in a list you have to hunt through.
//
// NO DRAG AND DROP. Ordering is up/down buttons: they work with a keyboard, they work on a phone at a
// registration desk, and they need no library. A drag handle that only works with a mouse is a feature
// half the people using this cannot reach.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)]";

export default function FormEditor({ canManage, initialTemplates, coreFields, fieldTypes }: {
  canManage: boolean;
  initialTemplates: any[];
  coreFields: { key: string; label: string; protected: boolean }[];
  fieldTypes: string[];
}) {
  // THE LIST ARRIVES FROM THE SERVER, so there is no load-on-mount effect and no flash of an empty
  // editor. Everything after the first render is a response to something somebody clicked.
  const [templates, setTemplates] = useState<any[]>(initialTemplates);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const loadList = useCallback(async () => {
    const r = await fetch("/api/v1/practice/registration-templates");
    if (!r.ok) return;
    const d = await r.json();
    setTemplates(d.templates ?? []);
  }, []);

  const loadOne = useCallback(async (id: string) => {
    const r = await fetch(`/api/v1/practice/registration-templates?id=${id}`);
    setDetail(r.ok ? await r.json() : null);
  }, []);

  async function call(method: string, body?: unknown, qs?: string) {
    setBusy(true); setError(null);
    const r = await fetch(`/api/v1/practice/registration-templates${qs ?? ""}`, {
      method, headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d?.error?.message ?? "That did not work."); return null; }
    // The PATCH and DELETE responses carry the refreshed template, so the editor never shows a state
    // the server has already moved on from.
    if (d.template) setDetail(d);
    return d;
  }

  if (!canManage) {
    return (
      <p className="text-[13px] text-gray-500">
        Changing the registration form is a practice setting, and you do not hold that permission.
      </p>
    );
  }

  const t = detail?.template;
  const fields: any[] = detail?.fields ?? [];
  const problems: any[] = detail?.problems ?? [];
  const locked = t?.status === "published" || t?.status === "retired";
  const protectedKeys = new Set(coreFields.filter(f => f.protected).map(f => f.key));
  const usedKeys = new Set(fields.map(f => f.field_key));
  const addableCore = coreFields.filter(f => !usedKeys.has(f.key));

  async function saveField(fieldKey: string, patch: Record<string, unknown>) {
    await call("PATCH", { templateId: openId, field: { fieldKey, ...patch } });
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    // Orders are rewritten as a clean sequence rather than swapped, so a template edited many times
    // does not end up with 10, 11, 11, 12 and an order that depends on the database's tie-breaking.
    const reordered = [...fields];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    setBusy(true);
    for (const [k, f] of reordered.entries()) {
      await fetch("/api/v1/practice/registration-templates", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: openId, field: { fieldKey: f.field_key, displayOrder: (k + 1) * 10 } }),
      });
    }
    setBusy(false);
    await loadOne(openId!);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── The templates ───────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Registration forms</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          A practice with no published form uses the built-in one. That is a working answer, not a gap.
        </p>

        {templates.length > 0 && (
          <ul className="mt-2 flex flex-col">
            {templates.map(x => (
              <li key={x.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <button type="button"
                  onClick={async () => {
                    const closing = x.id === openId;
                    setOpenId(closing ? null : x.id);
                    if (closing) setDetail(null); else await loadOne(x.id);
                  }}
                  className="text-[12px] font-semibold text-gray-900 hover:underline">
                  {x.name}
                </button>
                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
                  {x.status}
                </span>
                {x.is_default && x.status === "published" && (
                  <span className="rounded bg-[var(--cmp-surface-success)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cmp-text-success)]">
                    in use
                  </span>
                )}
                {[x.specialty, x.country, x.practice_type].filter(Boolean).length > 0 && (
                  <span className="text-[10px] text-gray-400">
                    {[x.specialty, x.country, x.practice_type].filter(Boolean).join(" · ")}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-gray-400">{x.fields} fields</span>
                {x.status === "published" && (
                  <button type="button" disabled={busy}
                    onClick={async () => { const d = await call("POST", { copyOf: x.id }); if (d?.id) { await loadList(); setOpenId(d.id); await loadOne(d.id); } }}
                    className="text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                    copy to draft
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Name a new form, e.g. Paediatric registration" className={input} />
          <button type="button" disabled={busy || newName.trim().length < 2}
            onClick={async () => {
              const d = await call("POST", { name: newName });
              if (d?.id) { setNewName(""); await loadList(); setOpenId(d.id); await loadOne(d.id); }
            }}
            className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            Create
          </button>
        </div>
        <p className="mt-1 text-[10px] text-gray-400">
          A new form starts with the standard fields already on it, so it is publishable from the moment
          it exists.
        </p>
      </section>

      {error && <p className="rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      {/* ── The editor ──────────────────────────────────────────────────────────────────────────── */}
      {t && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold text-gray-900">{t.name}</h2>
            <span className="text-[11px] text-gray-500">{t.status} · version {t.version}</span>
          </div>

          {locked && (
            <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-2.5 text-[11px] text-gray-600">
              {t.status === "published"
                ? "This form is live and somebody may be filling it in right now, so it cannot be changed in place. Copy it to a draft, change the copy, and publish that."
                : "This form has been retired. Copy it if you want to bring it back."}
            </p>
          )}

          {/* PROBLEMS FIRST, and each one names the field it is about. */}
          {problems.length > 0 && (
            <div className="mt-2 rounded-lg border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-2.5">
              <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">
                {problems.length} thing{problems.length === 1 ? "" : "s"} to fix before this can go live
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {problems.map((p, i) => <li key={i} className="text-[11px] text-gray-700">{p.problem}</li>)}
              </ul>
            </div>
          )}

          {/* ── The fields ───────────────────────────────────────────────────────────────────── */}
          <ul className="mt-3 flex flex-col gap-2">
            {fields.map((f, i) => {
              const isProtected = protectedKeys.has(f.field_key);
              return (
                <li key={f.id} className={`rounded-lg border p-2.5 ${isProtected ? "border-gray-200 bg-gray-50/60" : "border-gray-200"}`}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold text-gray-900">{f.label}</span>
                    <span className="font-mono text-[10px] text-gray-400">{f.field_key}</span>
                    <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-600">{f.field_type}</span>
                    {f.is_core && <span className="text-[10px] text-gray-400">standard</span>}
                    <span className="ml-auto flex gap-1">
                      <button type="button" disabled={locked || busy || i === 0} onClick={() => move(i, -1)}
                        className="rounded border border-gray-200 px-1.5 text-[11px] text-gray-600 disabled:opacity-30" aria-label={`Move ${f.label} up`}>↑</button>
                      <button type="button" disabled={locked || busy || i === fields.length - 1} onClick={() => move(i, 1)}
                        className="rounded border border-gray-200 px-1.5 text-[11px] text-gray-600 disabled:opacity-30" aria-label={`Move ${f.label} down`}>↓</button>
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-4 flex-wrap text-[11px] text-gray-700">
                    <label className={`flex items-center gap-1.5 ${isProtected ? "opacity-50" : ""}`}>
                      <input type="checkbox" checked={f.visible} disabled={locked || isProtected}
                        onChange={e => saveField(f.field_key, { visible: e.target.checked, required: f.required, label: f.label })} />
                      Shown
                    </label>
                    <label className={`flex items-center gap-1.5 ${isProtected ? "opacity-50" : ""}`}>
                      <input type="checkbox" checked={f.required} disabled={locked || isProtected}
                        onChange={e => saveField(f.field_key, { required: e.target.checked, visible: f.visible, label: f.label })} />
                      Required
                    </label>
                    {!f.is_core && !locked && (
                      <button type="button" disabled={busy}
                        onClick={async () => { await call("DELETE", undefined, `?id=${openId}&field=${f.field_key}`); }}
                        className="ml-auto text-[10px] font-semibold text-gray-400 hover:text-[var(--cmp-text-danger)]">
                        Remove
                      </button>
                    )}
                  </div>

                  {/* WHY IT IS LOCKED, in the place somebody would otherwise wonder. */}
                  {isProtected && (
                    <p className="mt-1 text-[10px] text-gray-500">
                      A patient record cannot be created without this, so it stays shown and required.
                      {f.field_key === "birth_date" || f.field_key === "age_estimate_years"
                        ? " A date of birth or an estimated age — either satisfies it, so you may hide one."
                        : f.field_key === "phone" || f.field_key === "email"
                          ? " A phone or an email — either satisfies it, so you may hide one."
                          : ""}
                    </p>
                  )}

                  {/* ── Conditions ─────────────────────────────────────────────────────────── */}
                  {!isProtected && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="text-gray-500">Only ask this when</span>
                      <select disabled={locked} value={f.condition?.when ?? ""}
                        onChange={e => saveField(f.field_key, {
                          label: f.label, visible: f.visible, required: f.required,
                          condition: e.target.value ? { when: e.target.value, isPresent: true } : null,
                        })}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-[11px]">
                        <option value="">— always ask it —</option>
                        {fields.filter(o => o.field_key !== f.field_key && o.visible)
                          .map(o => <option key={o.field_key} value={o.field_key}>{o.label}</option>)}
                      </select>
                      {f.condition?.when && (
                        <>
                          <select disabled={locked}
                            value={"equals" in (f.condition ?? {}) ? "equals" : "isPresent"}
                            onChange={e => saveField(f.field_key, {
                              label: f.label, visible: f.visible, required: f.required,
                              condition: e.target.value === "equals"
                                ? { when: f.condition.when, equals: "" }
                                : { when: f.condition.when, isPresent: true },
                            })}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-[11px]">
                            <option value="isPresent">has been answered</option>
                            <option value="equals">is exactly</option>
                          </select>
                          {"equals" in (f.condition ?? {}) && (
                            <input disabled={locked} defaultValue={String(f.condition.equals ?? "")}
                              onBlur={e => saveField(f.field_key, {
                                label: f.label, visible: f.visible, required: f.required,
                                condition: { when: f.condition.when, equals: e.target.value },
                              })}
                              placeholder="value" className="w-28 rounded-lg border border-gray-200 px-2 py-1 text-[11px]" />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* ── Adding ──────────────────────────────────────────────────────────────────────── */}
          {!locked && (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-gray-200 p-3">
              <AddField
                busy={busy}
                fieldTypes={fieldTypes}
                addableCore={addableCore}
                onAdd={async patch => { await call("PATCH", { templateId: openId, field: patch }); }}
              />
            </div>
          )}

          {/* ── Publish ─────────────────────────────────────────────────────────────────────── */}
          {t.status === "draft" && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button type="button" disabled={busy || problems.length > 0}
                onClick={async () => { await call("PATCH", { templateId: openId, publish: true, makeDefault: true }); await loadList(); await loadOne(openId!); }}
                className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
                Publish and use for new registrations
              </button>
              {problems.length > 0 && (
                <span className="text-[11px] text-gray-500">Fix the {problems.length} above first.</span>
              )}
            </div>
          )}
          {t.status === "published" && (
            <button type="button" disabled={busy}
              onClick={async () => { await call("PATCH", { templateId: openId, retire: true }); await loadList(); await loadOne(openId!); }}
              className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Take out of service
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Adding a field: a standard one that was removed, or a new question of your own. */
function AddField({ busy, fieldTypes, addableCore, onAdd }: {
  busy: boolean; fieldTypes: string[]; addableCore: any[];
  onAdd: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"custom" | "core">("custom");
  // NAMED question, not `label` -- `label` is the shared class string at the top of this file, and
  // shadowing it produced `className={label ? label : undefined}`, which is nonsense that typechecked.
  const [question, setQuestion] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [coreKey, setCoreKey] = useState(addableCore[0]?.key ?? "");

  // THE KEY IS DERIVED FROM THE LABEL, so nobody has to invent a machine name. Two fields called the
  // same thing collide on the unique index, and the server says so.
  const key = question.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const needsOptions = type === "select" || type === "multi_select";
  const parsedOptions = options.split("\n").map(s => s.trim()).filter(Boolean)
    .map(s => ({ value: s.toLowerCase().replace(/[^a-z0-9]+/g, "_"), label: s }));

  return (
    <>
      <div className="flex gap-3 text-[11px]">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "custom"} onChange={() => setMode("custom")} />
          A question of your own
        </label>
        {addableCore.length > 0 && (
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "core"} onChange={() => setMode("core")} />
            Put back a standard field
          </label>
        )}
      </div>

      {mode === "core" ? (
        <div className="flex gap-2">
          <select value={coreKey} onChange={e => setCoreKey(e.target.value)} className={input}>
            {addableCore.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <button type="button" disabled={busy || !coreKey}
            onClick={() => onAdd({ fieldKey: coreKey, visible: true, required: false })}
            className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            Add
          </button>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-2">
            <label>
              <span className="block text-[11px] font-semibold text-gray-600">The question</span>
              <input value={question} onChange={e => setQuestion(e.target.value)}
                placeholder="Which insurer?" className={`mt-1 ${input}`} />
            </label>
            <label>
              <span className="block text-[11px] font-semibold text-gray-600">Answer type</span>
              <select value={type} onChange={e => setType(e.target.value)} className={`mt-1 ${input}`}>
                {fieldTypes.map(ft => <option key={ft} value={ft}>{ft.replace(/_/g, " ")}</option>)}
              </select>
            </label>
          </div>
          {needsOptions && (
            <label>
              <span className="block text-[11px] font-semibold text-gray-600">The choices, one per line</span>
              <textarea rows={3} value={options} onChange={e => setOptions(e.target.value)}
                placeholder={"AAR\nJubilee\nSelf-paying"} className={`mt-1 ${input}`} />
              <span className="mt-0.5 block text-[10px] text-gray-400">
                A list with nothing in it is a question with no answers, and cannot be published.
              </span>
            </label>
          )}
          <div className="flex items-center gap-2">
            <button type="button"
              disabled={busy || key.length < 2 || (needsOptions && parsedOptions.length === 0)}
              onClick={async () => {
                await onAdd({
                  fieldKey: key, label: question.trim(), fieldType: type,
                  visible: true, required: false,
                  options: needsOptions ? parsedOptions : [],
                });
                setQuestion(""); setOptions("");
              }}
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
              Add this question
            </button>
            {key && <span className="font-mono text-[10px] text-gray-400">saved as {key}</span>}
          </div>
        </>
      )}
    </>
  );
}
