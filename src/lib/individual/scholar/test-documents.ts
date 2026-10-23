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
