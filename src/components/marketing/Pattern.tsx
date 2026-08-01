// African geometric textile motifs, authored as SVG (COMP-HOME-001 "Branding").
//
// The spec asks for "subtle African geometric textile patterns in separators and backgrounds". These are
// drawn rather than sourced: a repeating SVG tile costs nothing to load, scales to any width without
// artefacts, recolours with the brand, and carries no licensing question — which a downloaded textile
// photograph would.
//
// They are DECORATIVE, so every one is aria-hidden. A screen reader announcing "kente pattern" between
// sections adds noise and no information.

/** Repeating band motif — the strip beneath the hero and above the footer. */
export function PatternBand({ className = "", tone = "var(--cmp-color-primary)" }: { className?: string; tone?: string }) {
  return (
    <svg className={className} aria-hidden="true" role="presentation" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <pattern id="cmp-band" width="72" height="36" patternUnits="userSpaceOnUse">
          {/* Alternating triangles + a centre diamond: the simplest kente-derived unit that still reads as
              woven rather than as a generic zigzag. */}
          <path d="M0 36 L18 4 L36 36 Z" fill={tone} opacity="0.13" />
          <path d="M36 36 L54 4 L72 36 Z" fill={tone} opacity="0.08" />
          <path d="M27 18 L36 9 L45 18 L36 27 Z" fill={tone} opacity="0.22" />
          <rect x="0" y="33" width="72" height="3" fill={tone} opacity="0.18" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cmp-band)" />
    </svg>
  );
}

/** Large, very low-contrast field motif for section backgrounds. */
export function PatternField({ className = "", tone = "#FFFFFF", opacity = 0.06 }: { className?: string; tone?: string; opacity?: number }) {
  return (
    <svg className={className} aria-hidden="true" role="presentation" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <pattern id="cmp-field" width="120" height="120" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={tone} strokeWidth="1.5" opacity={opacity}>
            <path d="M0 60 L60 0 L120 60 L60 120 Z" />
            <path d="M30 60 L60 30 L90 60 L60 90 Z" />
            <circle cx="60" cy="60" r="6" />
            <path d="M0 0 L20 0 M0 0 L0 20 M120 120 L100 120 M120 120 L120 100" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#cmp-field)" />
    </svg>
  );
}

/** Narrow rule used between sections instead of a plain border. */
export function PatternRule({ className = "" }: { className?: string }) {
  return (
    <div className={`h-2 w-full overflow-hidden ${className}`} aria-hidden="true">
      <svg width="100%" height="8" preserveAspectRatio="none" role="presentation">
        <defs>
          <pattern id="cmp-rule" width="24" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 8 L6 0 L12 8 L18 0 L24 8" fill="none" stroke="var(--cmp-color-primary)" strokeWidth="1.5" opacity="0.35" />
          </pattern>
        </defs>
        <rect width="100%" height="8" fill="url(#cmp-rule)" />
      </svg>
    </div>
  );
}

// ── Photography slots ────────────────────────────────────────────────────────
//
// The spec makes African healthcare photography the primary visual identity, and is explicit that it must
// be authentic rather than stock. I cannot source that, and generating or hotlinking something that merely
// looks the part would be exactly what the spec forbids.
//
// So the slot degrades to a patterned panel that reads as a deliberate design element rather than a broken
// image, and the page is presentable with no photography at all. Drop a file at the documented path and it
// takes over with no code change. This is a real gap, named here rather than papered over.
export function PhotoSlot({
  src, alt, className = "", caption,
}: { src?: string; alt: string; className?: string; caption?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={`object-cover w-full h-full ${className}`} loading="lazy" />;
  }
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-[var(--cmp-color-primary)] to-[#064E3B] ${className}`} role="img" aria-label={alt}>
      <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.18} />
      {caption && (
        <span className="absolute inset-x-0 bottom-0 p-3 text-[11px] leading-snug text-white/70">{caption}</span>
      )}
    </div>
  );
}
