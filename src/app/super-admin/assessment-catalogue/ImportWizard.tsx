"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import type { Family } from "@/lib/assessment/catalogue/families";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import type { ImportGroup, RegisteredInstrument, SheetDraft, WorkbookDraft } from "@/lib/assessment/import/types";
import { moveSheet, newGroupFor, readinessProblems } from "@/lib/assessment/import/workbook";
import ClassificationFields from "./ClassificationFields";
import ImportCorrect from "./ImportCorrect";
import PathwaySummaryCard from "./PathwaySummaryCard";
import type { PathwaySummary } from "@/lib/assessment/studio/pathway";
import { BASE, Chip, CodeChip, btnGhost, btnPrimary, callApi, input } from "./ui";

/**
 * Import existing instrument (registration option 2): Upload -> Extract -> Preview -> Correct -> Register Draft -> open in
 * Checklist Studio. The parser is deterministic and server-side. The person decides the grouping of sheets, settles
 * every column the parser could not classify, and confirms what is left out. Until Register, nothing is an instrument.
 */
type Step = "upload" | "preview" | "correct" | "register";
type Choices = { families: Family[]; purposes: { code: string; label: string; publishable: boolean }[]; taxonomy: TaxonomyDimension[] };
type Loaded = { importId: string; draft: WorkbookDraft; fileName: string; sha256: string; registered: RegisteredInstrument[] } & Choices;

const API = "/api/hq/assessment-catalogue/import";
const STEPS: { key: Step; label: string }[] = [{ key: "upload", label: "Upload" }, { key: "preview", label: "Preview and group" }, { key: "correct", label: "Correct" }, { key: "register", label: "Register" }];
const KIND_LABEL: Record<SheetDraft["kind"], string> = { instrument: "Instrument", record_log: "Record or tally table", empty: "Empty sheet", unknown: "Not recognised" };
const ROLE_OPTIONS = [["self", "Self"], ["assessor", "Assessor"], ["auditor", "Auditor"]] as const;

