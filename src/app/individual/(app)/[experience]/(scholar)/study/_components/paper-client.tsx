"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";

// Studying an examination paper (COMPETEN-SCHOLAR-EXAM-PAPERS-01): attempt a question, then reveal a suggested answer
// with its evidence; ask a follow-up; turn it into revision. Every call goes to a gate-3 route, which decides; this
// shows what the route says, its refusals included, in words.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-[9px] px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-gray-200 bg-white px-4 py-2 text-[14px] font-semibold text-gray-900 hover:bg-[var(--cmp-theme-soft)] disabled:opacity-50 ${focusRing}`;
const link = `inline-flex min-h-[36px] items-center text-[14px] font-semibold underline-offset-2 hover:underline ${focusRing}`;

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

export type PaperQuestionView = {
  id: string; number: string; section: string | null; instructions: string | null; stem: string; options: { label: string; text: string }[];
  marks: number | null; pages: string | null; leadIn: boolean; flags: string[];
};
export type EvidenceView = { tag: string; kind: "notes" | "library" | "web"; title: string; citation: string; excerpt: string; url: string | null; published: string | null; retrievedAt: string | null; status: string | null; materialId: string | null };
export type AnswerContentView = {
  option: string | null; examAnswer: string; explanation: string; optionNotes: { label: string; note: string }[];
  currentGuidance: string | null; guidanceStatus: "agrees" | "differs" | "no_current_source" | "not_applicable";
  conflicts: { claim: string; tags: string[] }[]; unsupported: string[]; uncertainty: string[];
};
export type SavedAnswerView = {
  id: string; content: AnswerContentView; evidence: EvidenceView[]; attempt: { option: string | null; text: string | null } | null;
  research: { web?: { state?: string; message?: string | null } } | null; model: string; createdAt: string; revisionQuestionId: string | null;
};
export type EvidenceChoice = { notes: boolean; library: boolean; web: { on: boolean; reason: string | null }; depth: "quick" | "standard" | "deep" };

const KIND_LABEL: Record<EvidenceView["kind"], string> = { notes: "Your notes", library: "Competen library", web: "Web research" };
const GUIDANCE: Record<AnswerContentView["guidanceStatus"], { text: string; cls: string }> = {
  agrees: { text: "Current sources agree with the examination answer.", cls: "bg-[var(--cmp-theme-soft)] text-[var(--cmp-theme-ink)]" },
  differs: { text: "Current guidance differs from what the examination expects. Know both, and follow current guidance in practice.", cls: "bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]" },
  no_current_source: { text: "No current guidance source was found. This answer reflects the examination context only.", cls: "bg-[var(--cmp-app-bg)] text-[var(--cmp-app-text-secondary)]" },
  not_applicable: { text: "Current guidance does not apply to this question.", cls: "bg-[var(--cmp-app-bg)] text-[var(--cmp-app-text-secondary)]" },
};

