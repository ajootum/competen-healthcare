"use client";

import { useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import {
  GUIDANCE_TYPES, GUIDANCE_STATES, GUIDANCE_STATE_SWATCH, GUIDANCE_ROLE_REALITY,
  GUIDANCE_SECTIONS_AUTHORED, GUIDANCE_SECTIONS_DERIVED, GUIDANCE_ROUTE,
} from "@/lib/practice/knowledge-constants";

// The Guidance Library -- CPR-KS-001 section 8, as much of it as this build can honestly answer.
//
// ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN. Each count carries the filter that produces it,
// and the counts are taken off the rows already read rather than by a second query with a different
// filter -- two reads is how a figure and the list it describes come to disagree.
//
// ⚠ SIX OF SECTION 8's EIGHT FACETS WORK AND TWO DO NOT, AND THE TWO ARE SHOWN AS NOT OFFERED WITH THE
// REASON. A filter control that returns whatever it likes is worse than a missing one, because somebody
// narrows a search with it and believes the result.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  library: {
    state: "ok" | "absent" | "failed";
    detail: string | null;
    items: any[];
    counts: { key: string; label: string; total: number; href: string }[];
    reviewOverdue: any[];
    facets: { key: string; label: string; state: string; detail: string; wouldNeed: string | null }[];
    notMonitored: { headline: string; detail: string; onPaper: string };
  };
  moduleName: string;
  libraryName: string;
  canManage: boolean;
  filters: { q: string; type: string; status: string; specialty: string; tag: string; overdue: boolean };
};

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function GuidanceLibraryView({ library, moduleName, libraryName, canManage, filters }: Props) {
  const [composing, setComposing] = useState(false);

  const items = filters.overdue
    ? library.items.filter(i => library.reviewOverdue.some(r => r.id === i.id))
    : library.items;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[19px] font-bold text-gray-900">{moduleName}</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-gray-600">
          Guidelines, policies, protocols, standard operating procedures, work instructions and
          standards &mdash; written here, approved by a colleague, published with a date on them, and
          brought back for review.
        </p>
      </header>

      {/* ⚠ THE STANDING NOTICE. Not a footnote and not a settings-page disclaimer: it is the first thing
          on the library and it is repeated on every document and on the printed page. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{library.notMonitored.headline}
        </p>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">
          {library.notMonitored.detail}
        </p>
      </section>

      {/* ── STATE 1: the store is not there ────────────────────────────────────────────────────── */}
      {library.state === "absent" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <h2 className="text-[13px] font-bold text-amber-900">
            {moduleName} has nowhere to store a document yet.
          </h2>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-amber-900/80">
            The tables this module writes to have not been created in this deployment, so there is
            nothing to list and nothing that could be saved. This is a fact about the deployment rather
            than about your practice, and nothing you configure here will change it.
          </p>
          {library.detail && (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-amber-900">
              {library.detail}
            </p>
          )}
          <p className="mt-2 text-[12px] text-amber-900/80">
            Everything else on this page &mdash; the eight document types, the ten sections, the five
            states and the publication checks &mdash; is real and is shown below, so that what this
            module will do is visible before it can do it.
          </p>
        </section>
      )}

      {/* ── STATE 2: something could not be read. NOT an empty library. ─────────────────────────── */}
      {library.state === "failed" && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <h2 className="text-[13px] font-bold text-rose-900">The guidance library could not be read.</h2>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-rose-900/80">
            A failed read is not an empty shelf. Nothing is listed below because nothing is known, not
            because this practice has written nothing.
          </p>
          {library.detail && (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-rose-900">
              {library.detail}
            </p>
          )}
        </section>
      )}

      {/* ── STATE 3: real rows ──────────────────────────────────────────────────────────────────── */}
      {library.state === "ok" && (
        <>
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {library.counts.map(c => (
              <a key={c.key} href={c.href}
                className={`${CARD} block p-3 transition hover:border-[var(--cp-primary)]/40 hover:shadow-sm`}>
                <p className="text-[20px] font-bold leading-none text-gray-900">{c.total}</p>
                <p className="mt-1.5 text-[11.5px] font-semibold text-gray-600">{c.label}</p>
              </a>
            ))}
          </section>

          <section className={`${CARD} p-3`}>
            <form method="get" action={GUIDANCE_ROUTE} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Search</span>
                <input name="q" defaultValue={filters.q} placeholder="Title, reference or summary" className={FIELD} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Type</span>
                <select name="type" defaultValue={filters.type} className={FIELD}>
                  <option value="">Any type</option>
                  {GUIDANCE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Status</span>
                <select name="status" defaultValue={filters.status} className={FIELD}>
                  <option value="">Any status</option>
                  {GUIDANCE_STATES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Specialty</span>
                <input name="specialty" defaultValue={filters.specialty} className={FIELD} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Tag</span>
                <div className="flex gap-1.5">
                  <input name="tag" defaultValue={filters.tag} className={FIELD} />
                  <button type="submit" className={`${BUTTON.primary} shrink-0 rounded-lg px-3 text-[12px] font-semibold`}>Filter</button>
                </div>
              </label>
            </form>

            {/* ⚠ THE FACETS THAT ARE NOT OFFERED, SAID OUT LOUD RATHER THAN LEFT OUT. */}
            {library.facets.filter(f => f.state === "absent").length > 0 && (
              <div className="mt-2.5 border-t border-gray-100 pt-2.5">
                {library.facets.filter(f => f.state === "absent").map(f => (
                  <p key={f.key} className="text-[11.5px] leading-relaxed text-slate-500">
                    <span aria-hidden className="mr-1">◌</span>
                    <span className="font-semibold text-slate-700">{f.label} &mdash; not offered.</span>{" "}
                    {f.detail.replace(/^⚠ NOT OFFERED\.\s*/, "")}
                    {f.wouldNeed && <span className="text-slate-400"> It would take: {f.wouldNeed}</span>}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className={`${CARD} overflow-hidden`}>
            <h2 className="border-b border-gray-100 px-3.5 py-2 text-[12.5px] font-bold text-gray-900">
              {libraryName}
              <span className="ml-2 font-normal text-gray-500">
                {items.length === library.items.length
                  ? `${items.length} document${items.length === 1 ? "" : "s"}`
                  : `${items.length} of ${library.items.length}`}
              </span>
            </h2>
            {items.length === 0 ? (
              <p className="p-6 text-center text-[12.5px] text-gray-500">
                {library.items.length === 0
                  ? "This practice has not written any guidance yet."
                  : "Nothing matches those filters. There are documents here under other filters."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(d => {
                  const swatch = GUIDANCE_STATE_SWATCH[d.status] ?? GUIDANCE_STATE_SWATCH.draft;
                  return (
                    <li key={d.id}>
                      <a href={d.href} className="block px-3.5 py-2.5 transition hover:bg-gray-50">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-[11.5px] text-gray-500">{d.code}</span>
                          <span className="text-[13px] font-semibold text-gray-900">{d.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${swatch.chip}`}>
                            {d.stateLabel}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10.5px] font-semibold text-gray-600">
                            {d.typeLabel}
                          </span>
                          <span className="text-[11px] text-gray-400">v{d.version}</span>
                        </div>
                        {d.summary && <p className="mt-0.5 line-clamp-1 text-[12px] text-gray-600">{d.summary}</p>}
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          {d.authorName ? `Written by ${d.authorName}` : "Author not recorded"}
                          {d.specialty ? ` · ${d.specialty}` : ""}
                          {d.effective_from ? ` · In force from ${d.effective_from}` : ""}
                          {d.review_on ? ` · Review by ${d.review_on}` : ""}
                          {(d.tags ?? []).length ? ` · ${(d.tags as string[]).join(", ")}` : ""}
                        </p>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {/* ── AUTHORING ───────────────────────────────────────────────────────────────────────────── */}
      {canManage && (
        library.state === "ok" ? (
          composing
            ? <NewGuidance onClose={() => setComposing(false)} />
            : <button onClick={() => setComposing(true)}
                className={`${BUTTON.primary} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
                Write a new document
              </button>
        ) : (
          // ⚠ A CONTROL THAT CANNOT RUN MUST SAY SO. Not hidden, not disabled with no explanation.
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
            <p className="text-[12.5px] font-semibold text-slate-700">
              <span aria-hidden className="mr-1.5">◌</span>Writing a document is not available.
            </p>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">
              {library.state === "absent"
                ? "There is no store behind this action in this deployment, so the button is not shown rather than shown and refused. You hold the permission; the product does not yet hold the table."
                : "Something needed to read this library failed, and writing into a store this page could not read would be writing blind."}
            </p>
          </div>
        )
      )}

      {/* ── WHAT THIS MODULE IS, VISIBLE WHETHER OR NOT THERE IS ANYTHING IN IT ─────────────────── */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">The ten sections of a guidance document</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Eight are written. The last two are read from the record &mdash; the dates on the document
            and the approval decision itself &mdash; so they cannot claim an approval that did not
            happen or a review date that was never set.
          </p>
          <ol className="mt-2 space-y-1">
            {GUIDANCE_SECTIONS_AUTHORED.map(s => (
              <li key={s.key} className="flex gap-2 text-[12px]">
                <span className="w-4 shrink-0 text-right text-gray-400">{s.position}</span>
                <span className="font-semibold text-gray-800">{s.heading}</span>
                {s.required && <span className="rounded bg-rose-50 px-1.5 text-[10px] font-bold text-rose-700">required</span>}
              </li>
            ))}
            {GUIDANCE_SECTIONS_DERIVED.map((s, i) => (
              <li key={s.key} className="flex gap-2 text-[12px]">
                <span className="w-4 shrink-0 text-right text-gray-400">{9 + i}</span>
                <span className="font-semibold text-slate-600">{s.heading}</span>
                <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">read from the record</span>
              </li>
            ))}
          </ol>
        </div>

        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Who can do what</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            The specification names five roles. This is what each one actually is here, because a
            permission model somebody relies on has to be the one that runs.
          </p>
          <ul className="mt-2 space-y-1.5">
            {GUIDANCE_ROLE_REALITY.map(r => (
              <li key={r.role} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{r.role}</span>
                <span className="text-gray-600"> &mdash; {r.how}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function NewGuidance({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState(GUIDANCE_TYPES[0].code);
  const [summary, setSummary] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = GUIDANCE_TYPES.find(t => t.code === docType);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/knowledge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code, title, docType,
        summary: summary || null, specialty: specialty || null,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      }),
    });
    const data = await res.json().catch(() => ({}));
    // ⚠ BOTH SHAPES, AND THE MIDDLE TERM IS THE ONE THAT MATTERED. Engine refusals arrive as
    // `{error: {code, message}}`, but every denial from requirePracticeContext -- Forbidden, Not found,
    // No Practice workspace -- arrives as `{error: "<string>"}`. Reading only `.error.message` threw all
    // of those away and printed "That did not work.", which is what a practice-wide 403 looked like on
    // 2026-08-10: no code, no reason, nothing to search for. The other 26 consoles in this product
    // already carried the middle term; this one did not.
    if (!res.ok) {
      setError(data?.error?.message ?? data?.error
        ?? `That did not work, and the practice gave no reason (HTTP ${res.status}).`);
      setBusy(false); return;
    }
    window.location.href = `${GUIDANCE_ROUTE}/${data.id}`;
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-3.5">
      <h2 className="text-[13px] font-bold text-gray-900">A new guidance document</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">
        It starts as a draft with its eight sections already in place, so its structure does not depend
        on what anybody remembered to add.
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Reference</span>
          <input value={code} onChange={e => setCode(e.target.value)} required maxLength={40}
            placeholder="SOP-014" className={FIELD} />
          <span className="mt-0.5 block text-[10.5px] text-gray-400">
            What people will quote. Only one published document may hold it at a time.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Type</span>
          <select value={docType} onChange={e => setDocType(e.target.value)} className={FIELD}>
            {GUIDANCE_TYPES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
          {chosen && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{chosen.meaning}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} className={FIELD} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Summary</span>
          <input value={summary} onChange={e => setSummary(e.target.value)} maxLength={600}
            placeholder="One line, for the person scanning the library" className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Specialty</span>
          <input value={specialty} onChange={e => setSpecialty(e.target.value)} className={FIELD} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Tags</span>
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="comma, separated" className={FIELD} />
        </label>
      </div>

      {error && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-800">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy}
          className={`${BUTTON.primary} rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>
          {busy ? "Creating…" : "Create the draft"}
        </button>
        <button type="button" onClick={onClose}
          className={`${BUTTON.quiet} rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold`}>
          Cancel
        </button>
      </div>
    </form>
  );
}
