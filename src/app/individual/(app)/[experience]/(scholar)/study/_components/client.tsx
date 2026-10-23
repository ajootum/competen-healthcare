"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SCHOLAR } from "@/lib/individual/experiences";
import { sourceHref, studyHref } from "./question-view";
import { AI_LABEL, ALLOWED_MIME, CONSENT_NOTICE, DOCX_MIME, MARKED_AGAINST_NOTES, MAX_UPLOAD_BYTES, PDF_MIME, PERSONAL_CASE_LABEL, PII_WARNING, QUESTION_MAX, SOURCE_NOTICE } from "@/lib/individual/scholar/config";

// The interactive pieces of My Learning. Each one calls a gate-3 API route and shows what the route says,
// including its refusals, in words. Nothing here decides access or ownership: the routes do, by the
// caller's own id.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;


async function post(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

function ErrorLine({ text }: { text: string }) {
  return text ? <p role="alert" className="mt-3 text-[13.5px] font-medium text-red-700">{text}</p> : null;
}

/** The label every AI output carries, in the position the output is read. */
export function AiBadge() {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-900">
      <span aria-hidden>✦</span>{AI_LABEL}
    </p>
  );
}

// ── CONSENT ────────────────────────────────────────────────────────────────────────────────────────

export function ConsentPanel({ granted, grantedAt, revokedAt }: { granted: boolean; grantedAt: string | null; revokedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function set(grant: boolean) {
    setBusy(true); setError("");
    const r = await post("/api/individual/scholar/consent", { grant });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your choice could not be saved."); return; }
    router.refresh();
  }
  // Owner review P1.7: simpler, not weaker. The full notice is still on screen at the moment of agreeing,
  // the agreement is still its own click, and turning it off is always one click away.
  const [reviewing, setReviewing] = useState(false);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const notice = (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-gray-700">
      {CONSENT_NOTICE.map(l => <li key={l}>{l}</li>)}
    </ul>
  );
  return (
    <section aria-labelledby="consent-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="consent-h" className="text-[16px] font-bold text-gray-900">AI help with your notes</h2>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${granted ? "bg-emerald-50 text-emerald-800" : "bg-gray-100 text-gray-700"}`}>
          {granted ? "On" : "Off"}
        </span>
      </div>
      {granted ? (
        <>
          <p className="mt-2 text-[13.5px] text-gray-700">
            Explanations and practice questions are on{grantedAt ? ` (since ${date(grantedAt)})` : ""}. Only the passages you ask about are sent to Competen&apos;s AI provider, and only when you ask.
          </p>
          <details className="mt-2 text-[13px] text-gray-600">
            <summary className={`cursor-pointer font-semibold text-gray-700 ${focusRing}`}>What is sent, and what is kept?</summary>
            {notice}
          </details>
          <button type="button" className={`${ghost} mt-3`} disabled={busy} onClick={() => set(false)}>{busy ? "Saving…" : "Turn off"}</button>
        </>
      ) : (
        <>
          <p className="mt-2 text-[13.5px] text-gray-700">
            {revokedAt ? `Off since ${date(revokedAt)}. ` : ""}Turn it on to get explanations and practice questions from your notes. You can upload and read your material without it.
          </p>
          {!reviewing ? (
            <button type="button" className={`${btn} mt-3`} style={{ background: accent }} onClick={() => setReviewing(true)}>Review and turn on</button>
          ) : (
            <div className="mt-2 rounded-xl bg-gray-50 p-3">
              <p className="text-[13px] font-semibold text-gray-800">Before you turn it on:</p>
              {notice}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btn} style={{ background: accent }} disabled={busy} onClick={() => set(true)}>{busy ? "Saving…" : "I agree, turn on AI help"}</button>
                <button type="button" className={ghost} disabled={busy} onClick={() => setReviewing(false)}>Not now</button>
              </div>
            </div>
          )}
        </>
      )}
      <ErrorLine text={error} />
    </section>
  );
}

