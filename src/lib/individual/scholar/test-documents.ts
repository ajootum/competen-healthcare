// A minimal, valid PDF built in code, for the unit tests (extract.test.ts) and the staging acceptance
// harness (scripts/scholar-acceptance-harness.ts), so neither needs a fixture file. Each page is a list of
// lines, drawn top-down. ASCII text only; parentheses and backslashes are escaped as PDF strings require.

const pdfString = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export function tinyPdf(pages: (string | string[])[]): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = 2 + pages.length * 2;
  const pageIds: number[] = [];
  for (const p of pages) {
    const lines = Array.isArray(p) ? p : [p];
    const body = lines.map((l, i) => `${i === 0 ? "72 720 Td" : "0 -16 Td"} (${pdfString(l)}) Tj`).join(" ");
    const stream = `BT /F1 11 Tf ${body} ET`;
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((s, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${s}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out);
}

// ── UPLOAD-01: a minimal PowerPoint and Word file, built in code the same way ──────────────────────────────
//
// Real Office Open XML packages (a ZIP of XML parts), just enough for the readers: PowerPoint slides with
// DrawingML text and optional speaker notes, and a Word body of paragraphs. `extra` adds raw parts (a test of
// the screening, such as a macro project). ASCII text only.

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const drawingParas = (lines: string[]) => lines.map(l => `<a:p><a:r><a:t>${xmlEsc(l)}</a:t></a:r></a:p>`).join("");

export async function tinyPptx(slides: { text: string[]; notes?: string[] }[], extra: Record<string, string> = {}): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${A}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}"/>`).join("")}</p:sldIdLst></p:presentation>`);
  slides.forEach((s, i) => {
    const n = i + 1;
    zip.file(`ppt/slides/slide${n}.xml`, `<?xml version="1.0"?><p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody>${drawingParas(s.text)}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (s.notes?.length) {
      zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`);
      zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<?xml version="1.0"?><p:notes ${A}><p:cSld><p:spTree><p:sp><p:txBody>${drawingParas([...s.notes, String(n)])}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
    }
  });
  for (const [name, body] of Object.entries(extra)) zip.file(name, body);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

export async function tinyDocx(paragraphs: string[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}
