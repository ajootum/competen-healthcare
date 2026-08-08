"use client";

import { useState } from "react";
import { BUTTON } from "@/lib/practice/palette";
import {
  CHECKLIST_KINDS, CHECKLIST_STATES, CHECKLIST_STATE_SWATCH, CHECKLIST_ROLE_REALITY,
  CHECKLIST_SUBJECTS, CHECKLIST_ROUTE, CHECKLIST_ENGINE_CAPABILITIES, CHECKLIST_KNOWN_GAPS,
  CHECKLIST_RESPONSES,
} from "@/lib/practice/checklist-constants";

// The Checklist Library -- CPR-KS-001 Engine 5 and as much of section 8 as this build can answer.
//
// ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN, and the item count on a row is `null` rather than
// 0 when the item read failed -- a nought beside a checklist that has twenty items on it is a claim.
//
// ⚠ SIX OF SECTION 8's EIGHT FACETS WORK AND TWO DO NOT, and the two are shown as not offered with the
// reason. A filter control that returns whatever it likes is worse than a missing one.

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

export default function ChecklistLibraryView({ library, moduleName, libraryName, canManage, filters }: Props) {
  const [composing, setComposing] = useState(false);

  const items = filters.overdue
    ? library.items.filter(i => library.reviewOverdue.some(r => r.id === i.id))
    : library.items;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[19px] font-bold text-gray-900">{moduleName}</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-gray-600">
          Ward rounds, discharges, procedures, audits, clinics, inspections, equipment and CPD &mdash;
          written here, approved by a colleague, put into use with a date on them, and filled in as often
          as they are needed. Each filling-in is kept as a completion record.
        </p>
      </header>

      {/* ⚠ THE STANDING NOTICE. Not a footnote and not a settings-page disclaimer: it is the first thing
          on the library, it is on every checklist, on the run screen while somebody ticks, on the
          completion record afterwards, and on the printed page. */}
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
            {moduleName} has nowhere to store a checklist yet.
          </h2>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-amber-900/80">
            The tables this module writes to have not been created in this deployment, so there is
            nothing to list, nothing that could be saved, and nothing anybody could fill in. This is a
            fact about the deployment rather than about your practice, and nothing you configure here
            will change it.
          </p>
          {library.detail && (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-[11px] text-amber-900">
              {library.detail}
            </p>
          )}
          <p className="mt-2 text-[12px] text-amber-900/80">
            Everything else on this page &mdash; the nine kinds, the three answers, the five states and
            the publication checks &mdash; is real and is shown below, so that what this module will do
            is visible before it can do it.
          </p>
        </section>
      )}

      {/* ── STATE 2: something could not be read. NOT an empty library. ─────────────────────────── */}
      {library.state === "failed" && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <h2 className="text-[13px] font-bold text-rose-900">The checklist library could not be read.</h2>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-relaxed text-rose-900/80">
            A failed read is not an empty shelf. Nothing is listed below because nothing is known, not
            because this practice has written no checklists.
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
            <form method="get" action={CHECKLIST_ROUTE} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Search</span>
                <input name="q" defaultValue={filters.q} placeholder="Title, reference or purpose" className={FIELD} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Kind</span>
                <select name="kind" defaultValue={filters.kind} className={FIELD}>
                  <option value="">Any kind</option>
                  {CHECKLIST_KINDS.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-gray-500">Status</span>
                <select name="status" defaultValue={filters.status} className={FIELD}>
                  <option value="">Any status</option>
                  {CHECKLIST_STATES.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
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
                  ? `${items.length} checklist${items.length === 1 ? "" : "s"}`
                  : `${items.length} of ${library.items.length}`}
              </span>
            </h2>
            {items.length === 0 ? (
              <p className="p-6 text-center text-[12.5px] text-gray-500">
                {library.items.length === 0
                  ? "This practice has not written any checklists yet."
                  : "Nothing matches those filters. There are checklists here under other filters."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(d => {
                  const swatch = CHECKLIST_STATE_SWATCH[d.status] ?? CHECKLIST_STATE_SWATCH.draft;
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
                          {/* ⚠ null, NOT 0, when the item read failed. */}
                          {d.itemCount === null
                            ? "Item count not read"
                            : `${d.itemCount} item${d.itemCount === 1 ? "" : "s"}`}
                          {d.run_subject === "patient" ? " · About one patient" : " · Not about a patient"}
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
            ? <NewChecklist onClose={() => setComposing(false)} />
            : <button onClick={() => setComposing(true)}
                className={`${BUTTON.primary} rounded-lg px-3.5 py-2 text-[12.5px] font-semibold`}>
                Write a new checklist
              </button>
        ) : (
          // ⚠ A CONTROL THAT CANNOT RUN MUST SAY SO. Not hidden, not disabled with no explanation.
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3">
            <p className="text-[12.5px] font-semibold text-slate-700">
              <span aria-hidden className="mr-1.5">◌</span>Writing a checklist is not available.
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
          <h2 className="text-[13px] font-bold text-gray-900">The three answers</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            There is no fourth. An item nobody answered has no answer recorded at all, so &ldquo;not
            reached&rdquo; and &ldquo;not done&rdquo; can never be read as the same thing.
          </p>
          <ul className="mt-2 space-y-1.5">
            {CHECKLIST_RESPONSES.map(r => (
              <li key={r.code} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{r.label}</span>
                <span className="text-gray-600"> &mdash; {r.meaning}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-3 border-t border-gray-100 pt-3 text-[12.5px] font-bold text-gray-900">
            What one completion is about
          </h3>
          <ul className="mt-1.5 space-y-1">
            {CHECKLIST_SUBJECTS.map(s => (
              <li key={s.code} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{s.label}</span>
                <span className="text-gray-600"> &mdash; {s.meaning}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Engine 5&rsquo;s six capabilities</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            Every one is listed, including the one that is only partly built. A capability quietly left
            off a list is one somebody assumes is there.
          </p>
          <ul className="mt-2 space-y-1.5">
            {CHECKLIST_ENGINE_CAPABILITIES.map(c => (
              <li key={c.name} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{c.name}</span>
                {c.state === "partial" && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">partly</span>
                )}
                <span className="text-gray-600"> &mdash; {c.how}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${CARD} p-3.5`}>
          <h2 className="text-[13px] font-bold text-gray-900">Who can do what</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-500">
            The specification names five roles. This is what each one actually is here, because a
            permission model somebody relies on has to be the one that runs.
          </p>
          <ul className="mt-2 space-y-1.5">
            {CHECKLIST_ROLE_REALITY.map(r => (
              <li key={r.role} className="text-[12px] leading-relaxed">
                <span className="font-semibold text-gray-800">{r.role}</span>
                <span className="text-gray-600"> &mdash; {r.how}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ⚠ THE GAPS, ON THE SCREEN. A gap recorded only in a commit message is one the next person
            rediscovers as a bug, and the person relying on this module is the one who needs to know. */}
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3.5">
          <h2 className="text-[13px] font-bold text-slate-800">
            <span aria-hidden className="mr-1.5">◌</span>What this does not do yet
          </h2>
          <ul className="mt-2 space-y-2">
            {CHECKLIST_KNOWN_GAPS.map(g => (
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

function NewChecklist({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(CHECKLIST_KINDS[0].code);
  const [runSubject, setRunSubject] = useState(CHECKLIST_SUBJECTS[0].code);
  const [purpose, setPurpose] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = CHECKLIST_KINDS.find(k => k.code === kind);
  const subject = CHECKLIST_SUBJECTS.find(s => s.code === runSubject);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/checklists", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code, title, kind, runSubject,
        purpose: purpose || null, specialty: specialty || null,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    window.location.href = `${CHECKLIST_ROUTE}/${data.id}`;
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-3.5">
      <h2 className="text-[13px] font-bold text-gray-900">A new checklist</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">
        It starts as a draft with no items on it. There is no starter list, because there is no correct
        starter list for a ward round and inventing one would be this product suggesting clinical steps.
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Reference</span>
          <input value={code} onChange={e => setCode(e.target.value)} required maxLength={40}
            placeholder="WHO-01" className={FIELD} />
          <span className="mt-0.5 block text-[10.5px] text-gray-400">
            What people will quote. Only one checklist in use may hold it at a time.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Kind</span>
          <select value={kind} onChange={e => setKind(e.target.value)} className={FIELD}>
            {CHECKLIST_KINDS.map(k => <option key={k.code} value={k.code}>{k.label}</option>)}
          </select>
          {chosen && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{chosen.meaning}</span>}
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} className={FIELD} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold text-gray-500">What one completion is about</span>
          <select value={runSubject} onChange={e => setRunSubject(e.target.value)} className={FIELD}>
            {CHECKLIST_SUBJECTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          {subject && <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{subject.meaning}</span>}
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
