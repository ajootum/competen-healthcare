import Link from "next/link";

// CPR-REG-002 s30 -- the persistent right context panel.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THREE OF THE COMP'S FOUR CLINIC FIGURES SURVIVE EXACTLY AS DRAWN. The fourth is "82% Utilisation"
// with a progress bar, and it goes: utilisation is appointments over CAPACITY, and capacity is recorded
// nowhere in this product. The figure would be a real number divided by an invented one -- which is
// worse than no figure, because it looks like measurement.
//
// AND THE "AI ASSISTANT" PANEL NEEDS NO AI. Two of its three lines -- whether a duplicate was found,
// who has an overdue follow-up -- are arithmetic over the record. The third, "Consider asking about new
// MRI results", originates a clinical suggestion, which is the line CPR-210 draws.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "rounded-xl border border-gray-200 bg-white p-4";

export default function ContextPanel({ w }: { w: any }) {
  return (
    <div className="flex flex-col gap-4">
      {/* ── Today's clinic ─────────────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold text-gray-900">Today&rsquo;s clinic</h2>
          <Link href="/practice/calendar" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Calendar
          </Link>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500">{w.today}</p>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["Appointments", w.clinic.appointments],
            ["Remaining", w.clinic.remaining],
            ["Walk-ins", w.clinic.walkIns],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <p className="text-lg font-bold text-gray-900">{v as number}</p>
              <p className="text-[10px] text-gray-500">{k}</p>
            </div>
          ))}
        </div>
        {/* THE COMP'S FOURTH TILE, IN ITS DESIGNED POSITION. */}
        <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] text-gray-500">
          <span className="font-semibold text-gray-600">No utilisation figure.</span>{" "}
          It would be today&rsquo;s appointments divided by a capacity this practice has never recorded.
        </p>
      </section>

      {/* ── Waiting queue ──────────────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">
          Waiting {w.queue.length > 0 && <span className="font-normal text-gray-500">({w.queue.length})</span>}
        </h2>
        {w.queue.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nobody is waiting.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {w.queue.map((q: any) => (
              <li key={q.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${q.status === "IN_CONSULTATION" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-success)]"}`} />
                <span className="min-w-0">
                  {q.href
                    ? <Link href={q.href} className="block truncate text-[12px] font-semibold text-gray-900 hover:underline">{q.name}</Link>
                    : <span className="block truncate text-[12px] font-semibold text-gray-900">{q.name}</span>}
                  <span className="block text-[10px] text-gray-500">
                    {q.status.toLowerCase().replace(/_/g, " ")}
                    {/* A NAME WITH NO RECORD BEHIND IT, said rather than rendered as a dead link. */}
                    {!q.href && " · checked in before this queue could link to a record"}
                  </span>
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                  {String(q.enteredAt).slice(11, 16)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Recent registrations ───────────────────────────────────────────────────────────────── */}
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">Recently registered</h2>
        {w.recent.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nobody yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {w.recent.map((r: any) => (
              <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                <Link href={r.href} className="min-w-0 truncate text-[12px] font-semibold text-gray-900 hover:underline">
                  {r.name}
                </Link>
                <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                  {String(r.at).slice(0, 10) === w.today ? String(r.at).slice(11, 16) : String(r.at).slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── What the record says (the comp's AI panel, without the AI) ─────────────────────────── */}
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">What the record says</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {w.observations.map((o: any) => (
            <li key={o.key} className="text-[12px] text-gray-700">
              {o.href ? <Link href={o.href} className="hover:underline">{o.text}</Link> : o.text}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-gray-500">
          Counted from your own records. The design labels this an AI assistant; two of its three lines
          are arithmetic, and the third suggested what to ask a patient about &mdash; which is not
          something this product will originate.
        </p>
      </section>

      {/* ── What this screen will not do ───────────────────────────────────────────────────────── */}
      <section className={`${card} border-dashed bg-gray-50/60`}>
        <h2 className="text-[13px] font-bold text-gray-900">Not on this screen</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {w.refused.map((r: any) => (
            <li key={r.key}>
              <p className="text-[12px] font-semibold text-gray-700">{r.label}</p>
              <p className="text-[10px] text-gray-500">{r.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
