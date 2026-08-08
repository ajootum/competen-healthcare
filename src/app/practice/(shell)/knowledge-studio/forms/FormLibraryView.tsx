"use client";

import { useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import {
  FORM_TYPES, FORM_TYPE_NOT_OFFERED, FORM_STATES, FORM_STATE_SWATCH, FORM_ROLE_REALITY,
  FORM_SUBJECTS, FORM_ROUTE, FORM_COMPONENTS, FORM_VALIDATIONS, FORM_OUTPUTS, FORM_KNOWN_GAPS,
  PRACTICE_FIELD_TYPES, REGISTRATION_FIELD_TYPE_CODES,
} from "@/lib/practice/form-constants";

// The Form Library -- CPR-KS-001 section 4 and as much of section 8 as this build can answer.
//
// ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN, and the question count on a row is `null` rather
// than 0 when the question read failed -- a nought beside a form that has twenty questions on it is a
// claim.
//
// ⚠ THE SEVEN COMPONENTS SECTION 4 ASKS FOR AND THIS DOES NOT HAVE ARE LISTED, not omitted. An author
// who writes a consent form has to find out that there is no signature BEFORE they write it.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  library: {
    state: "ok" | "absent" | "failed";
    detail: string | null;
    items: any[];
    counts: { key: string; label: string; total: number; href: string }[];
    reviewOverdue: any[];
    facets: { key: string; label: string; state: string; detail: string; wouldNeed: string | null }[];
    notVerified: { headline: string; detail: string; onPaper: string };
  };
  moduleName: string;
  libraryName: string;
  canManage: boolean;
  filters: { q: string; kind: string; status: string; specialty: string; tag: string; overdue: boolean };
};

const CARD = "rounded-xl border border-gray-200 bg-white";
const FIELD = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

