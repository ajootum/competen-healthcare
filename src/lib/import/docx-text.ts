import mammoth from "mammoth";

// .docx → text with list items explicitly marked.
//
// Why this exists: plain .docx→text conversion loses the difference between a
// list item and a heading, and the parser needs it. Mammoth converts Word's
// real numbering (w:numPr) into <li> elements, which we render back as "• "
// lines — a signal the parser detects reliably regardless of how the author's
// Word happened to save the file.

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
   .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

const strip = (s: string) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Convert a .docx buffer into marked plain text for the CPU parser. */
export async function docxToMarkedText(buffer: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const lines: string[] = [];

  // Walk the block elements in document order.
  const blockRe = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const text = strip(m[2]);
    if (!text) continue;
    lines.push(tag === "li" ? `• ${text}` : text);
  }
  return lines.join("\n");
}
