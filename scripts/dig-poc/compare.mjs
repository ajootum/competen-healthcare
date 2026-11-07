// COMPETEN-DIG-001 proof of concept. Each reader against PowerPoint's own object model, slide by slide. Numbers only.
// usage: node compare.mjs <reference.json> <reader units.json | markitdown/docling json> [...]   prints one JSON row per reader
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const strip = s => s.replace(/^﻿/, "");
const ref = JSON.parse(strip(readFileSync(process.argv[2], "utf8")));
const words = t => String(t ?? "").replace(/[\u000b\r\n\t]/g, " ").toLowerCase().split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "")).filter(Boolean);
const list = v => v == null ? [] : Array.isArray(v) ? v : [v];
function shapeText(s) {
  const out = [];
  if (s.text) out.push(s.text);
  for (const r of list(s.table)) out.push(...list(r));
  if (s.chart) { out.push(s.chart.title); const series = list(s.chart.series); out.push(...list(series[0]?.categories)); for (const se of series) out.push(se.name, ...list(se.values)); }
  for (const n of list(s.smartart)) out.push(n);
  for (const c of list(s.children)) out.push(...shapeText(c));
  return out;
}
const flat = s => [s, ...list(s.children).flatMap(flat)];
const slides = list(ref.slides);
function geometric(slide) {
  // Title first, then top to bottom and left to right, half an inch to a row, from PowerPoint's own coordinates.
  const items = list(slide.shapes).flatMap(flat).filter(s => !s.children);
  const isTitle = s => s.placeholder === 1 || s.placeholder === 3;
  const body = items.filter(s => !isTitle(s)).sort((a, b) => a.top - b.top);
  const rows = [];
  for (const s of body) { const r = rows[rows.length - 1]; if (r && s.top - r[0].top <= 36) r.push(s); else rows.push([s]); }
  return [...items.filter(isTitle), ...rows.flatMap(r => r.sort((a, b) => a.left - b.left))].flatMap(shapeText).join(" ");
}
const lcs = (a, b) => { let p = new Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { const r = new Array(b.length + 1).fill(0); for (let j = 1; j <= b.length; j++) r[j] = a[i - 1] === b[j - 1] ? p[j - 1] + 1 : Math.max(p[j], r[j - 1]); p = r; } return p[b.length]; };
const count = (r, c) => { const left = new Map(); for (const w of c) left.set(w, (left.get(w) ?? 0) + 1); let f = 0; const miss = []; for (const w of r) { const n = left.get(w) ?? 0; if (n > 0) { left.set(w, n - 1); f++; } else miss.push(w); } return { f, miss }; };
for (const file of process.argv.slice(3)) {
  const j = JSON.parse(strip(readFileSync(file, "utf8")));
  const rows = Array.isArray(j) ? j : j.slides;
  const byN = new Map(rows.map(r => [r.n, r.text]));
  let refW = 0, found = 0, orderFound = 0, notesW = 0, notesFound = 0, cand = 0;
  const lost = [];
  for (const s of slides) {
    // Compared under the slide's place in the deck. The readers under test number by part, so a deck with moved slides is matched through its map in the fixture run.
    const r = words(list(s.shapes).flatMap(shapeText).join(" "));
    const nt = words(s.notes);
    const c = words(byN.get(s.index));
    cand += c.length;
    const { f, miss } = count(r, c);
    refW += r.length; found += f;
    notesW += nt.length; notesFound += count(nt, c).f;
    const geo = words(geometric(s));
    const set = new Set(geo);
    orderFound += geo.length ? lcs(geo, c.filter(w => set.has(w))) : 0;
    if (f < r.length) lost.push({ slide: s.index, of: r.length, missed: r.length - f, sampleLengths: miss.slice(0, 6).map(w => w.length) });
  }
  console.log(JSON.stringify({ reader: basename(file).replace(/\.(units\.)?json$/, ""), slides: rows.length, refWords: refW, found, recall: +(found / refW).toFixed(4), notesWords: notesW, notesFound, orderKept: +(orderFound / refW).toFixed(4), candWords: cand, slidesWithLoss: lost.length, lost }));
}