/** Owner review P0.2: what a source-derived answer is, and is not, at the place it is read. */
export function SourceNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`flex gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-amber-950 ${compact ? "text-[12px]" : "text-[12.5px]"}`}>
      <span aria-hidden className="font-bold">!</span>
      <span>{SOURCE_NOTICE}</span>
    </p>
  );
}

// ── UPLOAD ─────────────────────────────────────────────────────────────────────────────────────────

export function UploadPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [attested, setAttested] = useState(false);
  const [stage, setStage] = useState<"" | "uploading" | "reading">("");
  const [error, setError] = useState("");
  const mime = file ? (file.type === PDF_MIME || /\.pdf$/i.test(file.name) ? PDF_MIME : file.type === DOCX_MIME || /\.docx$/i.test(file.name) ? DOCX_MIME : file.type) : "";

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !attested || stage) return;
    setError("");
    if (!(ALLOWED_MIME as readonly string[]).includes(mime)) { setError("Upload a PDF or a Word (.docx) file."); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setError(`Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`); return; }
    setStage("uploading");
    const slot = await post("/api/individual/scholar/uploads", { mime, size: file.size, piiAttested: true });
    if (!slot.ok) { setStage(""); setError(slot.json.error ?? "The upload could not be started."); return; }
    const { error: upErr } = await createClient().storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, file, { contentType: mime });
    if (upErr) { setStage(""); setError("The file could not be uploaded. Check your connection and try again."); return; }
    setStage("reading");
    const done = await post("/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime, fileName: file.name, piiAttested: true });
    setStage("");
    if (!done.ok) { setError(done.json.error ?? "Your material could not be read."); return; }
    router.push(studyHref(done.json.id));
    router.refresh();
  }

  return (
    <form onSubmit={upload} aria-labelledby="upload-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="upload-h" className="text-[16px] font-bold text-gray-900">Upload study material</h2>
      <p className="mt-1 text-[13.5px] text-gray-600">PDF or Word (.docx), up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB. The text is read on Competen&apos;s servers and kept private to you.</p>
      <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13.5px] leading-relaxed text-amber-950">
        <span className="font-bold">No patient information. </span>{PII_WARNING}
      </p>
      <label htmlFor="scholar-file" className="mt-4 block text-[14px] font-semibold text-gray-900">File</label>
      <input id="scholar-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={e => setFile(e.target.files?.[0] ?? null)}
        className={`mt-1.5 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-800 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:font-semibold ${focusRing}`} />
      <label className="mt-4 flex items-start gap-3 text-[14px] text-gray-800">
        <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
        <span>I confirm this file contains no information that could identify a patient.</span>
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={btn} style={{ background: accent }} disabled={!file || !attested || !!stage}>
          {stage === "uploading" ? "Uploading…" : stage === "reading" ? "Reading your file…" : "Upload"}
        </button>
        {stage === "reading" && <span className="text-[13px] text-gray-500" aria-live="polite">Extracting text and page numbers. A long PDF can take a little while.</span>}
      </div>
      <ErrorLine text={error} />
      <p className="mt-3 text-[12px] text-gray-500">Competen also checks the text for NHS numbers, labelled dates of birth and hospital numbers, and will not keep a file that has them. That check cannot find everything, which is why your confirmation is needed.</p>
    </form>
  );
}

// ── UNDERSTAND ─────────────────────────────────────────────────────────────────────────────────────

type Source = { tag: string; chunkId: string; materialId: string; citation: string; excerpt: string };
type Explained = { q: string; answer?: string; message?: string; sources: Source[]; provenance?: { model: string; promptVersion: string } };


