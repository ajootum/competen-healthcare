import Link from "next/link";
import type { DocumentsOverview } from "@/lib/practice/documents-workspace";
import {
  DOC_CARD_SWATCH, DOC_CARD_UNREADABLE, DOC_CARD_LABEL, DOC_STATUS, DOC_ORIGIN,
  DOC_TYPE_LABEL, EMPTY_STATE_ACTIONS, patientLinkState,
} from "@/lib/practice/documents-workspace-constants";

// CPR-DOC-002 s4 -- THE OVERVIEW DASHBOARD. "The landing page should not be an empty library."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN, AND THE CARD IS THE LINK. `card.href` is the
// query string documentRegister() itself applies, so the number on the card and the rows on the page it
// opens come from one predicate over one array. A card counting one thing while its list shows another
// has shipped on the Patients register in this codebase; the only fix that holds is the one where the
// two cannot differ.
//
// ⚠ AN UNREADABLE FIGURE IS AN EM DASH, NEVER A ZERO, AND IT LOSES ITS COLOUR AND KEEPS ITS PLACE.
// "Nothing is awaiting review" and "I could not find out what is awaiting review" are different answers
// and only one of them means you can stop looking. Removing the card would make the row look complete.
//
// ⚠ NO RATES. The comp prints "24 ↑ 15% vs last month" under Created this month. That is a percentage
// against a baseline; s4 asks for counts and denominators. The card prints the prior month's COUNT, and
// only when this practice existed for that month -- see priorMonthWindow in the engine.
//
// ⚠ COLOUR IS DOING SEMANTIC WORK: tinted card, tinted icon badge, and THE FIGURE IN THE CARD'S OWN HUE.
// A tinted badge beside a black number leaves the colour on the decoration. Five grey rectangles with
// five numbers in them have to be read one at a time; five coloured ones are found.
//
// ⚠ NOT DRAWN, AND NOT DRAWN DISABLED (s18 vs this codebase's rule against dead controls -- both are
// satisfied by not drawing): the comp's "Generate with AI" (s20 Phase 3), "Scan document" (Phase 4),
// and the "Expiring soon / within 30 days" card, which needs a retention or expiry model that no table
// in this schema has. There is no figure to put in it, so there is no card.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const AT = (iso: string) => String(iso).slice(0, 10);

