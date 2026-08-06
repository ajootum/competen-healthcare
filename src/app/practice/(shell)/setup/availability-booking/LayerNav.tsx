import Link from "next/link";
import { LAYER_SWATCH } from "@/lib/practice/practice-session-constants";

// CPR-V5-007 s3.2 -- THE THREE-LAYER NAVIGATOR.
//
// "The existing left-side stepper must be replaced by three major layer cards. Each layer expands to
// show its child sections and a concise completion summary." And the interaction rule: "ONLY ONE MAJOR
// LAYER IS OPEN IN THE CENTRE WORKSPACE AT A TIME."
//
// THE OPEN LAYER IS A URL, NOT A PIECE OF CLIENT STATE. Three consequences, all wanted: the browser's
// back button steps between layers, a link to Layer 2 is a link somebody can send, and the centre
// workspace renders on the server with only the layer's own data. The old screen's stepper did the same
// with ?step= and it is the same reasoning.

export type LayerChild = {
  key: string;
  label: string;
  /** true = done, false = not done, null = optional or unknowable, "unreadable" = the query failed. */
  state: boolean | null | "unreadable";
  detail: string | null;
};

export type Layer = {
  n: number;
  key: string;
  title: string;
  blurb: string;
  summary: string;
  children: LayerChild[];
};

const DOT: Record<string, string> = {
  done: "bg-emerald-500",
  todo: "bg-amber-400",
  optional: "bg-slate-300",
  unreadable: "bg-slate-300 ring-1 ring-slate-400",
};

const dotFor = (state: LayerChild["state"]) =>
  state === "unreadable" ? DOT.unreadable
    : state === null ? DOT.optional
      : state ? DOT.done : DOT.todo;

export default function LayerNav({ layers, active }: { layers: Layer[]; active: number }) {
  return (
    <nav aria-label="Availability and booking layers" className="flex flex-col gap-3">
      {layers.map(l => {
        const sw = LAYER_SWATCH[l.key];
        const open = l.n === active;
        return (
          <div key={l.key}
            className={`overflow-hidden rounded-xl border transition ${
              open ? `${sw.box} shadow-[0_1px_3px_rgba(15,23,42,0.08)]` : "border-gray-200 bg-white"}`}>
            <Link href={`/practice/setup/availability-booking?layer=${l.n}`}
              aria-current={open ? "step" : undefined}
              className="block p-3.5 hover:bg-black/[0.02]">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold ${
                  open ? sw.badge : "bg-slate-100 text-slate-500"}`}>
                  {l.n}
                </span>
                <p className={`text-[13.5px] font-bold ${open ? "text-gray-900" : "text-gray-700"}`}>{l.title}</p>
              </div>
              <p className={`mt-1.5 text-[11px] leading-relaxed ${open ? sw.caption : "text-gray-500"}`}>{l.blurb}</p>
              {/* s3.2's "concise completion summary". */}
              <p className={`mt-1.5 text-[11px] font-semibold ${open ? sw.figure : "text-gray-600"}`}>{l.summary}</p>
            </Link>

            {/* CHILD SECTIONS ARE VISIBLE ONLY FOR THE SELECTED LAYER (s15). */}
            {open && (
              <ul className="border-t border-black/5 px-3.5 py-2">
                {l.children.map(c => (
                  <li key={c.key} className="flex items-center gap-2 py-1 text-[11.5px]">
                    <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotFor(c.state)}`} />
                    <span className="text-gray-700">{c.label}</span>
                    {c.detail && <span className="ml-auto truncate pl-2 text-[10px] text-gray-500">{c.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