export function ExplainPanel({ materialId, consent, title = "Ask your notes", hint }: { materialId?: string; consent: boolean; title?: string; hint?: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Explained[]>([]);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    const r = await post("/api/individual/scholar/explain", { question: text, materialId });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "No explanation could be produced."); return; }
    setItems(list => [{ q: text, answer: r.json.answer, message: r.json.message, sources: r.json.sources ?? [], provenance: r.json.provenance }, ...list]);
    setQ("");
  }
  return (
    <section aria-labelledby="explain-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="explain-h" className="text-[16px] font-bold text-gray-900">{title}</h2>
      <p className="mt-1 text-[13.5px] text-gray-600">{hint ?? "Explanations use only your uploaded material and cite the page or section each point came from. They are not saved."}</p>
      {!consent ? (
        <p className="mt-3 rounded-xl bg-gray-50 px-3.5 py-3 text-[13.5px] text-gray-700">Turn on AI help (in My Learning) to ask for explanations.</p>
      ) : (
        <form onSubmit={ask} className="mt-3">
          <label htmlFor={`explain-q-${materialId ?? "all"}`} className="sr-only">Your question</label>
          <textarea id={`explain-q-${materialId ?? "all"}`} rows={2} maxLength={QUESTION_MAX} value={q} onChange={e => setQ(e.target.value)}
            placeholder="For example: explain the stages of acute kidney injury"
            className={`w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] text-gray-900 ${focusRing}`} />
          <button type="submit" className={`${btn} mt-2`} style={{ background: accent }} disabled={busy || !q.trim()}>{busy ? "Reading your notes…" : "Explain"}</button>
        </form>
      )}
      <ErrorLine text={error} />
      <div aria-live="polite" className="mt-4 space-y-4">
        {items.map((it, i) => <ExplanationView key={items.length - i} item={it} />)}
      </div>
    </section>
  );
}

function ExplanationView({ item }: { item: Explained }) {
  return (
    <article className="rounded-xl border border-gray-200 p-4">
      <p className="text-[12.5px] font-semibold text-gray-500">You asked</p>
      <p className="text-[14.5px] text-gray-900">{item.q}</p>
      {item.answer ? (
        <>
          <div className="mt-3"><AiBadge /></div>
          <div className="mt-2 whitespace-pre-wrap text-[14.5px] leading-relaxed text-gray-800">{item.answer}</div>
          <div className="mt-3"><SourceNotice /></div>
        </>
      ) : (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-[14px] text-gray-800">{item.message}</p>
      )}
      {item.sources.length > 0 && (
        <div className="mt-3">
          <p className="text-[12.5px] font-semibold text-gray-600">{item.answer ? "Sources in your notes" : "Passages it was given"}</p>
          <ul className="mt-1 space-y-1">
            {item.sources.map(s => (
              <li key={s.tag} className="text-[13px] text-gray-700">
                <span className="font-mono text-[12px] font-bold" style={{ color: accent }}>[{s.tag}]</span>{" "}
                <Link href={sourceHref(s.materialId, s.chunkId)} className={`underline underline-offset-2 hover:text-gray-900 ${focusRing}`}>{s.citation}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.provenance && <p className="mt-2 text-[11.5px] text-gray-400">Model {item.provenance.model} · prompt {item.provenance.promptVersion}</p>}
    </article>
  );
}

/** Per-section actions on a material page: explain it, or write questions from it. */
export function ChunkActions({ chunkId, consent }: { chunkId: string; consent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "explain" | "mcq" | "case">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [explained, setExplained] = useState<Explained | null>(null);
  if (!consent) return null;
  async function explain() {
    setBusy("explain"); setError(""); setNote("");
    const q = "Explain this section clearly, as a tutor would.";
    const r = await post("/api/individual/scholar/explain", { question: q, chunkId });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "No explanation could be produced."); return; }
    setExplained({ q: "Explain this section", answer: r.json.answer, message: r.json.message, sources: r.json.sources ?? [], provenance: r.json.provenance });
  }
  async function questions(kind: "mcq" | "case") {
    setBusy(kind); setError(""); setNote("");
    const r = await post("/api/individual/scholar/questions", { chunkId, kind });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "No questions could be written."); return; }
    if (!r.json.created) { setNote(r.json.message); return; }
    setNote(`${r.json.created} ${kind === "case" ? "case " : ""}question${r.json.created === 1 ? "" : "s"} added${r.json.dropped ? ` (${r.json.dropped} dropped by the grounding check)` : ""}. ${kind === "case" ? "Find them under Apply." : "Answer them below."}`);
    router.refresh();
  }
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ghost} disabled={!!busy} onClick={explain}>{busy === "explain" ? "Explaining…" : "Explain this section"}</button>
        <button type="button" className={ghost} disabled={!!busy} onClick={() => questions("mcq")}>{busy === "mcq" ? "Writing…" : "Practice questions"}</button>
        <button type="button" className={ghost} disabled={!!busy} onClick={() => questions("case")}>{busy === "case" ? "Writing…" : "Case question"}</button>
      </div>
      <ErrorLine text={error} />
      {note && <p aria-live="polite" className="mt-2 text-[13.5px] text-gray-700">{note}</p>}
      {explained && <div className="mt-3"><ExplanationView item={explained} /></div>}
    </div>
  );
}