export default function OverviewBoard({ overview, capabilities }: {
  overview: DocumentsOverview;
  capabilities: string[];
}) {
  const { register, cards, attention, activity, templates, empty } = overview;

  return (
    <div className="flex flex-col gap-5">
      {/* ── A READ THAT FAILED, SAID OUT LOUD ─────────────────────────────────────────────────────── */}
      {register.unreadable.length > 0 && (
        <p className="rounded-xl bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--cmp-text-warning)]">
          <span className="font-semibold">
            {register.unreadable.map(u => u.source).join(" and ")} could not be read.
          </span>{" "}
          This is not an empty workspace. Any figure below that counts{" "}
          {register.unreadable.length === 1 ? "it" : "them"} shows a dash rather than a number, and the
          lists are incomplete by an unknown amount.
          <span className="mt-0.5 block font-mono text-[11px] opacity-80">
            {register.unreadable.map(u => `${u.source}: ${u.detail}`).join(" · ")}
          </span>
        </p>
      )}
      {register.truncated.length > 0 && (
        <p className="rounded-xl bg-[var(--cmp-surface-information)] px-3 py-2 text-[12.5px] text-[var(--cmp-text-information)]">
          <span className="font-semibold">Showing the most recent 500 of {register.truncated.join(" and ")}.</span>{" "}
          Older rows exist and are not counted here. Use the filters on Patient Documents to reach them.
        </p>
      )}

      {/* ── s4's METRIC CARDS ─────────────────────────────────────────────────────────────────────── */}
      <section aria-label="Document metrics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map(c => {
          const base = DOC_CARD_LABEL[c.key];
          // ⚠ THE "Created this month" CARD MAY NOT SAY "this month" UNDER ANOTHER MONTH'S PERIOD.
          //
          // With a period on, the register IS the reader's window and the engine drops the this-month
          // sub-filter -- so the figure is right and only the words would be wrong. A card headed
          // "Created this month" printing July's count is the kind of small lie somebody quotes.
          const meta = overview.periodBounded && c.key === "created_this_month"
            ? {
              ...base, label: "Created in this period",
              caption: `Authored here between ${overview.periodFrom} and ${overview.periodTo}`,
              blurb: "Documents this practice authored, dated within the period chosen above.",
            }
            : base;
          // ⚠ THE NARROWED READING, not a boolean beside it. `const live = c.count.state === "ok"` does
          // not narrow the union for TypeScript, and the shape that compiles by casting is the shape in
          // which a future edit reads `.value` off an unreadable card and prints `undefined` as a figure.
          const figure = c.count.state === "ok" ? c.count : null;
          const s = figure ? DOC_CARD_SWATCH[c.key] : DOC_CARD_UNREADABLE;
          const body = (
            <>
              <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${s.accent}`} />
              <span className="flex items-start gap-3 pl-1">
                <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] ${s.badge}`}>
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-gray-700">{meta.label}</span>
                  <span className={`block text-[30px] font-bold leading-none ${s.figure}`}>
                    {figure ? figure.value : <>&mdash;</>}
                  </span>
                </span>
              </span>
              <span className={`mt-2 block text-[11px] font-medium ${s.caption}`}>
                {c.count.state === "unreadable"
                  ? "Could not be read"
                  : c.count.state === "forbidden"
                    ? "Not yours to see"
                    : c.against
                      // A COUNT AGAINST A COUNT. Never a percentage, and never against a window this
                      // practice did not live through.
                      ? `${meta.caption} · ${c.against.count} in the same period last month`
                      : meta.caption}
              </span>
            </>
          );
          const className = `relative block overflow-hidden rounded-2xl border p-4 text-left transition ${s.box}`;

          // An unreadable card is NOT A LINK. Opening a list that could not be counted would show an
          // empty page and read as "there is nothing here", which is the same lie the zero would tell.
          return figure ? (
            <Link key={c.key} href={c.href} title={meta.blurb} className={`${className} hover:-translate-y-px hover:shadow-md`}>
              {body}
            </Link>
          ) : (
            <div key={c.key} title={c.count.state === "ok" ? meta.blurb : c.count.detail} className={className}>
              {body}
            </div>
          );
        })}
      </section>

      {/* ── s4.1's CONTEXTUAL GUIDANCE ────────────────────────────────────────────────────────────── */}
      {empty && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-[15px] font-bold text-gray-900">Nothing has been filed yet</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-gray-500">
            Documents reach this workspace three ways: you write one from a consultation, somebody
            records a letter or result that arrived, or a file is attached to a patient&rsquo;s record.
            Whichever it is, a patient-linked document appears both here and in that patient&rsquo;s own
            record &mdash; you never have to file it twice.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {EMPTY_STATE_ACTIONS
              .filter(a => a.capability === null || capabilities.includes(a.capability))
              .map(a => (
                <Link key={a.href} href={a.href}
                  className="rounded-xl border border-gray-200 bg-white p-3 transition hover:border-[var(--cp-primary)]/40 hover:shadow-sm">
                  <span className="block text-[13px] font-semibold text-[var(--cp-primary-deep)]">{a.label} &rarr;</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-gray-500">{a.blurb}</span>
                </Link>
              ))}
          </div>
        </section>
      )}

      {/* ── s4's ATTENTION QUEUE ──────────────────────────────────────────────────────────────────── */}
      {attention.length > 0 && (
        <section className="grid gap-3 lg:grid-cols-3">
          {attention.map(q => (
            <div key={q.key} className="flex flex-col rounded-2xl border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
                <h2 className="text-[13px] font-bold text-gray-900">{q.label}</h2>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-bold text-gray-600">
                  {q.rows.length}
                </span>
                <Link href={q.href} className="ml-auto text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  Work this list &rarr;
                </Link>
              </div>
              <p className="px-4 pt-2 text-[11px] leading-relaxed text-gray-500">{q.blurb}</p>
              <ul className="flex flex-col px-4 py-2">
                {q.rows.map(r => {
                  const link = patientLinkState(r);
                  return (
                    <li key={`${r.origin}:${r.id}`} className="border-b border-gray-100 py-1.5 last:border-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.href
                          ? <Link href={r.href} className="text-[12.5px] font-semibold text-gray-900 hover:underline">{r.title}</Link>
                          : <span className="text-[12.5px] font-semibold text-gray-900">{r.title}</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${DOC_ORIGIN[r.origin].chip}`}>
                          {DOC_ORIGIN[r.origin].short}
                        </span>
                        <span className="ml-auto text-[10.5px] text-gray-400">{r.at}</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-500">
                        {link.ok
                          ? r.patientName
                          : <span className="font-semibold text-rose-600">{link.reason}</span>}
                        {r.source && <> &middot; {r.source}</>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-3 lg:grid-cols-3">
        {/* ── s4's RECENT ACTIVITY, which is also s20 Phase 1's "basic audit" made visible ────────── */}
        <div className="rounded-2xl border border-gray-200 bg-white lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
            <h2 className="text-[13px] font-bold text-gray-900">Recent document activity</h2>
            <span className="ml-auto text-[10.5px] text-gray-400">
              From the practice audit trail. Document events only.
            </span>
          </div>
          {activity.state !== "ok" ? (
            <p className="px-4 py-4 text-[12px] text-gray-500">
              <span className="font-semibold text-[var(--cmp-text-warning)]">
                The audit trail could not be read.
              </span>{" "}
              That is not the same as nothing having happened.
              <span className="mt-0.5 block font-mono text-[11px] text-gray-400">{activity.detail}</span>
            </p>
          ) : activity.value.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-gray-500">
              Nothing has been done to a document yet. Every creation, edit, signature, release, arrival
              and review lands here with a name and a time against it.
            </p>
          ) : (
            <ul className="flex flex-col px-4 py-1.5">
              {activity.value.map(e => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-1.5 border-b border-gray-100 py-1.5 text-[12px] last:border-0">
                  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    e.origin === "created_in_cp" ? "bg-[var(--cp-primary)]"
                      : e.origin === "received_externally" ? "bg-sky-400" : "bg-violet-400"}`} />
                  <span className="font-semibold text-gray-800">{e.actorName ?? "Somebody"}</span>
                  <span className="text-gray-600">{e.verb} a document</span>
                  <span className="ml-auto text-[10.5px] text-gray-400">{AT(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── s4's QUICK TEMPLATES ─────────────────────────────────────────────────────────────────
            "Frequently used templates based on personal usage." COUNTED FROM DOCUMENTS THIS PERSON
            ACTUALLY MADE -- no usage table exists and none was added. A template nobody has used does
            not appear, because "frequently used" with a zero beside it is a list of templates. */}
        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
            <h2 className="text-[13px] font-bold text-gray-900">Templates you use</h2>
            {capabilities.includes("template.manage") && (
              <Link href="/practice/documents/templates" className="ml-auto text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                All templates &rarr;
              </Link>
            )}
          </div>
          {templates.state !== "ok" ? (
            <p className="px-4 py-4 text-[12px] text-gray-500">
              <span className="font-semibold text-[var(--cmp-text-warning)]">Template use could not be read.</span>{" "}
              <span className="block font-mono text-[11px] text-gray-400">{templates.detail}</span>
            </p>
          ) : templates.value.length === 0 ? (
            <p className="px-4 py-4 text-[12px] leading-relaxed text-gray-500">
              You have not made a document from a template yet. Once you have, the ones you reach for
              most appear here, ranked by how often you have actually used them.
            </p>
          ) : (
            <ul className="flex flex-col px-4 py-1.5">
              {templates.value.map(t => (
                <li key={t.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                  <span className="text-[12.5px] font-semibold text-gray-800">{t.title}</span>
                  <span className="text-[10.5px] text-gray-400">{DOC_TYPE_LABEL[t.kind] ?? t.kind}</span>
                  <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-bold text-gray-600">
                    {t.used === 1 ? "once" : `${t.used}×`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── s4's RECENT DOCUMENTS, the comp's main table ──────────────────────────────────────────── */}
      {!empty && register.rows.length > 0 && (
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
            <h2 className="text-[13px] font-bold text-gray-900">Recent documents</h2>
            <Link href="/practice/documents/patient" className="ml-auto text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              View all &rarr;
            </Link>
          </div>
          <ul className="flex flex-col px-4 py-1.5">
            {register.rows.slice(0, 8).map(r => (
              <li key={`${r.origin}:${r.id}`} className="flex flex-wrap items-center gap-2 border-b border-gray-100 py-2 last:border-0">
                {r.href
                  ? <Link href={r.href} className="text-[13px] font-semibold text-gray-900 hover:underline">{r.title}</Link>
                  : <span className="text-[13px] font-semibold text-gray-900">{r.title}</span>}
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                  {DOC_TYPE_LABEL[r.docType] ?? r.docType}
                </span>
                <span className="text-[12px] text-gray-600">
                  {r.patientName ?? <span className="font-semibold text-rose-600">No patient link</span>}
                </span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${DOC_STATUS[r.status].chip}`}
                  title={`${DOC_STATUS[r.status].blurb} Stored as ${r.stored}.`}>
                  {DOC_STATUS[r.status].label}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${DOC_ORIGIN[r.origin].chip}`}
                  title={DOC_ORIGIN[r.origin].blurb}>
                  {DOC_ORIGIN[r.origin].short}
                </span>
                <span className="text-[11px] text-gray-400">{r.at}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
