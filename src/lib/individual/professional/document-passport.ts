/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadLcpdConfig } from "../lcpd-config";
import { loadIndividualPolicy } from "../policy";
import { loadPassportSelection, type PassportItem } from "../passport-view";
import { emptyDraft, type DocRecord, type DraftContent } from "../documents/model";
import type { DocType } from "../documents-config";

// ── A DOCUMENT FROM A PASSPORT LINK ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s11 x COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7) ──
//
// Stage 7 stays authoritative for what a link carries: this reads it ONLY through Stage 7's loadPassportSelection, with the
// signed-in person's own id and a link the caller has already checked is theirs. It runs ONCE, when the draft is created,
// and turns the link's items into the Studio's own record keys, so a draft never stores a Passport item key (some are
// index-based until Stage 7's follow-up). Ids carried in the key (CPD, evidence, Learning, Scholar study, 530 evaluations,
// organisation competencies) map directly. The rest (profile records, competency parts, organisation credentials) are
// matched to the person's own catalogue by kind, title and date; anything not matched is reported, never guessed.
// After creation the draft is the person's to edit like any other. Nothing is written to the Passport.

const DIRECT: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^cpd:(.+)$/, m => `cpd:${m[1]}`], [/^evidence:(.+)$/, m => `evidence:${m[1]}`], [/^learning:(.+)$/, m => `learning_record:${m[1]}`],
  [/^study:(.+)$/, m => `study:${m[1]}`], [/^evaluation:530:(.+)$/, m => `evaluation:${m[1]}`], [/^institution:competency:(.+)$/, m => `org_assessment:${m[1]}`],
];
const KIND_OF: Record<string, DocRecord["kind"][]> = { profile: ["profile_item"], competency: ["competency", "verification"], institution: ["credential"] };
const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function mapPassportItems(items: readonly PassportItem[], records: readonly DocRecord[]): { keys: string[]; unmatched: string[] } {
  const own = new Map(records.map(r => [r.key, r]));
  const keys: string[] = [], unmatched: string[] = [];
  for (const it of items) {
    const direct = DIRECT.map(([re, f]) => { const m = it.key.match(re); return m ? f(m) : null; }).find(Boolean);
    if (direct) { if (own.has(direct)) keys.push(direct); else unmatched.push(it.title); continue; }
    const kinds = KIND_OF[it.category];
    // "Competency: evidence" parts carry the evidence title after the colon; the competency itself is the match.
    const title = it.category === "competency" ? it.title.split(": ")[0] : it.title;
    const hit = kinds ? records.find(r => kinds.includes(r.kind) && norm(r.title) === norm(title) && (!it.date || !r.date || r.date.slice(0, 10) === it.date.slice(0, 10) || r.from === it.date)) : undefined;
    if (hit) keys.push(hit.key); else if (it.key !== "profile:overview") unmatched.push(it.title);
  }
  return { keys: [...new Set(keys)], unmatched };
}

/** The draft a Passport link starts: its records placed in the first section of the type that takes them, its summary. */
export async function draftFromPassport(admin: any, userId: string, shareTokenId: string, type: DocType, records: readonly DocRecord[], today: string)
  : Promise<{ content: DraftContent; placed: number; unmatched: string[]; carriesNothing: boolean }> {
  const [policy, lcpd] = await Promise.all([loadIndividualPolicy(admin), loadLcpdConfig(admin)]);
  const sel = await loadPassportSelection(admin, userId, shareTokenId, { today, profile: policy.professionalProfile, competency: policy.professionalCompetency, lcpd, passport: policy.professionalPassport });
  const content = emptyDraft(type);
  if (!sel.meta && !sel.items.length) return { content, placed: 0, unmatched: [], carriesNothing: true };
  const { keys, unmatched } = mapPassportItems(sel.items, records);
  const byKey = new Map(records.map(r => [r.key, r]));
  let placed = 0;
  for (const k of keys) {
    const r = byKey.get(k)!;
    const sec = content.sections.find(s => r.sections.includes(s.code));
    if (!sec) { unmatched.push(r.title); continue; }
    sec.records.push({ key: k }); sec.visible = true; placed++;
  }
  if (sel.meta?.summary) { content.summary = sel.meta.summary.slice(0, 4000); const s = content.sections.find(x => x.code === "summary"); if (s) s.visible = true; }
  return { content, placed, unmatched, carriesNothing: false };
}
