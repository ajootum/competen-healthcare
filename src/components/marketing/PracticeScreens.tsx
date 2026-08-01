import { PREVIEW_NOTE, type PracticeScreen } from "@/lib/marketing/practice-content";

// The screen gallery used by every Competen Practice page.
//
// THE PREVIEW NOTE IS NOT DECORATION. These are design mockups; the product is specified rather than
// shipped. Rendering them without saying so would let a visitor reasonably conclude they are looking at a
// running system, and that conclusion would be ours to answer for. The note is part of the component so a
// new gallery cannot be added without it -- which is precisely what would happen if it were a paragraph
// somebody had to remember to paste in.
//
// Images are plain <img> with width/height and lazy loading rather than next/image: they are static build
// artefacts of known size (see scripts/build-practice-images.mjs), already WebP, and already sized for the
// widths they are shown at, so the optimiser has nothing left to do.

export default function PracticeScreens({ screens, accent }: { screens: PracticeScreen[]; accent: string }) {
  if (screens.length === 0) return null;
  return (
    <div>
      <ul className="grid gap-6 lg:grid-cols-2">
        {screens.map((s, i) => (
          <li key={s.src}
            /* A lone trailing screen on an odd-numbered set spans the grid rather than sitting in a
               half-width column beside empty space. */
            className={screens.length % 2 === 1 && i === screens.length - 1 ? "lg:col-span-2" : undefined}>
            <figure className="h-full rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="bg-[var(--cmp-neutral-100)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} width={1400} height={933} loading="lazy" decoding="async"
                  className="w-full h-auto" />
              </div>
              <figcaption className="border-t border-gray-100 px-4 py-3 text-[12.5px] leading-snug text-gray-600">
                <span aria-hidden className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ background: accent }} />
                {s.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      {/* gray-500, not gray-400. This is a disclosure: at gray-400 it measured 2.49:1, which is a way of
          printing a caveat that technically appears and practically does not. */}
      <p className="mt-4 text-[11.5px] text-gray-500">{PREVIEW_NOTE}</p>
    </div>
  );
}
