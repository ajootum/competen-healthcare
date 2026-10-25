import type { Template } from "@/lib/individual/documents-config";
import type { DocModel } from "@/lib/individual/documents/model";

// The complete on-screen preview of a document (COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.8): the SAME DocModel the DOCX
// and PDF render, laid out with the template's page proportions, margins, typeface, sizes and colours, so what the person
// reads here is what they export. Used by the person's Studio and, with sample records, by the HQ Template Studio.

const PAGE_RATIO = { A4: 297 / 210, Letter: 279.4 / 215.9 } as const;

export default function DocumentPreview({ model, template }: { model: DocModel; template: Template }) {
  const t = template;
  const landscape = t.page.orientation === "landscape";
  const ratio = landscape ? 1 / PAGE_RATIO[t.page.size] : PAGE_RATIO[t.page.size];
  const pageMm = landscape ? (t.page.size === "A4" ? 297 : 279.4) : (t.page.size === "A4" ? 210 : 215.9);
  const pad = (mm: number) => `${(mm / pageMm) * 100}%`;
  const font = t.type.face === "serif" ? "'Times New Roman', Times, serif" : "Arial, Helvetica, sans-serif";
  const px = (pt: number) => `${pt * 1.333}px`;
  return (
    <article aria-label={`Preview of ${model.title}`} className="mx-auto w-full max-w-[820px] overflow-hidden border border-gray-300 bg-white shadow-sm"
      style={{ minHeight: `calc(min(820px, 100vw - 32px) * ${ratio})`, padding: `${pad(t.page.margins.top)} ${pad(t.page.margins.right)} ${pad(t.page.margins.bottom)} ${pad(t.page.margins.left)}`,
        fontFamily: font, color: t.colours.text, fontSize: px(t.type.base), lineHeight: t.type.lineSpacing * 1.15 }}>
      <h2 style={{ color: t.colours.accent, fontSize: px(t.type.base * t.type.headingScale * 1.5), fontWeight: 700, margin: 0 }}>{model.header.name}</h2>
      {model.header.headline && <p style={{ color: t.colours.muted, margin: "2px 0" }}>{model.header.headline}</p>}
      {model.header.contact && <p style={{ color: t.colours.muted, margin: "2px 0" }}>{model.header.contact}</p>}
      {model.sections.map(s => (
        <section key={s.code} style={{ marginTop: "1.1em" }}>
          <h3 style={{ color: t.colours.accent, fontSize: px(t.type.base * t.type.headingScale), fontWeight: 700, borderBottom: `1px solid ${t.colours.accent}`, paddingBottom: 2, margin: "0 0 0.4em" }}>{s.title}</h3>
          {s.intro && <p style={{ color: t.colours.muted, fontStyle: "italic", margin: "0 0 0.4em" }}>{s.intro}</p>}
          {s.paragraphs.map((p, i) => <p key={i} style={{ margin: "0 0 0.5em" }}>{p}</p>)}
          {s.entries.map(e => (
            <div key={e.key} style={{ margin: "0.5em 0" }}>
              <p style={{ fontWeight: 700, margin: 0 }}>{e.subtitle ? `${e.title}, ${e.subtitle}` : e.title}</p>
              <p style={{ color: t.colours.muted, fontSize: px(t.type.base * 0.9), margin: 0 }}>{[e.when, e.status].filter(Boolean).join(" · ")}</p>
              {e.facts.length > 0 && <ul style={{ margin: "0.2em 0 0 1.2em", padding: 0, listStyle: "disc", fontSize: px(t.type.base * 0.95) }}>{e.facts.map(f => <li key={f}>{f}</li>)}</ul>}
            </div>
          ))}
        </section>
      ))}
      {model.legend.length > 0 && <p style={{ color: t.colours.muted, fontSize: px(t.type.base * 0.85), marginTop: "1.5em" }}>Status wording: {model.legend.join("; ")}.</p>}
      {(model.footer || t.footer.pageNumbers) && (
        <footer style={{ borderTop: "1px solid #E5E7EB", marginTop: "1.5em", paddingTop: 4, color: t.colours.muted, fontSize: px(t.type.base * 0.8), display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{model.footer}</span>{t.footer.pageNumbers && <span>Page numbers on export</span>}
        </footer>
      )}
    </article>
  );
}
