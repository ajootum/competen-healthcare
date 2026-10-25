import { createHash } from "node:crypto";
import { SECTION_TITLE, type DocType, type Labels, type SectionCode, type Template, type Trust, type Validity } from "../documents-config";

// ── THE DOCUMENT MODEL ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.4-10.7 ──────────────────────────────────────────────
//
// ONE MODEL, THREE RENDERINGS. A draft (the person's presentation choices: sections, order, record references, hidden
// facts and their own words) and the records its owners return now make ONE DocModel. The on-screen preview, the DOCX and
// the PDF each render that same model, and every export records the sha256 of it, so the two files cannot differ in what
// they say and the person exports exactly what they previewed.
//
// ⚠ ONLY WHAT WAS CHOSEN. A record appears only if the person placed its key in a visible section. Choosing a section
// never pulls in its other records. A key whose record is gone (removed, withdrawn, now not offered) is left out and named
// in `missing`, never shown from an old copy: a draft holds no copies.
//
// ⚠ MEANING FROM THE OWNER. Each entry's status line is the template's WORDING of the record's trust and validity, which
// its owning module decided (documents-config.ts). Nothing here can make a record say more than its owner does.
//
// Pure: no I/O, no clock (today is passed in).

export type RecordKind = "profile_item" | "cpd" | "learning_record" | "evidence" | "competency" | "verification" | "org_assessment" | "credential" | "evaluation" | "study";

/** A record as the Studio may place it: its owner's facts, its meaning, and where it may go. */
export type DocRecord = {
  key: string; kind: RecordKind; sections: SectionCode[]; title: string; subtitle: string | null;
  from: string | null; to: string | null; date: string | null; trust: Trust; validity: Validity; source: string;
  facts: { code: string; label: string; value: string; defaultHidden?: boolean }[];
};

export type DraftRecord = { key: string; hide?: string[]; show?: string[] };
export type DraftSection = { code: SectionCode; visible: boolean; title?: string | null; intro?: string | null; records: DraftRecord[] };
export type DraftContent = { headline?: string | null; summary?: string | null; showContact?: boolean; sections: DraftSection[] };