// ── ASSESS AND APPLY ───────────────────────────────────────────────────────────────────────────────

export type QuestionView = {
  id: string; kind: "mcq" | "case"; stem: string; options: string[]; materialId: string; materialTitle: string; citation: string;
  model: string; promptVersion: string; latest: { correct: boolean } | null;
};
type Feedback = { correct: boolean; correctIndex: number; rationale: string; source: { quote: string; citation: string; materialId: string }; card: "created" | "reset" | null };

export function QuestionCard({ q, index, chunkId }: { q: QuestionView; index: number; chunkId?: string }) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fb, setFb] = useState<Feedback | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (choice === null || busy) return;
    setBusy(true); setError("");
    const r = await post("/api/individual/scholar/attempts", { questionId: q.id, chosenIndex: choice });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your answer could not be saved."); return; }
    setFb(r.json as Feedback);
    router.refresh();
  }
  const letter = (i: number) => String.fromCharCode(65 + i);
  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* Owner review P0.5: a personal practice case says so where it is read. */}
        {q.kind === "case" && (
          <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[11.5px] font-semibold text-gray-700">{PERSONAL_CASE_LABEL}</span>
        )}
        {q.latest && !fb && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${q.latest.correct ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
            Last time: {q.latest.correct ? "matched your notes" : "did not match your notes"}
          </span>
        )}
      </div>
      <fieldset disabled={!!fb}>
        <legend className="text-[15px] font-semibold leading-relaxed text-gray-900">
          <span className="mr-1 text-gray-500">{index}.</span>{q.stem}
        </legend>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {q.options.map((o, i) => {
            const state = fb ? (i === fb.correctIndex ? "right" : i === choice ? "wrong" : "") : "";
            return (
              <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${state === "right" ? "border-emerald-500 bg-emerald-50" : state === "wrong" ? "border-red-400 bg-red-50" : choice === i ? "border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>
                <input type="radio" name={`q-${q.id}`} checked={choice === i} onChange={() => setChoice(i)} className="mt-1 h-4 w-4 shrink-0" />
                <span><span className="font-semibold">{letter(i)}.</span> {o}
                  {state === "right" && <span className="ml-2 text-[12.5px] font-bold text-emerald-800">What your notes say</span>}
                  {state === "wrong" && <span className="ml-2 text-[12.5px] font-bold text-red-800">Your answer</span>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {!fb && <button type="submit" className={`${btn} mt-3`} style={{ background: accent }} disabled={choice === null || busy}>{busy ? "Checking…" : "Check answer"}</button>}
      <ErrorLine text={error} />
      {fb && (
        <div aria-live="polite" className={`mt-4 rounded-xl border p-4 ${fb.correct ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
          {/* Owner review P0.2: right or wrong against the notes, never presented as clinical truth. */}
          <p className={`text-[14.5px] font-bold ${fb.correct ? "text-emerald-900" : "text-red-900"}`}>
            {fb.correct ? "That matches your notes." : `Your notes support ${letter(fb.correctIndex)}.`}
          </p>
          <p className="text-[12px] text-gray-600">{MARKED_AGAINST_NOTES}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-800">{fb.rationale}</p>
          <blockquote className="mt-3 border-l-4 pl-3 text-[13.5px] italic text-gray-700" style={{ borderColor: accent }}>“{fb.source.quote}”</blockquote>
          <p className="mt-1 text-[12.5px] text-gray-600">From your notes: <Link href={chunkId ? sourceHref(fb.source.materialId, chunkId) : studyHref(fb.source.materialId)} className={`underline underline-offset-2 ${focusRing}`}>{fb.source.citation}</Link></p>
          {fb.card && <p className="mt-2 text-[13px] font-semibold text-gray-800">{fb.card === "created" ? "Added to your review cards. It is due today in Revise." : "Its review card has gone back to the start of its schedule, so it comes back today."}</p>}
          <div className="mt-3"><SourceNotice compact /></div>
          <button type="button" className={`${ghost} mt-3`} onClick={() => { setFb(null); setChoice(null); }}>Answer again</button>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-gray-500">{AI_LABEL} · {q.citation} · model {q.model} · prompt {q.promptVersion}</p>
    </form>
  );
}

// ── REVISE ─────────────────────────────────────────────────────────────────────────────────────────

export type CardView = { id: string; stem: string; answer: string; rationale: string; quote: string; citation: string; href: string };

const GRADES = [
  { q: 0, label: "Blank", hint: "No idea" },
  { q: 2, label: "Hard", hint: "Got it wrong" },
  { q: 3, label: "Okay", hint: "Right, with effort" },
  { q: 4, label: "Good", hint: "Right" },
  { q: 5, label: "Easy", hint: "Instant" },
];

export function CardReview({ cards }: { cards: CardView[] }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Owner review P1.8: every grade says what it did, and the session ends with what happens next.
  const [done, setDone] = useState<{ stem: string; next: string; longInterval: boolean }[]>([]);
  const card = cards[i];
  const when = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (!card) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <p className="text-[15px] font-semibold text-gray-900">{done.length ? `Done for today: you reviewed ${done.length} card${done.length === 1 ? "" : "s"}.` : "Nothing is due."}</p>
        {done.length > 0 && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {done.map((d, k) => (
              <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-gray-800">{d.stem}</span>
                <span className="font-semibold text-gray-700 tabular-nums">{d.longInterval ? "long interval" : `back ${d.next}`}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className={`${ghost} mt-4`} onClick={() => router.refresh()}>Check again</button>
      </div>
    );
  }
  async function grade(q: number) {
    setBusy(true); setError("");
    const r = await post(`/api/individual/scholar/cards/${card.id}`, { quality: q });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your review could not be saved."); return; }
    setDone(list => [...list, { stem: card.stem, next: when(r.json.nextReviewAt), longInterval: r.json.status === "mastered" }]);
    setShown(false); setI(n => n + 1);
    // After the last card, refresh the server parts (the due count on the Revise tab). The summary is local state and stays.
    if (i + 1 >= cards.length) router.refresh();
  }
  const last = done.at(-1);
  return (
    <section aria-label="Review card" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <p className="text-[12.5px] font-semibold text-gray-500 tabular-nums">Card {i + 1} of {cards.length}</p>
        <div className="h-1.5 flex-1 rounded-full bg-gray-100" aria-hidden>
          <div className="h-1.5 rounded-full" style={{ width: `${(i / cards.length) * 100}%`, background: accent }} />
        </div>
      </div>
      {last && <p aria-live="polite" className="mt-2 text-[12.5px] text-gray-600">Previous card: {last.longInterval ? "moved to a long interval (60+ days)" : `comes back ${last.next}`}.</p>}
      <p className="mt-3 text-[16px] font-semibold leading-relaxed text-gray-900">{card.stem}</p>
      <p className="mt-1 text-[12.5px] text-gray-500">Try to recall the answer before you reveal it.</p>
      {!shown ? (
        <button type="button" className={`${btn} mt-4`} style={{ background: accent }} onClick={() => setShown(true)}>Show answer</button>
      ) : (
        <>
          <div className="mt-4 rounded-xl bg-gray-50 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">What your notes say</p>
            <p className="mt-1 text-[14.5px] font-bold text-gray-900">{card.answer}</p>
            <p className="mt-1 text-[14px] text-gray-800">{card.rationale}</p>
            <blockquote className="mt-2 border-l-4 pl-3 text-[13.5px] italic text-gray-700" style={{ borderColor: accent }}>“{card.quote}”</blockquote>
            <p className="mt-1 text-[12.5px] text-gray-600">From your notes: <Link href={card.href} className={`underline underline-offset-2 ${focusRing}`}>{card.citation}</Link></p>
            <div className="mt-3"><SourceNotice compact /></div>
          </div>
          <fieldset className="mt-4" disabled={busy}>
            <legend className="text-[14px] font-semibold text-gray-900">How well did you remember it?</legend>
            <p className="text-[12.5px] text-gray-500">Your grade sets when it comes back: sooner if it was hard, later if it was easy.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {GRADES.map(g => (
                <button key={g.q} type="button" onClick={() => grade(g.q)} className={`${ghost} flex-col !px-2`}>
                  <span>{g.label}</span><span className="text-[11.5px] font-normal text-gray-500">{g.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <ErrorLine text={error} />
    </section>
  );
}

// ── ERASURE ────────────────────────────────────────────────────────────────────────────────────────

export function DeleteMaterial({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function del() {
    setBusy(true); setError("");
    const r = await post(`/api/individual/scholar/materials/${id}`, undefined, "DELETE");
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "That material could not be deleted."); return; }
    router.push(studyHref()); router.refresh();
  }
  if (!confirming) return <button type="button" className={ghost} onClick={() => setConfirming(true)}>Delete…</button>;
  return (
    <div role="group" aria-label="Confirm deletion" className="rounded-xl border border-red-300 bg-red-50 p-3">
      <p className="text-[13.5px] text-red-950">Delete “{title}”, its sections, the questions written from it, your answers and its review cards? This cannot be undone.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={`${btn} bg-red-700`} disabled={busy} onClick={del}>{busy ? "Deleting…" : "Delete permanently"}</button>
        <button type="button" className={ghost} disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
      </div>
      <ErrorLine text={error} />
    </div>
  );
}

export function EraseAll({ count }: { count: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  async function erase(e: React.FormEvent) {
    e.preventDefault();
    if (text !== "ERASE") return;
    setBusy(true); setError("");
    const r = await post("/api/individual/scholar/erase", { confirm: "ERASE" });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your material could not be erased."); return; }
    setDone(`Erased ${r.json.erased} material${r.json.erased === 1 ? "" : "s"} and everything made from them.`); setText("");
    router.refresh();
  }
  return (
    <form onSubmit={erase} className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 className="text-[16px] font-bold text-gray-900">Erase all my study material</h2>
      <p className="mt-1 text-[13.5px] text-gray-600">
        Permanently deletes every file you uploaded ({count} now), their sections, every question written from them, your answers and your review cards.
        Your record of whether AI processing is on or off is kept, because it records a choice you made, not your material.
      </p>
      <label htmlFor="erase-confirm" className="mt-3 block text-[13.5px] font-semibold text-gray-800">Type ERASE to confirm</label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input id="erase-confirm" value={text} onChange={e => setText(e.target.value)} autoComplete="off"
          className={`min-h-[44px] w-40 rounded-xl border border-gray-300 px-3 text-[15px] ${focusRing}`} />
        <button type="submit" className={`${btn} bg-red-700`} disabled={busy || text !== "ERASE"}>{busy ? "Erasing…" : "Erase everything"}</button>
      </div>
      <ErrorLine text={error} />
      {done && <p aria-live="polite" className="mt-2 text-[13.5px] font-medium text-gray-800">{done}</p>}
    </form>
  );
}