/** Citation tags as small labelled links to the evidence below. */
function Cited({ text, prefix }: { text: string; prefix: string }) {
  const parts = text.split(/(\[[NLW]\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\[([NLW]\d+)\]$/.exec(p);
        return m
          ? <a key={i} href={`#${prefix}-${m[1]}`} className={`mx-0.5 rounded bg-[var(--cmp-theme-soft)] px-1 text-[11.5px] font-bold no-underline ${focusRing}`} style={{ color: accent }}>{m[1]}</a>
          : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function EvidenceList({ evidence, prefix }: { evidence: EvidenceView[]; prefix: string }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-4">
      <h4 className="text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">Evidence</h4>
      {(["notes", "library", "web"] as const).map(kind => {
        const items = evidence.filter(e => e.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind} className="mt-2">
            <p className="text-[12.5px] font-semibold text-gray-700">{KIND_LABEL[kind]}</p>
            <ul className="mt-1 space-y-2">
              {items.map(e => (
                <li key={e.tag} id={`${prefix}-${e.tag}`} className="rounded-lg border border-gray-200 bg-white p-3 text-[13px]">
                  <p className="font-semibold text-gray-900">
                    <span className="mr-1.5 rounded bg-[var(--cmp-theme-soft)] px-1 text-[11.5px] font-bold" style={{ color: accent }}>{e.tag}</span>
                    {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${focusRing}`}>{e.title}</a>
                      : e.materialId ? <Link href={experienceHref("scholar", `study/${e.materialId}`)} className={`underline underline-offset-2 ${focusRing}`}>{e.title}</Link>
                        : e.title}
                  </p>
                  <p className="text-[12px] text-gray-600">
                    {e.citation}{e.kind === "web" && e.retrievedAt ? ` · retrieved ${new Date(e.retrievedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                    {e.kind === "web" && !e.published ? " · no publication date shown" : ""}
                  </p>
                  {e.excerpt && e.excerpt !== e.title && <p className="mt-1 text-[12.5px] leading-relaxed text-gray-700">“{e.excerpt.slice(0, 400)}{e.excerpt.length > 400 ? "…" : ""}”</p>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function AnswerView({ a, onRevise, onDelete, busy }: { a: SavedAnswerView; onRevise: () => void; onDelete: () => void; busy: boolean }) {
  const c = a.content;
  const [ask, setAsk] = useState("");
  const [reply, setReply] = useState<{ text?: string; message?: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const prefix = `a-${a.id.slice(0, 8)}`;
  async function followUp(e: React.FormEvent) {
    e.preventDefault();
    if (!ask.trim()) return;
    setAsking(true); setReply(null);
    const r = await call("/api/individual/scholar/papers/follow-up", { answerId: a.id, ask });
    setAsking(false);
    setReply(r.ok && r.json.text ? { text: r.json.text } : { message: r.json.message ?? r.json.error ?? "No reply could be shown." });
  }
  return (
    <div className="mt-4 rounded-xl border border-[var(--cmp-theme-border)] bg-[var(--cmp-app-bg)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-900"><span aria-hidden>✦</span>Suggested answer, written by AI from the evidence below. Not an answer key or a mark.</p>
        <span className="text-[11.5px] text-gray-500">{new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {a.model}</span>
      </div>
      {a.attempt && (a.attempt.option || a.attempt.text) && (
        <p className="mt-3 text-[13.5px] text-gray-700"><span className="font-semibold">Your attempt:</span> {a.attempt.option ? `${a.attempt.option}. ` : ""}{a.attempt.text}</p>
      )}
      <h4 className="mt-3 text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">The examination answer</h4>
      {c.option && <p className="mt-1 text-[15px] font-bold text-gray-900">Option {c.option}{a.attempt?.option ? (a.attempt.option === c.option ? " · matches your choice" : ` · you chose ${a.attempt.option}`) : ""}</p>}
      <p className="mt-1 whitespace-pre-line text-[14.5px] leading-relaxed text-gray-900"><Cited text={c.examAnswer} prefix={prefix} /></p>
      {c.explanation && <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-gray-700"><Cited text={c.explanation} prefix={prefix} /></p>}
      {c.optionNotes.length > 0 && (
        <details className="mt-3">
          <summary className={`cursor-pointer text-[13.5px] font-semibold text-gray-800 ${focusRing}`}>Option by option</summary>
          <ul className="mt-2 space-y-1.5">
            {c.optionNotes.map(n => <li key={n.label} className="text-[13.5px] text-gray-700"><span className="font-bold text-gray-900">{n.label}.</span> <Cited text={n.note} prefix={prefix} /></li>)}
          </ul>
        </details>
      )}
      <h4 className="mt-4 text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">Current guidance</h4>
      <p className={`mt-1 rounded-lg px-3 py-2 text-[13px] ${GUIDANCE[c.guidanceStatus].cls}`}>{GUIDANCE[c.guidanceStatus].text}</p>
      {c.currentGuidance && <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-gray-800"><Cited text={c.currentGuidance} prefix={prefix} /></p>}
      {c.conflicts.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-[13px] font-bold text-amber-950">Sources disagree</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-amber-950">{c.conflicts.map((x, i) => <li key={i}>{x.claim} {x.tags.map(t => <a key={t} href={`#${prefix}-${t}`} className="font-bold underline">{t}</a>)}</li>)}</ul>
        </div>
      )}
      {(c.unsupported.length > 0 || c.uncertainty.length > 0) && (
        <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
          <p className="text-[13px] font-bold text-gray-900">Check these</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-gray-700">
            {c.unsupported.map((x, i) => <li key={`u${i}`}><span className="font-semibold">Not supported by the evidence:</span> {x}</li>)}
            {c.uncertainty.map((x, i) => <li key={`c${i}`}><span className="font-semibold">Uncertain:</span> {x}</li>)}
          </ul>
        </div>
      )}
      {a.research?.web?.message && <p className="mt-3 text-[12.5px] text-gray-600">Web research: {a.research.web.message}</p>}
      <EvidenceList evidence={a.evidence} prefix={prefix} />
      <form onSubmit={followUp} className="mt-4">
        <label htmlFor={`${prefix}-ask`} className="block text-[13.5px] font-semibold text-gray-900">Ask a follow-up question</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <input id={`${prefix}-ask`} value={ask} onChange={e => setAsk(e.target.value)} maxLength={500} placeholder="Why is option B not the best answer?"
            className={`min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-[14px] ${focusRing}`} />
          <button type="submit" className={ghost} disabled={asking || !ask.trim()}>{asking ? "Asking…" : "Ask"}</button>
        </div>
        {reply && <p className="mt-2 whitespace-pre-line rounded-lg bg-white p-3 text-[13.5px] text-gray-800">{reply.text ? <Cited text={reply.text} prefix={prefix} /> : reply.message}</p>}
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {a.revisionQuestionId
          ? <Link href={experienceHref("scholar", "study/revise")} className={ghost}>In your revision ✓</Link>
          : <button type="button" className={ghost} disabled={busy} onClick={onRevise}>Add to revision</button>}
        <button type="button" className={`${link} text-gray-600`} disabled={busy} onClick={onDelete}>Delete this answer</button>
      </div>
    </div>
  );
}

function QuestionCard({ q, saved, choice, onSaved }: { q: PaperQuestionView; saved: SavedAnswerView | null; choice: EvidenceChoice; onSaved: () => void }) {
  const router = useRouter();
  const [option, setOption] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [answer, setAnswer] = useState<SavedAnswerView | null>(saved);
  async function reveal(withAttempt: boolean) {
    setBusy(true); setNotice(null);
    const sources = [choice.notes ? "notes" : null, choice.library ? "library" : null, choice.web.on ? "web" : null].filter(Boolean);
    const r = await call("/api/individual/scholar/papers/answer", {
      questionId: q.id, attempt: withAttempt ? { option, text: text.trim() || null } : null, sources, depth: choice.depth,
    });
    setBusy(false);
    if (!r.ok) { setNotice(r.json.error ?? "No answer could be written just now."); return; }
    if (r.json.noEvidence || r.json.withheld) { setNotice(r.json.message ?? "No answer could be shown."); return; }
    setAnswer({ id: r.json.id, content: r.json.content, evidence: r.json.evidence, attempt: r.json.attempt, research: r.json.research, model: r.json.provenance?.model ?? "", createdAt: new Date().toISOString(), revisionQuestionId: null });
    onSaved();
  }
  async function revise() {
    if (!answer) return;
    setBusy(true);
    const r = await call(`/api/individual/scholar/papers/answers/${answer.id}`);
    setBusy(false);
    if (r.ok) { setAnswer({ ...answer, revisionQuestionId: r.json.revisionQuestionId }); router.refresh(); } else setNotice(r.json.error ?? "It could not be added to revision.");
  }
  async function remove() {
    if (!answer) return;
    setBusy(true);
    const r = await call(`/api/individual/scholar/papers/answers/${answer.id}`, undefined, "DELETE");
    setBusy(false);
    if (r.ok) { setAnswer(null); router.refresh(); } else setNotice(r.json.error ?? "It could not be deleted.");
  }
  const attempted = !!option || !!text.trim();
  return (
    <li id={`q-${q.number}`} className={`rounded-2xl border bg-white p-5 ${q.leadIn ? "border-dashed border-gray-300" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-bold text-gray-900">{q.leadIn ? `Question ${q.number}: shared information` : `Question ${q.number}`}</h3>
        <span className="text-[12px] text-gray-500">{[q.marks !== null ? `${q.marks} mark${q.marks === 1 ? "" : "s"}` : null, q.pages].filter(Boolean).join(" · ")}</span>
      </div>
      {q.instructions && <p className="mt-1 text-[13px] italic text-gray-600">{q.instructions}</p>}
      <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-gray-900">{q.stem}</p>
      {q.flags.length > 0 && <ul className="mt-2 space-y-1">{q.flags.map(f => <li key={f} className="rounded-lg bg-[var(--cmp-role-revision-soft)] px-3 py-1.5 text-[12.5px] text-[var(--cmp-role-revision-ink)]">{f}</li>)}</ul>}
      {!q.leadIn && (
        <>
          {q.options.length > 0 ? (
            <fieldset className="mt-3">
              <legend className="sr-only">Your choice for question {q.number}</legend>
              {q.options.map(o => (
                <label key={o.label} className={`mt-1.5 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-[9px] border px-3 py-2 text-[14.5px] ${option === o.label ? "border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-soft)]" : "border-gray-200 hover:bg-gray-50"}`}>
                  <input type="radio" name={`opt-${q.id}`} value={o.label} checked={option === o.label} onChange={() => setOption(o.label)} className="mt-1" />
                  <span><span className="font-bold">{o.label}.</span> {o.text}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <label htmlFor={`att-${q.id}`} className="mt-3 block text-[13.5px] font-semibold text-gray-900">{q.options.length ? "Your reasoning (optional)" : "Your answer"}</label>
          <textarea id={`att-${q.id}`} rows={q.options.length ? 2 : 4} value={text} onChange={e => setText(e.target.value)} maxLength={3000}
            className={`mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14.5px] ${focusRing}`} placeholder="Attempt it before you reveal the suggested answer." />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn} style={{ background: accent }} disabled={busy || !attempted} onClick={() => reveal(true)}>{busy ? "Working…" : answer ? "Check my new attempt" : "Check my attempt"}</button>
            <button type="button" className={ghost} disabled={busy} onClick={() => reveal(false)}>{answer ? "Write a fresh answer" : "Show a suggested answer"}</button>
          </div>
          {notice && <p role="alert" className="mt-3 text-[13.5px] font-medium text-red-700">{notice}</p>}
          {answer && <AnswerView a={answer} busy={busy} onRevise={revise} onDelete={remove} />}
        </>
      )}
    </li>
  );
}

export function PaperStudy({ questions, saved, choice: initial, webDepths }: {
  questions: PaperQuestionView[]; saved: Record<string, SavedAnswerView>; choice: EvidenceChoice; webDepths: ("quick" | "standard" | "deep")[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(initial);
  return (
    <>
      <section aria-labelledby="ev-h" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="ev-h" className="text-[16px] font-bold text-gray-900">Evidence for suggested answers</h2>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-gray-800">
          <label className="flex min-h-[36px] items-center gap-2"><input type="checkbox" checked={choice.notes} onChange={e => setChoice({ ...choice, notes: e.target.checked })} /> Your notes</label>
          <label className="flex min-h-[36px] items-center gap-2"><input type="checkbox" checked={choice.library} onChange={e => setChoice({ ...choice, library: e.target.checked })} /> Competen library</label>
          {initial.web.on ? (
            <>
              <label className="flex min-h-[36px] items-center gap-2"><input type="checkbox" checked={choice.web.on} onChange={e => setChoice({ ...choice, web: { ...choice.web, on: e.target.checked } })} /> Live web research</label>
              {choice.web.on && (
                <label className="flex min-h-[36px] items-center gap-2">Depth
                  <select value={choice.depth} onChange={e => setChoice({ ...choice, depth: e.target.value as EvidenceChoice["depth"] })} className={`rounded-lg border border-gray-300 bg-white px-2 py-1 ${focusRing}`}>
                    {webDepths.map(d => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </label>
              )}
            </>
          ) : <span className="flex min-h-[36px] items-center text-[13px] text-gray-600">Live web research: {initial.web.reason}</span>}
        </div>
        <p className="mt-2 text-[12.5px] text-gray-600">Web research sends only the examination question, never your notes or your answers. Sources come from an approved list and are shown with their dates.</p>
      </section>
      <ol className="space-y-4">
        {questions.map((q, i) => {
          // A section heading where the section changes from the question before.
          const prev = questions.slice(0, i).reverse().find(o => o.section)?.section ?? null;
          const heading = q.section && q.section !== prev ? q.section : null;
          return (
            <Fragment key={q.id}>
              {heading && <li className="pt-2 text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">{heading}</li>}
              <QuestionCard q={q} saved={saved[q.id] ?? null} choice={choice} onSaved={() => router.refresh()} />
            </Fragment>
          );
        })}
      </ol>
    </>
  );
}

/** Material page: start studying it as a paper, with the practice-paper attestation. */
export function StudyAsPaper({ materialId, attestation, transcribable }: { materialId: string; attestation: string; transcribable: boolean }) {
  const router = useRouter();
  const [attested, setAttested] = useState(false);
  const [transcribe, setTranscribe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/papers", { materialId, attested, transcribe });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "It could not be prepared just now."); return; }
    router.push(experienceHref("scholar", `study/apply/papers/${materialId}`));
  }
  return (
    <div>
      <label className="flex items-start gap-3 text-[14px] text-gray-900">
        <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
        <span>{attestation}</span>
      </label>
      {transcribable && (
        <label className="mt-2 flex items-start gap-3 text-[13.5px] text-gray-700">
          <input type="checkbox" checked={transcribe} onChange={e => setTranscribe(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
          <span>Some pages are scanned. Transcribe them with AI (uses your AI consent; every transcribed question is labelled, and anything unreadable is flagged).</span>
        </label>
      )}
      <button type="button" className={`${btn} mt-3`} style={{ background: accent }} disabled={busy || !attested} onClick={start}>{busy ? "Reading the paper…" : "Study as an examination paper"}</button>
      {error && <p role="alert" className="mt-2 text-[13.5px] font-medium text-red-700">{error}</p>}
    </div>
  );
}

export function PaperActions({ materialId, guides }: { materialId: string; guides: { id: string; text: string; createdAt: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function guide() {
    setBusy(true); setMsg("");
    const r = await call(`/api/individual/scholar/papers/${materialId}/guide`);
    setBusy(false);
    if (!r.ok || r.json.withheld) { setMsg(r.json.message ?? r.json.error ?? "The guide could not be written."); return; }
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    const r = await call(`/api/individual/scholar/papers/${materialId}`, undefined, "DELETE");
    setBusy(false);
    if (r.ok) router.push(experienceHref("scholar", "study/apply")); else setMsg(r.json.error ?? "It could not be removed.");
  }
  return (
    <section aria-labelledby="guide-h" className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 id="guide-h" className="text-[16px] font-bold text-gray-900">Revision guide</h2>
      <p className="mt-1 text-[14px] text-gray-600">A short guide written from the suggested answers you have revealed and their evidence.</p>
      <button type="button" className={`${ghost} mt-3`} disabled={busy} onClick={guide}>{busy ? "Writing…" : guides.length ? "Write a new guide" : "Write a revision guide"}</button>
      {msg && <p role="alert" className="mt-2 text-[13.5px] font-medium text-red-700">{msg}</p>}
      {guides.slice(0, 1).map(g => (
        <div key={g.id} className="mt-4 rounded-xl bg-[var(--cmp-app-bg)] p-4">
          <p className="text-[12px] text-gray-500">Saved {new Date(g.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · AI-written from your saved answers</p>
          <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-gray-800"><Cited text={g.text} prefix={`g-${g.id.slice(0, 8)}`} /></p>
        </div>
      ))}
      <div className="mt-6 border-t border-gray-200 pt-4">
        {!confirm ? <button type="button" className={`${link} text-gray-600`} onClick={() => setConfirm(true)}>Stop studying this as a paper</button> : (
          <p className="text-[13.5px] text-gray-700">Its questions and saved answers will be removed. The material and any revision cards stay.{" "}
            <button type="button" className={`${link} text-red-700`} disabled={busy} onClick={remove}>Remove</button>{" "}
            <button type="button" className={link} onClick={() => setConfirm(false)}>Keep</button></p>
        )}
      </div>
    </section>
  );
}
