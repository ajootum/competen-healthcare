import Link from "next/link";

// CPR-SET-004 — the Personal Settings card grid.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// "Users reach any settings category within two clicks."
//
// One click opens a category, one more changes something. That only holds if the card itself answers
// the question you came to ask -- so each carries a live preview of its own state: the actual theme and
// accent, the real shortcut keys, how many devices are signed in. A grid of ten identical cards with
// chevrons costs a click to find out you were already where you wanted to be.
//
// TWO CARDS ARE MARKED UNAVAILABLE RATHER THAN HIDDEN. Import and restore have no implementation, and a
// card that silently disappears leaves somebody hunting for a feature the design promised them. They
// say what is missing, which is a product statement -- not the developer content CPR-SET-004 asks to
// remove. That was `identifier_policy` and `feature_flags` printed in monospace, and it is gone.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SettingsCard = {
  key: string;
  title: string;
  blurb: string;
  icon: string;
  /** Tint for the icon tile. One hue per category, as the comp draws it. */
  tone: string;
  href: string;
  /** Live state, rendered as chips under the blurb. Empty renders nothing. */
  chips: { label: string; className?: string }[];
  /** Set when the category exists but part of it does not work yet. */
  unavailable: string | null;
};

export default function SettingsCards({ cards }: { cards: SettingsCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {cards.map(c => (
        <Link key={c.key} href={c.href}
          className="group flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[var(--cp-primary)]/40 hover:shadow-md">
          <div className="flex items-start justify-between">
            <span aria-hidden className={`flex h-11 w-11 items-center justify-center rounded-xl text-[18px] ${c.tone}`}>
              {c.icon}
            </span>
            <span aria-hidden className="text-gray-300 transition group-hover:text-[var(--cp-primary)]">›</span>
          </div>
          <p className="mt-3 text-[13px] font-bold text-gray-900">{c.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{c.blurb}</p>

          {/* THE CARD SHOWS ITS OWN STATE. The comp draws a theme swatch, the real shortcut keys, a
              device count -- so the grid answers most questions without being opened. */}
          {c.chips.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1">
              {c.chips.map((chip, i) => (
                <span key={i}
                  className={chip.className ?? "rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600"}>
                  {chip.label}
                </span>
              ))}
            </div>
          )}

          {c.unavailable && (
            <p className="mt-2 text-[10px] leading-relaxed text-amber-700">{c.unavailable}</p>
          )}
        </Link>
      ))}
    </div>
  );
}
