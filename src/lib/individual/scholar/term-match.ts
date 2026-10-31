// SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct): KEY-TERM SUPPORT WITHOUT LITERAL-ONLY MATCHING. Pure, deterministic,
// no AI and no embeddings: cost and latency matter. A key term is covered by a text when the text holds
//   1. a word starting with the term's five-letter stem (exactly the rule before: nothing covered before is lost);
//   2. the same root after stripping a closed list of suffixes (cultur-e / cultur-al, analys-is / analys-es);
//   3. a member of the term's curated group (TERM_GROUPS): a morphological irregular (error / erroneous), a spelling
//      variant (paediatric / pediatric) or an abbreviation and its expansion (PDSA / Plan-Do-Study-Act);
//   4. for an abbreviation, a hyphenated compound whose initials spell it ("Plan-Do-Study-Act" for pdsa).
// Hyphens and plurals are normalised by the word split and the suffix strip. Numbers, months and identifiers are never
// matched here: the grounding verifier (src/lib/ai/grounding.ts) keeps them literal.

/** Curated, closed. Each group: words or phrases meaning the same thing. Lower case, hyphens as spaces. */
export const TERM_GROUPS: readonly (readonly string[])[] = [
  ["error", "erroneous"],
  ["pdsa", "plan do study act"], ["sbar", "situation background assessment recommendation"], ["rca", "root cause analysis"],
  ["qi", "quality improvement"], ["hcai", "healthcare associated infection"], ["ipc", "infection prevention and control"],
  ["ppe", "personal protective equipment"], ["mdt", "multidisciplinary team"], ["sop", "standard operating procedure"],
  ["copd", "chronic obstructive pulmonary disease"], ["dvt", "deep vein thrombosis"], ["uti", "urinary tract infection"],
  ["cpr", "cardiopulmonary resuscitation"], ["gcs", "glasgow coma scale"], ["avpu", "alert voice pain unresponsive"],
  ["abcde", "airway breathing circulation disability exposure"], ["ews", "early warning score"], ["bp", "blood pressure"],
  ["paediatric", "pediatric"], ["haemorrhage", "hemorrhage"], ["oedema", "edema"], ["anaemia", "anemia"], ["haemoglobin", "hemoglobin"],
  ["oesophagus", "esophagus"], ["behaviour", "behavior"], ["organisation", "organization"], ["colour", "color"], ["anaesthesia", "anesthesia"],
];

const SUFFIXES = ["isations", "isation", "izations", "ization", "ations", "ation", "itions", "ition", "tions", "tion", "ments", "ment", "ness", "ities", "ity",
  "ingly", "ings", "ing", "edly", "ed", "ally", "ly", "ies", "es", "al", "ous", "ive", "ic", "s", "e"];

const words = (text: string) => text.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/).filter(Boolean);
const stem5 = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);

/** Pure. A word's root: up to two strips of a closed suffix that leave at least four letters. */
export function termRoot(word: string): string {
  let w = word.toLowerCase();
  for (let i = 0; i < 2; i++) {
    const s = SUFFIXES.find(x => w.endsWith(x) && w.length - x.length >= 4);
    if (!s) break;
    w = w.slice(0, -s.length);
  }
  return w;
}

/** A text, read once: its words, their roots, its phrase form and the initials of its hyphenated compounds. */
export type TermIndex = { words: string[]; roots: Set<string>; phrase: string; initials: Set<string> };
export function termIndex(text: string): TermIndex {
  const ws = words(text);
  const initials = new Set<string>();
  for (const tok of text.toLowerCase().normalize("NFKD").split(/\s+/)) {
    const parts = tok.replace(/^[^a-z]+|[^a-z]+$/g, "").split("-").filter(Boolean);
    if (parts.length >= 2 && parts.every(p => /^[a-z]+$/.test(p))) initials.add(parts.map(p => p[0]).join(""));
  }
  return { words: ws, roots: new Set(ws.filter(w => !/^\d+$/.test(w)).map(termRoot)), phrase: ` ${ws.join(" ")} `, initials };
}

const isWordTerm = (t: string) => /^[a-z]+$/.test(t);
const holdsWord = (ix: TermIndex, w: string) => ix.words.some(x => x.startsWith(stem5(w))) || (w.length >= 4 && ix.roots.has(termRoot(w)));
const holdsMember = (ix: TermIndex, m: string) => (m.includes(" ") ? ix.phrase.includes(` ${m} `) : holdsWord(ix, m) || ix.initials.has(m));

/** Pure. Whether the indexed text supports the key term. */
export function termCovered(term: string, ix: TermIndex): boolean {
  const t = term.toLowerCase();
  if (ix.words.some(w => w.startsWith(stem5(t)))) return true; // the rule before, unchanged
  if (!isWordTerm(t)) return false; // a number is literal
  if (t.length >= 4 && ix.roots.has(termRoot(t))) return true;
  if (t.length >= 2 && t.length <= 6 && ix.initials.has(t)) return true;
  for (const g of TERM_GROUPS) {
    // The term is a member (a word), or one word of a member phrase whose abbreviation the text holds.
    const own = g.some(m => !m.includes(" ") && (m === t || (t.length >= 4 && m.length >= 4 && termRoot(m) === termRoot(t))));
    if (own && g.some(m => holdsMember(ix, m))) return true;
    const inPhrase = g.some(m => m.includes(" ") && m.split(" ").includes(t));
    if (inPhrase && g.some(m => !m.includes(" ") && holdsMember(ix, m))) return true;
  }
  return false;
}
