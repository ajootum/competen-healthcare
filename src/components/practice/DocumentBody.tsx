import type { DocumentBlock } from "@/lib/practice/document-compose";
import type { StyleTokens } from "@/lib/practice/document-style";

// CPR-DOC-CONFIG-001 sections 8, 15 and 16 -- THE SHARED RENDERER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE RENDERER, DRIVEN BY TOKENS, AND IT LIVES HERE RATHER THAN BESIDE ONE ROUTE BECAUSE THREE
// SURFACES SHARE IT: the designer preview, the print view and the PDF that print view produces. Section 15: "The same resolved style must drive editor preview,
// print preview and final PDF as closely as technically possible." This component is that single
// place. It takes a content model and a resolved style and returns the document. It does not know
// which document type it is rendering, and no document type knows what colour it is.
//
// ⚠ NO CONTENT MODEL MEANS PLAIN TEXT, AND THAT PATH IS NOT A DEGRADED FALLBACK -- it is what every
// document written before this existed genuinely is. Rendering those through the block renderer would
// mean guessing structure out of prose, and guessing wrong on a signed letter. They render exactly as
// they always have.
//
// SECTION MEANING NEVER RESTS ON COLOUR ALONE. Section 16: "Never require colour alone to identify
// section meaning; retain headings/icons/text", and section 15 wants monochrome printing to work.
// Every section keeps a real heading in bold text, so a fax, a greyscale printer and a reader with
// colour-blindness all get the same document. The band is decoration over the top of that.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// WHY INLINE STYLE IS SAFE HERE. Section 14 forbids arbitrary CSS, and these values are interpolated
// into style properties. They are safe because they cannot be arbitrary: validateTokens has already
// rejected anything that is not a six-digit hex or a member of a closed list, and it runs before a
// style is ever written. The renderer reads a vocabulary, not a stylesheet.

const LINE_HEIGHT = { compact: 1.4, standard: 1.6, relaxed: 1.9 } as const;
const SECTION_GAP = { compact: 10, standard: 16, relaxed: 24 } as const;

/**
 * Phase 1 renders band, left_accent and plain. `card` and `divider` fall back to `band` rather than
 * silently rendering as nothing -- they are in the vocabulary because section 6 lists them, and the
 * designer that offers them is Phase 2. `showSectionIcons` is likewise not consumed yet: the approved
 * icon set is a Phase 2 decision, and drawing something invented here would be worse than waiting.
 */
export function DocumentBody({ blocks, body, tokens }: {
  blocks: DocumentBlock[] | null;
  body: string;
  tokens: StyleTokens;
}) {
  if (!blocks?.length) return <div className="whitespace-pre-wrap">{body}</div>;

  const { colour, typography, layout } = tokens;
  const gap = SECTION_GAP[layout.sectionSpacing];
  const upper = typography.headingCase === "uppercase";

  const heading = (text: string, accent: string) => (
    <div
      style={{
        color: accent,
        fontSize: `${typography.headingSize}px`,
        fontWeight: 600,
        textTransform: upper ? "uppercase" : "none",
        letterSpacing: upper ? "0.04em" : undefined,
      }}
    >
      {text}
    </div>
  );

  const sectionShell = (key: string, accent: string, band: string, inner: React.ReactNode) => {
    if (layout.sectionTreatment === "plain") {
      return <section key={key} style={{ marginBottom: gap }}>{inner}</section>;
    }
    if (layout.sectionTreatment === "left_accent") {
      return (
        <section key={key} style={{ marginBottom: gap, borderLeft: `3px solid ${accent}`, paddingLeft: 10 }}>
          {inner}
        </section>
      );
    }
    // band, and the two Phase 2 treatments that fall back to it
    return (
      <section key={key} style={{ marginBottom: gap }}>
        <div style={{ background: band, padding: "5px 8px", borderRadius: 4 }}>{inner}</div>
      </section>
    );
  };

  return (
    <div
      style={{
        color: colour.text,
        fontSize: `${typography.bodySize}px`,
        lineHeight: LINE_HEIGHT[typography.lineSpacing],
      }}
    >
      {blocks.map((b, i) => {
        const key = `${b.kind}-${i}`;
        switch (b.kind) {
          case "date":
            return <p key={key} style={{ marginBottom: gap, color: colour.muted }}>{b.text}</p>;

          case "address":
            return (
              <p key={key} style={{ marginBottom: gap, whiteSpace: "pre-line" }}>{b.lines.join("\n")}</p>
            );

          case "salutation":
            return <p key={key} style={{ marginBottom: gap }}>{b.text}</p>;

          case "subject":
            return (
              <p key={key} style={{ marginBottom: gap, fontWeight: 600, whiteSpace: "pre-line" }}>
                {b.lines.join("\n")}
              </p>
            );

          case "meta":
            return <p key={key} style={{ marginBottom: gap, color: colour.muted }}>{b.text}</p>;

          case "prose":
          case "section": {
            const tone = colour.roles[b.role];
            // ⚠ break-inside: the heading and its first lines stay together. Section 15: "Prevent
            // section headers from being orphaned at the bottom of a page where feasible."
            return sectionShell(key, tone.accent, tone.band, (
              <div style={{ breakInside: "avoid" }}>
                {heading(b.heading, tone.accent)}
                <div style={{ marginTop: 3, whiteSpace: "pre-line", color: colour.text }}>
                  {b.lines.join("\n")}
                </div>
              </div>
            ));
          }

          case "narrative":
            return (
              <p key={key} style={{ marginBottom: gap, whiteSpace: "pre-line" }}>{b.lines.join("\n")}</p>
            );

          case "signoff":
            return (
              <p key={key} style={{ marginBottom: gap, whiteSpace: "pre-line" }}>{b.lines.join("\n")}</p>
            );
        }
      })}
    </div>
  );
}