export default function ImportWizard({ families, taxonomy, canAuthor, onClose, onBack }: { families: Family[]; taxonomy: TaxonomyDimension[]; canAuthor: boolean; onClose: () => void; onBack: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(true, panel, onClose);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<WorkbookDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ registered: RegisteredInstrument[]; warnings: string[]; pathways: Record<string, PathwaySummary> } | null>(null);
  const fam = loaded?.families ?? families;
  const tax = loaded?.taxonomy ?? taxonomy;

  async function upload() {
    if (!file) return;
    setBusy("Uploading and extracting…"); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(API, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(String(j.error ?? "The upload did not work.")); return; }
      setLoaded(j as Loaded); setDraft((j as Loaded).draft); setStep("preview");
    } catch { setError("The server could not be reached. Try again."); } finally { setBusy(null); }
  }

  async function persist(next: WorkbookDraft): Promise<boolean> {
    if (!loaded) return false;
    setBusy("Saving…"); setError(null);
    const r = await callApi(`${API}/${loaded.importId}`, { draft: next }, "PUT");
    setBusy(null);
    if (!r.ok) { setError(r.error); return false; }
    setDraft(r.json.draft as WorkbookDraft);
    return true;
  }

  async function register() {
    if (!loaded || !draft) return;
    if (!(await persist(draft))) return;
    setBusy("Registering drafts…"); setError(null);
    const r = await callApi(`${API}/${loaded.importId}`, { action: "register" });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setResult({ registered: (r.json.registered as RegisteredInstrument[]) ?? [], warnings: (r.json.warnings as string[]) ?? [], pathways: (r.json.pathways as Record<string, PathwaySummary>) ?? {} });
    router.refresh();
  }

  const go = async (to: Step) => { if (draft && step !== "upload" && !(await persist(draft))) return; setStep(to); };
  const problems = draft ? readinessProblems(draft) : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-teal-950/40 p-2 sm:p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="imp-title" tabIndex={-1} className="flex max-h-[96vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="imp-title" className="text-lg font-bold text-gray-900">Import existing instrument</h2>
            <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" aria-label="Steps">
              {STEPS.map((s, i) => <li key={s.key} aria-current={step === s.key ? "step" : undefined} className={step === s.key ? "font-bold text-teal-900" : "text-gray-600"}>{i + 1}. {s.label}</li>)}
            </ol>
          </div>
          <button type="button" className={btnGhost} onClick={onClose} aria-label="Close">{"×"}</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-busy={!!busy}>
          {step === "upload" && (
            <div className="space-y-3">
              <p className="text-[13px] text-gray-700">Upload the workbook as it is. The structure is read deterministically on the server (no AI): sheets, titles, instructions, sections and subsections, numbered criteria, rating scales, response options, free text columns, identifiers and sign-off columns. The original file is kept as the source record of every instrument registered from it.</p>
              <label className="block text-[12.5px] font-semibold text-gray-800">Excel workbook (.xlsx, up to 25 MB)
                <input type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={`${input} mt-1`} onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {file && <p className="text-[12.5px] text-gray-700">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
            </div>
          )}

          {step === "preview" && draft && loaded && (
            <div className="space-y-4">
              <p className="text-[13px] text-gray-700"><b>{loaded.fileName}</b> · {draft.sheets.length} sheet{draft.sheets.length === 1 ? "" : "s"} · digest {loaded.sha256.slice(0, 12)}…</p>
              <section>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">What was found</h3>
                <p className="text-[12px] text-gray-600">One sheet is not assumed to be one instrument. Say for each sheet whether it is an instrument of its own, part of another, or left out.</p>
                <ul className="mt-2 grid gap-3 md:grid-cols-2">
                  {draft.sheets.map(s => <SheetCard key={s.name} sheet={s} draft={draft} onChange={setDraft} families={fam} />)}
                </ul>
              </section>
              <section>
                <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Instruments to register ({draft.groups.length})</h3>
                {draft.groups.length === 0 && <p className="mt-1 text-[13px] text-gray-700">Nothing is set to be registered yet.</p>}
                <ul className="mt-2 space-y-3">
                  {draft.groups.map(g => <GroupCard key={g.key} group={g} draft={draft} onChange={setDraft} families={fam} purposes={loaded.purposes} taxonomy={tax} />)}
                </ul>
              </section>
              {draft.excluded.length > 0 && (
                <section>
                  <h3 className="text-[13px] font-bold uppercase tracking-wide text-gray-700">Left out</h3>
                  <p className="text-[12px] text-gray-600">A sheet left out is not registered as an instrument. It stays in the stored workbook, the source record of this import, and nothing in it is discarded.</p>
                  <ul className="mt-2 space-y-2">
                    {draft.excluded.map(e => (
                      <li key={e.sheet} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-[13px]">
                        <span><b>{e.sheet}</b> <span className="text-gray-700">{e.reason}</span></span>
                        <label className="flex items-center gap-2 font-semibold text-gray-800"><input type="checkbox" checked={e.confirmed} onChange={ev => setDraft({ ...draft, excluded: draft.excluded.map(x => x.sheet === e.sheet ? { ...x, confirmed: ev.target.checked } : x) })} /> Confirm it is left out</label>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {step === "correct" && draft && <ImportCorrect draft={draft} onChange={setDraft} />}

          {step === "register" && draft && loaded && (
            <div className="space-y-3">
              {result ? (
                <>
                  <p className="text-[14px] text-gray-900">{result.registered.length} instrument{result.registered.length === 1 ? "" : "s"} registered as Draft{result.registered.length === 1 ? "" : "s"}. Each has its permanent code, its first version and its imported content, ready to edit in Checklist Studio and to put through review.</p>
                  <ul className="space-y-2">
                    {result.registered.map(r => (
                      <li key={r.instrumentId} className="space-y-2 rounded-lg border border-gray-200 px-3 py-2 text-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2"><CodeChip code={r.code} /> <b>{r.title}</b> <Chip tone="neutral">Draft v1</Chip>{r.scaleVersionId && <Chip tone="info">Draft scale</Chip>}</span>
                          <span className="flex gap-2">
                            <a className={btnPrimary} href={`/super-admin/checklist-studio/${r.instrumentId}/v/${r.versionId}`}>Open in Checklist Studio</a>
                            <button type="button" className={btnGhost} onClick={() => { router.push(`${BASE}?i=${r.instrumentId}`, { scroll: false }); onClose(); }}>Catalogue</button>
                          </span>
                        </div>
                        {result.pathways[r.versionId]
                          ? <PathwaySummaryCard summary={result.pathways[r.versionId]} studioHref={`/super-admin/checklist-studio/${r.instrumentId}/v/${r.versionId}`} studioLabel="Complete it in Checklist Studio" compact />
                          : <p className="text-[12.5px] text-gray-800" role="status">Your draft is registered. Next: open it in Checklist Studio, complete its content, then Submit for review.</p>}
                      </li>
                    ))}
                  </ul>
                  {result.registered.some(r => r.scaleVersionId) && <p className="text-[12.5px] text-gray-700">An imported rating scale is a <b>draft scale</b>, exactly as found in the workbook. It must be reviewed and published before the instrument can be put forward, and any mapping to another scale is a separate, reviewed step in the Studio.</p>}
                  {result.warnings.length > 0 && <ul className="list-disc pl-5 text-[12.5px] text-amber-900">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
                  <p className="text-[12.5px] text-gray-600">Source record: <a className="underline" href={`${API}/${loaded.importId}/file`}>{loaded.fileName}</a> (sha256 {loaded.sha256.slice(0, 16)}…), linked from each instrument.</p>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-gray-700">Registering creates, for each instrument below, the catalogue identity with its permanent code, a Draft version 1 with the sections, items, response fields and (where found) a draft rating scale, all pointing back to the uploaded workbook. Nothing is published: review, approval and publication follow as for any Draft.</p>
                  <ul className="space-y-1 text-[13px]">
                    {draft.groups.map(g => {
                      const sheets = draft.sheets.filter(s => g.sheets.includes(s.name));
                      const items = sheets.reduce((n, s) => n + s.items.filter(i => i.include).length, 0);
                      return <li key={g.key} className="rounded-lg border border-gray-200 px-3 py-2"><b>{g.title || "(untitled)"}</b> · {g.family ?? "no family"} · {items} items from {g.sheets.join(" + ")}{sheets.some(s => s.response.primary === "rating_scale") ? " · rating scale imported as a draft scale" : ""}</li>;
                    })}
                  </ul>
                  {problems.length > 0 && (
                    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
                      <p className="font-semibold">Before registering:</p>
                      <ul className="list-disc pl-5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
                    </div>
                  )}
                  {!canAuthor && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">Registering needs catalogue management or Checklist authoring. Your corrections are saved with the import.</p>}
                </>
              )}
            </div>
          )}

          {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          <div className="flex gap-2">
            {step === "upload" && <button type="button" className={btnGhost} onClick={onBack}>Back</button>}
            {step === "preview" && <button type="button" className={btnGhost} onClick={() => setStep("upload")}>Back</button>}
            {step === "correct" && <button type="button" className={btnGhost} onClick={() => void go("preview")}>Back</button>}
            {step === "register" && !result && <button type="button" className={btnGhost} onClick={() => void go("correct")}>Back</button>}
          </div>
          <div className="flex items-center gap-2">
            {busy && <span className="text-[12.5px] text-gray-700" role="status">{busy}</span>}
            {step === "upload" && <button type="button" className={btnPrimary} disabled={!file || !!busy} onClick={() => void upload()}>Upload and extract</button>}
            {step === "preview" && <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => void go("correct")}>Continue to correct</button>}
            {step === "correct" && <><button type="button" className={btnGhost} disabled={!!busy} onClick={() => draft && void persist(draft)}>Save corrections</button><button type="button" className={btnPrimary} disabled={!!busy} onClick={() => void go("register")}>Continue to register</button></>}
            {step === "register" && !result && <button type="button" className={btnPrimary} disabled={!!busy || problems.length > 0 || !canAuthor} onClick={() => void register()}>Register {draft?.groups.length ?? 0} Draft{draft?.groups.length === 1 ? "" : "s"}</button>}
            {step === "register" && result && <button type="button" className={btnPrimary} onClick={onClose}>Done</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetCard({ sheet: s, draft, onChange, families }: { sheet: SheetDraft; draft: WorkbookDraft; onChange: (d: WorkbookDraft) => void; families: Family[] }) {
  const inGroup = draft.groups.find(g => g.sheets.includes(s.name)) ?? null;
  const own = inGroup && inGroup.sheets.length === 1;
  const value = !inGroup ? "out" : own ? "own" : `in:${inGroup.key}`;
  const place = (v: string) => {
    if (v === "out") onChange(moveSheet(draft, s.name, null));
    else if (v === "own") onChange(newGroupFor(draft, s.name, families));
    else onChange(moveSheet(draft, s.name, v.slice(3)));
  };
  const warn = s.flags.filter(f => f.severity === "warn");
  const info = s.flags.filter(f => f.severity === "info");
  return (
    <li className="rounded-xl border border-gray-200 p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-bold text-gray-900">{s.name}</span>
        <Chip tone={s.kind === "instrument" ? "good" : "warn"}>{KIND_LABEL[s.kind]}</Chip>
      </div>
      {s.kind === "instrument" && (
        <p className="mt-1 text-gray-700">
          Title <b>{s.title}</b> · {s.sections.filter(x => !x.parentKey).length} sections · {s.items.length} items · {s.response.primary === "rating_scale" ? `rating scale ${s.scale ? `(${s.scale.levels.length} levels)` : ""}` : s.response.primary === "multiple_choice" ? `options ${s.response.options.map(o => o.label).join(" / ")}` : "no response columns"}{s.response.allowNa ? " · NA allowed" : ""} · {s.columns.filter(c => c.use === "text").length} text field{s.columns.filter(c => c.use === "text").length === 1 ? "" : "s"}
        </p>
      )}
      {s.kind !== "instrument" && s.unplaced.length > 0 && <p className="mt-1 text-gray-700">{s.unplaced.length} cells of text, kept in the record: {s.unplaced.slice(0, 3).map(u => `"${u.text}"`).join(", ")}{s.unplaced.length > 3 ? "…" : ""}</p>}
      {warn.length > 0 && <ul className="mt-1 space-y-0.5 text-amber-900">{warn.map((f, i) => <li key={i}>{f.message}</li>)}</ul>}
      {info.length > 0 && <details className="mt-1 text-gray-600"><summary className="cursor-pointer">{info.length} note{info.length === 1 ? "" : "s"}</summary><ul className="mt-1 space-y-0.5">{info.map((f, i) => <li key={i}>{f.message}</li>)}</ul></details>}
      <label className="mt-2 block font-semibold text-gray-800">This sheet is
        <select className={`${input} mt-1`} value={value} onChange={e => place(e.target.value)}>
          <option value="own">an instrument of its own</option>
          {draft.groups.filter(g => !(g.sheets.length === 1 && g.sheets[0] === s.name)).map(g => <option key={g.key} value={`in:${g.key}`}>part of: {g.title || g.sheets.join(" + ")}</option>)}
          <option value="out">left out of the import</option>
        </select>
      </label>
    </li>
  );
}

function GroupCard({ group: g, draft, onChange, families, purposes, taxonomy }: { group: ImportGroup; draft: WorkbookDraft; onChange: (d: WorkbookDraft) => void; families: Family[]; purposes: { code: string; label: string; publishable: boolean }[]; taxonomy: TaxonomyDimension[] }) {
  const patch = (p: Partial<ImportGroup>) => onChange({ ...draft, groups: draft.groups.map(x => x.key === g.key ? { ...x, ...p, confirmed: p.confirmed ?? false } : x) });
  const items = draft.sheets.filter(s => g.sheets.includes(s.name)).reduce((n, s) => n + s.items.filter(i => i.include).length, 0);
  return (
    <li className="rounded-xl border border-teal-200 bg-teal-50/30 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-[12.5px] font-semibold text-gray-800 md:col-span-2">Title
          <input className={`${input} mt-1`} value={g.title} maxLength={200} onChange={e => patch({ title: e.target.value })} />
          <span className="mt-0.5 block text-[11.5px] font-normal text-gray-600">From {g.sheets.join(" + ")} · {items} items{g.sheets.length > 1 ? " · each sheet becomes a top-level section" : ""}</span>
        </label>
        <label className="block text-[12.5px] font-semibold text-gray-800">Family
          <select className={`${input} mt-1`} value={g.family ?? ""} onChange={e => patch({ family: e.target.value || null, familySuggested: false })}>
            <option value="">Choose a family</option>
            {families.filter(f => f.isActive).map(f => <option key={f.code} value={f.code}>{f.label} ({f.code})</option>)}
          </select>
          {g.familySuggested && <span className="mt-0.5 block text-[11.5px] font-normal text-gray-600">Suggested from the title. Confirm or change it.</span>}
        </label>
        <label className="block text-[12.5px] font-semibold text-gray-800">Purpose
          <select className={`${input} mt-1`} value={g.purposeCode ?? ""} onChange={e => patch({ purposeCode: e.target.value || null })}>
            <option value="">Choose a purpose</option>
            {purposes.map(p => <option key={p.code} value={p.code}>{p.label}{p.publishable ? "" : " (cannot be published)"}</option>)}
          </select>
        </label>
        <fieldset className="text-[12.5px] font-semibold text-gray-800">
          <legend>Who answers</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {ROLE_OPTIONS.map(([code, label]) => (
              <label key={code} className="flex items-center gap-1.5 font-normal"><input type="checkbox" checked={g.respondentRoles.includes(code)} onChange={e => patch({ respondentRoles: e.target.checked ? [...g.respondentRoles, code] : g.respondentRoles.filter(r => r !== code) })} /> {label}</label>
            ))}
          </div>
        </fieldset>
        <label className="block text-[12.5px] font-semibold text-gray-800">Description
          <textarea className={`${input} mt-1`} rows={2} maxLength={2000} value={g.description} onChange={e => patch({ description: e.target.value })} />
        </label>
        <div className="md:col-span-2">
          <p className="mb-1 text-[12.5px] font-semibold text-gray-800">Classification</p>
          <ClassificationFields taxonomy={taxonomy} value={g.terms} onChange={terms => patch({ terms })} />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-gray-900"><input type="checkbox" checked={g.confirmed} onChange={e => onChange({ ...draft, groups: draft.groups.map(x => x.key === g.key ? { ...x, confirmed: e.target.checked } : x) })} /> Confirm: register this as one instrument</label>
    </li>
  );
}
