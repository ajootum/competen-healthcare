"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { AI_LABEL, MAPPING_LABEL, PERSONAL_CASE_LABEL } from "@/lib/individual/scholar/config";
import { AiBadge, ContentStatusTag, QuestionCard, type QuestionView } from "./client";
import { TopicEditor } from "./library-client";

// COMPETEN-SCHOLAR-01 S2 and S4, the interactive pieces: the programme a person studies, finding the topics
// and competencies in their notes, accepting or rejecting each suggested link, and playing a multi-step case.
// Each calls a gate-3 route and shows what it says. Nothing here decides access, ownership or what a
// competency is: the routes do, by the caller's own id and the catalogue.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const small = `inline-flex items-center justify-center rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

async function send(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

const LAYER_LABEL: Record<string, string> = { foundational: "Foundational", profession: "Profession", advanced: "Advanced practice", specialty: "Specialty", context: "Context" };
const LAYER_CLS: Record<string, string> = {
  foundational: "bg-violet-50 text-violet-900 border-violet-200",
  advanced: "bg-indigo-50 text-indigo-900 border-indigo-200",
  context: "bg-stone-100 text-stone-800 border-stone-300",
  profession: "bg-teal-50 text-teal-900 border-teal-200",
  specialty: "bg-orange-50 text-orange-900 border-orange-200",
};

export function LayerTag({ layer }: { layer: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${LAYER_CLS[layer] ?? "bg-gray-50 text-gray-700 border-gray-200"}`}>{LAYER_LABEL[layer] ?? layer}</span>;
}

// ── PROGRAMME ──────────────────────────────────────────────────────────────────────────────────────

export type ProgrammeOption = { code: string; label: string; profession: string; country: string | null; level: string | null };

export function ProgrammeChooser({ programmes, current }: { programmes: ProgrammeOption[]; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setMsg("");
    const r = await send("/api/individual/scholar/programme", { code: value || null }, "PUT");
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your programme could not be saved."); return; }
    setMsg(value ? "Saved. Topic finding will now suggest competencies from this programme." : "Cleared. Topic finding will list concepts only.");
    router.refresh();
  }
  return (
    <form onSubmit={save} aria-labelledby="programme-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="programme-h" className="text-[16px] font-bold text-gray-900">Your programme</h2>
      <p className="mt-1 text-[13.5px] text-gray-600">
        Scholar links your notes to the competencies of the programme you study. You do not need to choose a competency before you upload: suggestions come after, and you accept or reject each one.
      </p>
      {programmes.length === 0 ? (
        <p className="mt-3 rounded-xl bg-gray-50 px-3.5 py-3 text-[13.5px] text-gray-700">No programmes are available yet. Your notes can still be studied, and their concepts found, without one.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label htmlFor="programme-select" className="block text-[13px] font-semibold text-gray-800">Programme</label>
            <select id="programme-select" value={value} onChange={e => setValue(e.target.value)}
              className={`mt-1 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-[15px] text-gray-900 ${focusRing}`}>
              <option value="">No programme</option>
              {programmes.map(p => (
                <option key={p.code} value={p.code}>{p.label}{p.country ? ` (${p.country})` : ""}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={btn} style={{ background: accent }} disabled={busy || value === (current ?? "")}>{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
      {msg && <p aria-live="polite" className="mt-2 text-[13.5px] text-gray-700">{msg}</p>}
      {error && <p role="alert" className="mt-2 text-[13.5px] font-medium text-red-700">{error}</p>}
    </form>
  );
}

// ── FIND TOPICS AND COMPETENCIES ───────────────────────────────────────────────────────────────────

export function AnalysePanel({ materialId, consent, sections, analysed, programmeLabel, absence = null }: {
  materialId: string; consent: boolean; sections: number; analysed: number; programmeLabel: string | null;
  /** UPLOAD-01 R1: why no competency will be suggested (no programme, or no usable catalogue). Said, never blank. */
  absence?: string | null;
}) {
  const router = useRouter();
  const [done, setDone] = useState(analysed);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);
  const remaining = Math.max(0, sections - done);

  async function run() {
    if (running) return;
    setRunning(true); setError("");
    let left = remaining;
    let n = done;
    while (left > 0) {
      const r = await send(`/api/individual/scholar/materials/${materialId}/analyse`, {});
      if (!r.ok) { setError(r.json.error ?? "Topic finding stopped."); break; }
      n += r.json.analysed ?? 0;
      setDone(n);
      left = typeof r.json.remaining === "number" ? r.json.remaining : 0;
      if (!r.json.analysed) break;
      // SCHOLAR-UPLOAD-FIX: the topics found so far appear as each batch is saved, not only at the end.
      if (left > 0) router.refresh();
    }
    setRunning(false);
    router.refresh();
  }

  // Auto-identify: a material never analysed starts on its own once AI help is on. Once only per visit.
  useEffect(() => {
    if (consent && analysed === 0 && sections > 0 && !started.current) { started.current = true; void run(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section aria-labelledby="topics-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="topics-h" className="text-[16px] font-bold text-gray-900">Topics and competencies</h2>
      <p className="mt-1 text-[13.5px] text-gray-600">
        {programmeLabel && !absence
          ? <>Scholar finds the concepts in each section and suggests which competencies of <span className="font-semibold">{programmeLabel}</span> it supports.</>
          : absence
            ? <>Scholar finds the concepts in each section. {absence}</>
            : <>Scholar finds the concepts in each section. Choose your programme in My Learning to also see which competencies your notes support.</>}
      </p>
      <p className="mt-2 text-[13.5px] text-gray-800" aria-live="polite">
        {done} of {sections} section{sections === 1 ? "" : "s"} analysed{running ? "…" : "."}
      </p>
      {consent ? (
        remaining > 0 && (
          <button type="button" className={`${ghost} mt-3`} disabled={running} onClick={run}>
            {running ? "Finding topics…" : done === 0 ? "Find topics and competencies" : "Analyse the rest"}
          </button>
        )
      ) : (
        <p className="mt-2 text-[13px] text-gray-600">Turn on AI help in My Learning to find topics.</p>
      )}
      {error && <p role="alert" className="mt-2 text-[13.5px] font-medium text-red-700">{error}</p>}
    </section>
  );
}

// ── ONE SECTION: ITS CONCEPTS AND ITS COMPETENCY LINKS ──────────────────────────────────────────────

export type MappingView = {
  id: string; competencyId: string; title: string; code: string | null; layer: string; catalogue: string | null; structure?: string | null; contentStatus?: string | null;
  source: "ai" | "student" | "reviewer"; confidence: number | null; rationale: string | null;
  state: "proposed" | "accepted" | "rejected"; decidedBy: "student" | "reviewer" | null; decisions: number;
  /** UPLOAD-01 U3: the learning outcome named for this link, and the catalogue version it was read from. */
  outcome?: string | null; catalogueVersion?: string | null;
};
export type CompetencyOption = { id: string; title: string; code: string | null; layer: string; outcomes?: string[] };

const STATE_CLS = { proposed: "border-amber-300 bg-amber-50/50", accepted: "border-emerald-300 bg-emerald-50/50", rejected: "border-gray-200 bg-gray-50 opacity-80" };
const STATE_TEXT = { proposed: "Suggested", accepted: "Accepted", rejected: "Rejected" };

export function SectionTopics({ chunkId, concepts, mappings, options, corrected = false, correction = false }: {
  chunkId: string; concepts: string[]; mappings: MappingView[]; options: CompetencyOption[];
  /** UPLOAD-01 U5: `concepts` is the student's own list; `correction`: correcting is available here (408). */
  corrected?: boolean; correction?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState("");
  const [outcome, setOutcome] = useState("");
  const free = options.filter(o => !mappings.some(m => m.competencyId === o.id));
  const addingOutcomes = free.find(o => o.id === adding)?.outcomes ?? [];

  async function decide(id: string, decision: "accepted" | "rejected") {
    setBusy(id); setError("");
    const r = await send(`/api/individual/scholar/mappings/${id}`, { decision });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "Your choice could not be saved."); return; }
    router.refresh();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding) return;
    setBusy("add"); setError("");
    const r = await send("/api/individual/scholar/mappings", { chunkId, competencyId: adding, ...(outcome ? { outcome } : {}) });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "The link could not be saved."); return; }
    setAdding(""); setOutcome("");
    router.refresh();
  }

  if (!concepts.length && !mappings.length && !options.length && !corrected) return null;
  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-3.5">
      {(concepts.length > 0 || corrected) && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Concepts</p>
            {correction && <TopicEditor chunkId={chunkId} topics={concepts} corrected={corrected} />}
          </div>
          {concepts.length > 0
            ? <ul className="mt-1.5 flex flex-wrap gap-1.5">{concepts.map(c => <li key={c} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[12.5px] text-gray-800">{c}</li>)}</ul>
            : <p className="mt-1.5 text-[12.5px] text-gray-600">You removed every topic from this section.</p>}
        </div>
      )}
      {mappings.length > 0 && (
        <div className={concepts.length ? "mt-3" : ""}>
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">Competencies</p>
          {mappings.some(m => m.source === "ai") && <p className="mt-0.5 text-[12px] text-gray-600">{MAPPING_LABEL}</p>}
          <ul className="mt-2 space-y-2">
            {mappings.map(m => (
              <li key={m.id} className={`rounded-lg border p-2.5 ${STATE_CLS[m.state]}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <LayerTag layer={m.layer} />
                  <span className={`text-[14px] font-semibold text-gray-900 ${m.state === "rejected" ? "line-through decoration-gray-400" : ""}`}>
                    {m.code ? `${m.code} ` : ""}{m.title}
                  </span>
                  <span className="text-[12px] font-semibold text-gray-600">
                    {STATE_TEXT[m.state]}{m.state !== "proposed" && m.decidedBy === "reviewer" ? " by a reviewer" : ""}
                    {m.source === "student" ? " · added by you" : m.confidence !== null ? ` · AI confidence ${Math.round(m.confidence * 100)}%` : ""}
                    {m.decisions > 1 ? ` · changed ${m.decisions - 1} time${m.decisions === 2 ? "" : "s"}` : ""}
                  </span>
                </div>
                {(m.structure || m.contentStatus) && (
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] font-medium text-gray-600">{m.structure}<ContentStatusTag status={m.contentStatus} /></p>
                )}
                {m.outcome && <p className="mt-1 text-[12.5px] text-gray-700"><span className="font-semibold">Learning outcome:</span> {m.outcome}</p>}
                {m.rationale && <p className="mt-1 text-[13px] text-gray-700">{m.rationale}</p>}
                {m.catalogueVersion && <p className="mt-0.5 text-[11.5px] text-gray-500">Catalogue version {m.catalogueVersion}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.state !== "accepted" && (
                    <button type="button" className={`${small} border-emerald-400 bg-white text-emerald-900 hover:bg-emerald-50`} disabled={!!busy} onClick={() => decide(m.id, "accepted")}>
                      {busy === m.id ? "Saving…" : m.state === "rejected" ? "Accept instead" : "Accept"}
                    </button>
                  )}
                  {m.state !== "rejected" && (
                    <button type="button" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} disabled={!!busy} onClick={() => decide(m.id, "rejected")}>
                      {busy === m.id ? "Saving…" : m.state === "accepted" ? "Reject instead" : "Reject"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {free.length > 0 && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label htmlFor={`add-${chunkId}`} className="block text-[12.5px] font-semibold text-gray-700">Link another competency</label>
            <select id={`add-${chunkId}`} value={adding} onChange={e => { setAdding(e.target.value); setOutcome(""); }}
              className={`mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 ${focusRing}`}>
              <option value="">Choose…</option>
              {free.map(o => <option key={o.id} value={o.id}>{LAYER_LABEL[o.layer] ?? o.layer}: {o.code ? `${o.code} ` : ""}{o.title}</option>)}
            </select>
          </div>
          {addingOutcomes.length > 0 && (
            <div className="min-w-[220px] flex-1">
              <label htmlFor={`outcome-${chunkId}`} className="block text-[12.5px] font-semibold text-gray-700">Learning outcome (optional)</label>
              <select id={`outcome-${chunkId}`} value={outcome} onChange={e => setOutcome(e.target.value)}
                className={`mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 ${focusRing}`}>
                <option value="">None in particular</option>
                {addingOutcomes.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}
          <button type="submit" className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`} disabled={!adding || !!busy}>{busy === "add" ? "Saving…" : "Link"}</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">{error}</p>}
    </div>
  );
}

// ── A MULTI-STEP PRACTICE CASE ── each step opens once the one before it is answered ─────────────────

export type CaseStepView = { q: QuestionView; chunkId: string; answered: boolean };

export function CasePlayer({ title, competency, steps }: { title: string; competency: { title: string; layer: string; contentStatus?: string | null } | null; steps: CaseStepView[] }) {
  const firstOpen = steps.findIndex(s => !s.answered);
  const [open, setOpen] = useState(firstOpen < 0 ? steps.length : firstOpen + 1);
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <AiBadge />
        <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[11.5px] font-semibold text-gray-700">{PERSONAL_CASE_LABEL}</span>
      </div>
      <h3 className="mt-3 text-[17px] font-bold text-gray-900">{title}</h3>
      {competency && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-gray-700"><span>Practises</span><LayerTag layer={competency.layer} /><span className="font-semibold">{competency.title}</span><ContentStatusTag status={competency.contentStatus} /></p>
      )}
      <p className="mt-1 text-[12.5px] text-gray-600">{steps.length} steps. Each step opens when you have answered the one before.</p>
      <ol className="mt-4 space-y-4">
        {steps.map((s, i) => i < open ? (
          <li key={s.q.id}>
            <QuestionCard q={s.q} index={i + 1} chunkId={s.chunkId} stepLabel={`Step ${i + 1} of ${steps.length}`}
              onAnswered={() => setOpen(o => Math.max(o, i + 2))} />
          </li>
        ) : (
          <li key={s.q.id} className="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-[13.5px] text-gray-500">Step {i + 1} of {steps.length}: answer the step above to continue.</li>
        ))}
      </ol>
      <p className="mt-3 text-[11.5px] text-gray-500">{AI_LABEL}</p>
    </article>
  );
}