export default function FormLibraryView({ library, moduleName, libraryName, canManage, filters }: Props) {
  const [composing, setComposing] = useState(false);

  const items = filters.overdue
    ? library.items.filter(i => library.reviewOverdue.some(r => r.id === i.id))
    : library.items;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[19px] font-bold text-gray-900">{moduleName}</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-gray-600">
          Assessments, referrals, consent, procedures, audits, research, questionnaires, surveys, risk
          assessments, inspections, incident reports and teaching &mdash; written here, approved by a
          colleague, put into use with a date on them, and filled in as often as they are needed. Each
          filling-in is kept as a completed form.
        </p>
      </header>

      {/* ⚠ THE STANDING NOTICE. Not a footnote and not a settings-page disclaimer: it is the first thing
          on the library, it is on every form, on the fill-in screen, on the completed form afterwards,
          and on the printed page. */}
      <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
        <p className="text-[12.5px] font-bold text-slate-800">
          <span aria-hidden className="mr-1.5">◌</span>{library.notVerified.headline}
        </p>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">
          {library.notVerified.detail}
        </p>
      </section>

      {/* ── STATE 1: the store is not there ────────────────────────────────────────────────────── */}
      {library.state === "absent" && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <h2 className="text-[13px] font-bold text-amber-900">
            {moduleName} has nowhere to store a form yet.
          </h2>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-amber-900/80">
            The tables this module writes to have not been created in this deployment, so there is nothing
            to list, nothing that could be saved, and nothing anybody could fill in. This is a fact about
            the deployment rather than about your practice, and nothing you configure here will change it.
          </p>
          {library.detail && (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-amber-900">
              {library.detail}
            </p>
          )}
          <p className="mt-2 text-[12px] text-amber-900/80">
            Everything else on this page &mdash; the thirteen kinds, the eleven question types, the five
            states and the publication checks &mdash; is real and is shown below, so that what this module
            will do is visible before it can do it.
          </p>
        </section>
      )}

      {/* ── STATE 2: something could not be read. NOT an empty library. ─────────────────────────── */}
      {library.state === "failed" && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <h2 className="text-[13px] font-bold text-rose-900">The form library could not be read.</h2>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-rose-900/80">
            A failed read is not an empty shelf. Nothing is listed below because nothing is known, not
            because this practice has written no forms.
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
            <form method="get" action={FORM_ROUTE} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Search</span>
                <input name="q" defaultValue={filters.q} placeholder="Title, reference or purpose" className={FIELD} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Kind</span>
                <select name="kind" defaultValue={filters.kind} className={FIELD}>
                  <option value="">Any kind</option>
                  {FORM_TYPES.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Status</span>
                <select name="status" defaultValue={filters.status} className={FIELD}>
                  <option value="">Any status</option>
                  {FORM_STATES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
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
                  ? `${items.length} form${items.length === 1 ? "" : "s"}`
                  : `${items.length} of ${library.items.length}`}
              </span>
            </h2>
            {items.length === 0 ? (
              <p className="p-6 text-center text-[12.5px] text-gray-500">
                {library.items.length === 0
                  ? "This practice has not written any forms yet."
                  : "Nothing matches those filters. There are forms here under other filters."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(d => {
                  const swatch = FORM_STATE_SWATCH[d.status] ?? FORM_STATE_SWATCH.draft;
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
                            {d.kindLabel}
                          </span>
                          <span className="text-[11px] text-gray-400">v{d.version}</span>
                        </div>
                        {d.purpose && <p className="mt-0.5 line-clamp-1 text-[12px] text-gray-600">{d.purpose}</p>}
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          {/* ⚠ null, NOT 0, when the question read failed. */}
                          {d.fieldCount === null
                            ? "Question count not read"
                            : `${d.fieldCount} question${d.fieldCount === 1 ? "" : "s"}`}
                          {d.subject === "patient" ? " · About one patient" : " · Not about a patient"}
                          {d.authorName ? ` · Written by ${d.authorName}` : ""}
                          {d.specialty ? ` · ${d.specialty}` : ""}
                          {d.effective_from ? ` · In use from ${d.effective_from}` : ""}
                          {d.review_on ? ` · Review by ${d.review_on}` : ""}
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
            ? <NewForm onClose={() => setComposing(false)} />
            : <button onClick={() => setComposing(true)}
                className={`${BUTTON.primary} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
                Write a new form
              </button>
        ) : (
          // ⚠ A CONTROL THAT CANNOT RUN MUST SAY SO. Not hidden, not disabled with no explanation.
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
            <p className="text-[12.5px] font-semibold text-slate-700">
              <span aria-hidden className="mr-1.5">◌</span>Writing a form is not available.
            </p>
            <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-600">
              {library.state === "absent"
                ? "There is no store behind this action in this deployment, so the button is not shown rather than shown and refused. You hold the permission; the product does not yet hold the tables."
                : "Something needed to read this library failed, and writing into a store this page could not read would be writing blind."}
            </p>
          </div>
        )
      )}

      {/* ── WHAT THIS MODULE IS, VISIBLE WHETHER OR NOT THERE IS ANYTHING IN IT ─────────────────── */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">The eleven kinds of question</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Nine of them are the ones this practice can already put on its patient registration form, and
            they are drawn by the same component and checked by the same rules in both places. Two are
            only on a form.
          </p>
          <ul className="mt-2 space-y-1.5">
            {PRACTICE_FIELD_TYPES.map(t => (
              <li key={t.code} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{t.label}</span>
                {!REGISTRATION_FIELD_TYPE_CODES.includes(t.code) && (
                  <span className="ml-1.5 rounded bg-sky-100 px-1.5 text-[10px] font-bold text-sky-800">forms only</span>
                )}
                <span className="text-gray-600"> &mdash; {t.meaning}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-3 border-t border-gray-100 pt-3 text-[12.5px] font-bold text-gray-900">
            What one completed form is about
          </h3>
          <ul className="mt-1.5 space-y-1">
            {FORM_SUBJECTS.map(s => (
              <li key={s.code} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{s.label}</span>
                <span className="text-gray-600"> &mdash; {s.meaning}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">What the specification asks for, and what is here</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Every component, every class of validation and every output is listed, including the seven
            that are not built. A capability quietly left off a list is one somebody assumes is there.
          </p>
          {[["Components", FORM_COMPONENTS], ["Validation", FORM_VALIDATIONS], ["Output", FORM_OUTPUTS]].map(
            ([group, list]) => (
              <div key={String(group)} className="mt-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{String(group)}</p>
                <ul className="mt-1 space-y-1.5">
                  {(list as { name: string; state: string; how: string }[]).map(c => (
                    <li key={c.name} className="text-[12px] leading-relaxed">
                      <span className={`font-semibold ${c.state === "absent" ? "text-slate-500" : "text-gray-800"}`}>
                        {c.name}
                      </span>
                      {c.state === "partial" && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">partly</span>
                      )}
                      {c.state === "absent" && (
                        <span className="ml-1.5 rounded bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700">not built</span>
                      )}
                      <span className="text-gray-600"> &mdash; {c.how}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>

        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Who can do what</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            The specification names five roles. This is what each one actually is here, because a
            permission model somebody relies on has to be the one that runs.
          </p>
          <ul className="mt-2 space-y-1.5">
            {FORM_ROLE_REALITY.map(r => (
              <li key={r.role} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{r.role}</span>
                <span className="text-gray-600"> &mdash; {r.how}</span>
              </li>
            ))}
          </ul>

          {/* ⚠ THE FOURTEENTH KIND, AND WHY IT IS NOT HERE. */}
          <h3 className="mt-3 border-t border-gray-100 pt-3 text-[12.5px] font-bold text-gray-900">
            {FORM_TYPE_NOT_OFFERED.label} are not written here
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{FORM_TYPE_NOT_OFFERED.why}</p>
          <a href={FORM_TYPE_NOT_OFFERED.whereItLives}
            className="mt-1 inline-block text-[12px] font-semibold text-gray-800 hover:underline">
            The patient registration form &rarr;
          </a>
        </div>

        {/* ⚠ THE GAPS, ON THE SCREEN. A gap recorded only in a commit message is one the next person
            rediscovers as a bug, and the person relying on this module is the one who needs to know. */}
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
          <h2 className="text-[13px] font-bold text-slate-800">
            <span aria-hidden className="mr-1.5">◌</span>What this does not do yet
          </h2>
          <ul className="mt-2 space-y-2">
            {FORM_KNOWN_GAPS.map(g => (
              <li key={g.gap} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-slate-700">{g.gap}</span>
                <span className="text-slate-600"> {g.why}</span>
                <span className="block text-slate-400">It would take: {g.wouldNeed}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function NewForm({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(FORM_TYPES[0].code);
  const [subject, setSubject] = useState(FORM_SUBJECTS[0].code);
  const [purpose, setPurpose] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = FORM_TYPES.find(k => k.code === kind);
  const chosenSubject = FORM_SUBJECTS.find(s => s.code === subject);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/forms", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code, title, kind, subject,
        purpose: purpose || null, specialty: specialty || null,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    window.location.href = `${FORM_ROUTE}/${data.id}`;
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-3.5">
      <h2 className="text-[13px] font-bold text-gray-900">A new form</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">
        It starts as a draft with no questions on it. There is no starter set, because there is no correct
        starter set for a consent form or an incident report and inventing one would be this product
        suggesting what to ask.
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Reference</span>
          <input value={code} onChange={e => setCode(e.target.value)} required maxLength={40}
            placeholder="CONS-01" className={FIELD} />
          <span className="mt-0.5 block text-[10.5px] text-gray-400">
            What people will quote. Only one form in use may hold it at a time.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Kind</span>
          <select value={kind} onChange={e => setKind(e.target.value)} className={FIELD}>
            {FORM_TYPES.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
          </select>
          {chosen && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{chosen.meaning}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} className={FIELD} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">What one completed form is about</span>
          <select value={subject} onChange={e => setSubject(e.target.value)} className={FIELD}>
            {FORM_SUBJECTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          {chosenSubject && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{chosenSubject.meaning}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Purpose</span>
          <input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={600}
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
