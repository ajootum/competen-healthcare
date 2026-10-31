import fs from "node:fs";
const p = "src/lib/individual/scholar/flashcard-pdf.test.ts";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 80)); s = s.replace(a, b); };
rep(`    expect(exportFilename("✓✓", "deck", "x")).toBe("Competen-Scholar-cards-flashcards-undated.pdf");
  });`, `    expect(exportFilename("✓✓", "deck", "x")).toBe("Competen-Scholar-cards-flashcards-undated.pdf");
    expect(exportFilename("Resp", "print", RESP_GENERATED_AT, { layout: "fold" })).toBe("Competen-Scholar-Resp-printable-cards-foldable-2026-10-31.pdf");
    expect(exportFilename("Resp", "guide", RESP_GENERATED_AT, { guide: "concise" })).toBe("Competen-Scholar-Resp-revision-guide-concise-2026-10-31.pdf");
  });`);
rep(`    for (const format of ["deck", "print", "guide"]) {
      const r = await get(\`format=\${format}\`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/pdf");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="Competen-Scholar-All-cards-(flashcards|printable-cards|revision-guide)-\d{4}-\d{2}-\d{2}\.pdf"$/);`,
`    // QA-01: all five downloads -- the deck, double-sided and foldable cards, comprehensive and concise guide.
    for (const format of ["deck", "print", "print&layout=fold", "guide", "guide&guide=concise"]) {
      const r = await get(\`format=\${format}\`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/pdf");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="Competen-Scholar-All-cards-(flashcards|printable-cards|printable-cards-foldable|revision-guide|revision-guide-concise)-\d{4}-\d{2}-\d{2}\.pdf"$/);`);
rep(`    expect(audits.map(a => a.action)).toEqual(Array(3).fill("individual_scholar_flashcard_export"));`,
    `    expect(audits.map(a => a.action)).toEqual(Array(5).fill("individual_scholar_flashcard_export"));
    expect(audits.map(a => [a.new_value.format, a.new_value.layout, a.new_value.guide])).toEqual([
      ["deck", null, null], ["print", "duplex", null], ["print", "fold", null], ["guide", null, "comprehensive"], ["guide", null, "concise"],
    ]);`);
fs.writeFileSync(p, s);
