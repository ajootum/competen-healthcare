import Link from "next/link";
import type { PriorityStripData } from "@/lib/practice/intelligence";
import { PRIORITY_SWATCH, PRIORITY_UNSUPPLIED, INSIGHT_ACTIONS } from "@/lib/practice/intelligence-constants";
import InsightAction from "./InsightAction";

// CPR-PI-001 s7.2's PRIORITY STRIP -- five tiles, always five.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THE COLOUR IS THE FEATURE, NOT THE DECORATION, AND THIS IS THE FIFTH SCREEN IN THIS CODEBASE TO
// HAVE THAT WRITTEN ABOUT IT. The last one shipped in six shades of grey and came back with "the colors
// are flat."
//
// This strip is read in the first seconds of a clinic to answer one question: what needs me first. Five
// identical grey rectangles containing five numbers have to be READ, one at a time, left to right. Five
// coloured ones are FOUND. That is a legibility decision and monochrome is not the conservative option
// -- it is the option that quietly costs the practitioner the thing the strip was for.
//
// EACH TILE GETS THREE TINTED THINGS: the box, the icon badge, AND THE FIGURE. The last one is the part
// that keeps getting dropped; a tinted badge beside a black number leaves the colour on the ornament
// while the number -- the thing actually being read -- stays grey.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ A TILE THAT COULD NOT BE COMPUTED KEEPS ITS PLACE AND LOSES ITS COLOUR. A tinted card with an em
// dash reads as a number you cannot quite make out. A grey dashed one reads as a question nobody could
// answer, which is what it is. Removing it would make the strip look complete when it is not.

export default function PriorityStrip({ strip }: { strip: PriorityStripData }) {
  return (
    <section aria-label="What needs attention now">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {strip.tiles.map(t => {
          const ok = t.status === "ok" && t.count !== null;
          const s = ok ? (PRIORITY_SWATCH[t.key] ?? PRIORITY_UNSUPPLIED) : PRIORITY_UNSUPPLIED;
          // A ZERO IS NOT A CRISIS. The tile keeps its hue -- so the row stays scannable -- but the
          // heavier treatment is spent only where there is something to act on. A red nought teaches
          // people to stop seeing red, and takes the tile that matters down with it.
          const quiet = ok && t.count === 0;
          // !! THE BUTTON CANNOT LIVE INSIDE THE LINK. A <button> nested in an <a> is invalid markup, and
          // a click would follow the link as well as raise the task. The tile is now a container: the Link
          // is still the whole readable body, and the action sits under it.
          //
          // !! AND IT IS ABSENT WHERE THERE IS NOTHING TO DO. patients_attention leads to another
          // intelligence tab, so an "Act on this" there would only mean "look at more" -- the exact thing
          // this feature exists to stop pretending is an action.
          const actionable = !!INSIGHT_ACTIONS[t.key];
          return (
            <div key={t.key}
              className={`group relative overflow-hidden rounded-xl border p-3 transition hover:shadow-sm ${s.box} ${quiet ? "opacity-70" : ""}`}>
              <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${s.accent}`} />
              <Link href={t.href} className="block">
              <div className="flex items-start gap-2">
                <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[13px] ${s.badge}`}>
                  {PRIORITY_SWATCH[t.key]?.icon ?? "?"}
                </span>
                <div className="min-w-0">
                  {/* THE FIGURE IN THE CARD'S OWN HUE. */}
                  <p className={`text-2xl font-bold leading-none tabular-nums ${s.figure}`}>
                    {ok ? t.count : "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] font-semibold text-gray-800">{t.label}</p>
                </div>
              </div>
              <p className={`mt-1.5 line-clamp-2 text-[10px] leading-snug ${ok ? s.caption : "text-slate-400"}`}>
                {t.status === "ok"
                  ? (t.reason ?? t.definition)
                  : t.reason ?? "not computed"}
              </p>
              </Link>
              {/* !! NOT DRAWN ON A TILE THAT COULD NOT BE COMPUTED. Raising work off a figure nobody could
                  read would be acting on a question rather than on an answer. */}
              {actionable && <InsightAction insightKey={t.key} disabled={!ok} />}
            </div>
          );
        })}
      </div>

      {/* ⚠ THREE WAYS TO BE QUIET AND ONLY ONE OF THEM IS CALM. Nothing waiting is calm. Nothing VISIBLE
          is a permissions answer. Nothing READ is a failure -- and reporting the third as the first
          tells a practitioner their practice is quiet because a query timed out. */}
      {strip.allClear && (
        <p className="mt-2 text-[11px] text-emerald-700">
          Nothing waiting, nothing hidden from you, and nothing failed to load. All three, or this line
          would not be here.
        </p>
      )}
      {strip.blindSpots.length > 0 && (
        <p className="mt-2 text-[11px] text-gray-500">
          Not counted here because your role does not include it: {strip.blindSpots.join(", ")}.
        </p>
      )}
      {strip.unreadable.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-700">
          Could not be read: {strip.unreadable.join(", ")}. These are blank rather than nought, which is
          the whole difference.
        </p>
      )}
    </section>
  );
}