export type Entry = { key: string; title: string; subtitle: string | null; when: string | null; status: string; facts: string[] };
export type ModelSection = { code: SectionCode; title: string; intro: string | null; paragraphs: string[]; entries: Entry[] };
export type DocModel = {
  title: string; author: string; subject: string; docType: string; template: { code: string; name: string; version: number };
  generatedOn: string;
  header: { name: string; headline: string | null; contact: string | null };
  sections: ModelSection[];
  legend: string[];
  footer: string | null;
  missing: string[];
  recordCount: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(d: string | null, f: Template["dateFormat"]): string | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const [y, m, day] = [d.slice(0, 4), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
  return f === "yyyy-mm-dd" ? d.slice(0, 10) : f === "mmm-yyyy" ? `${MONTHS[m - 1]} ${y}` : `${day} ${MONTHS[m - 1]} ${y}`;
}
const span = (r: DocRecord, f: Template["dateFormat"]) => {
  const a = formatDate(r.from, f), b = formatDate(r.to, f), one = formatDate(r.date, f);
  return a || b ? `${a ?? "Not recorded"} to ${b ?? "present"}` : one;
};

/** The template's words for what the owner decided. Lapsed states are always said. */
export function statusText(trust: Trust, validity: Validity, labels: Labels): string {
  const v = validity === "expired" || validity === "superseded" || validity === "revoked" ? ` · ${labels[validity]}` : "";
  return `${labels[trust]}${v}`;
}

export function buildDocModel(input: {
  type: DocType; template: Template; title: string; draft: DraftContent; records: ReadonlyMap<string, DocRecord>;
  person: { name: string; email: string | null; headline: string | null }; today: string;
}): DocModel {
  const { type, template: t, draft } = input;
  const missing: string[] = [];
  const used = new Set<string>();
  const sections: ModelSection[] = [];
  const order = draft.sections.filter(s => type.sections.includes(s.code));
  for (const s of order) {
    if (!s.visible) continue;
    const entries: Entry[] = [];
    for (const dr of s.records) {
      const r = input.records.get(dr.key);
      if (!r || !r.sections.includes(s.code) || (!type.rules.offerLapsed && r.validity !== "current" && r.validity !== "not_applicable")
        || (!type.rules.offerSelfDeclared && r.trust === "self_declared")) { missing.push(dr.key); continue; }
      if (used.has(r.key)) continue;
      used.add(r.key);
      const facts = r.facts.filter(f => (f.defaultHidden ? (dr.show ?? []).includes(f.code) : !(dr.hide ?? []).includes(f.code))).map(f => `${f.label}: ${f.value}`);
      entries.push({ key: r.key, title: r.title, subtitle: r.subtitle, when: span(r, t.dateFormat), status: statusText(r.trust, r.validity, t.labels), facts });
    }
    const paragraphs = s.code === "summary" && draft.summary?.trim() ? draft.summary.trim().split(/\n{2,}/).map(p => p.trim()).filter(Boolean) : [];
    if (!entries.length && !paragraphs.length && !s.intro?.trim()) continue;
    sections.push({ code: s.code, title: s.title?.trim() || t.sectionTitles[s.code] || SECTION_TITLE[s.code], intro: s.intro?.trim() || null, paragraphs, entries });
  }
  const trusts = new Set<string>();
  for (const sec of sections) for (const e of sec.entries) trusts.add(e.status);
  return {
    title: input.title, author: input.person.name, subject: type.label, docType: type.code,
    template: { code: t.code, name: t.name, version: t.version }, generatedOn: input.today,
    header: {
      name: input.person.name,
      headline: t.header.showHeadline ? (draft.headline?.trim() || input.person.headline || null) : null,
      contact: t.header.showContact && draft.showContact && input.person.email ? input.person.email : null,
    },
    sections,
    legend: [...trusts].sort(),
    footer: [t.branding.footerText || null, t.footer.generatedDate ? `Generated ${formatDate(input.today, "d-mmm-yyyy")} from records held in Competen.` : null].filter(Boolean).join(" ") || null,
    missing,
    recordCount: used.size,
  };
}

/** The exact text a rendering must carry, in order: what the parity check compares across DOCX, PDF and the preview. */
export function modelLines(m: DocModel): string[] {
  const out = [m.header.name, ...(m.header.headline ? [m.header.headline] : []), ...(m.header.contact ? [m.header.contact] : [])];
  for (const s of m.sections) {
    out.push(s.title);
    if (s.intro) out.push(s.intro);
    out.push(...s.paragraphs);
    for (const e of s.entries) {
      out.push(e.subtitle ? `${e.title}, ${e.subtitle}` : e.title);
      out.push([e.when, e.status].filter(Boolean).join(" · "));
      out.push(...e.facts);
    }
  }
  if (m.legend.length) out.push(`Status wording: ${m.legend.join("; ")}.`);
  if (m.footer) out.push(m.footer);
  return out;
}

/** sha256 of the content (not the generation date): the same choices on the same records hash the same. */
export const modelHash = (m: DocModel) => createHash("sha256").update(JSON.stringify({ ...m, generatedOn: null, missing: null })).digest("hex");

/** A new draft's sections: the type's order, default-on sections visible, no records chosen yet. */
export function emptyDraft(type: DocType): DraftContent {
  return { headline: null, summary: null, showContact: false, sections: type.sections.map(code => ({ code, visible: type.on.includes(code), records: [] })) };
}

/** Pure: a draft as submitted, against the type and the records the person may use. Unknown keys are refused. */
export function parseDraft(b: unknown, type: DocType, allowed: ReadonlySet<string>): { ok: true; value: DraftContent } | { ok: false; error: string } {
  const x = b as Partial<DraftContent> | null;
  if (!x || typeof x !== "object" || !Array.isArray(x.sections)) return { ok: false, error: "The document could not be read." };
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const sections: DraftSection[] = [];
  for (const s of x.sections) {
    if (!s || !type.sections.includes(s.code as SectionCode) || sections.some(o => o.code === s.code)) return { ok: false, error: "A section is not part of this document type." };
    const records: DraftRecord[] = [];
    for (const r of Array.isArray(s.records) ? s.records.slice(0, 300) : []) {
      if (!r || typeof r.key !== "string" || !allowed.has(r.key)) return { ok: false, error: "Only your own records can be placed in a document." };
      const codes = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && /^[a-z_]{1,40}$/.test(c)).slice(0, 20) : []);
      records.push({ key: r.key, hide: codes(r.hide), show: codes(r.show) });
    }
    sections.push({ code: s.code as SectionCode, visible: s.visible !== false, title: text(s.title, 60), intro: text(s.intro, 1000), records });
  }
  return { ok: true, value: { headline: text(x.headline, 160), summary: text(x.summary, 4000), showContact: x.showContact === true, sections } };
}
