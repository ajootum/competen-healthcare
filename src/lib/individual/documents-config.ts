/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";

// ── PROFESSIONAL DOCUMENT STUDIO: DOCUMENT TYPES AND TEMPLATES ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.1-10.3 ─────────
//
// One CONFIG-002 document in the Individual policy scope (platform / individual), drafted and published with the rest of
// the Individual policy through the existing audited, versioned route (/api/hq/individual/config, action "documents",
// hq.individual.config.manage), exactly as the LCPD document is. Unpublished means the defaults below. It configures:
//
//   types       document types: label, default sections and order, which are on by default, export formats, which
//               templates may be used, and record-selection rules. A new type is configuration, never a new generator.
//   templates   page size and orientation, margins, typeface, sizes, colours, branding, header and footer, page numbers,
//               date format, section titles and the evidence/verification wording. Each carries a VERSION, raised
//               automatically on publish whenever its content changes, so a draft and an export name exactly what they used.
//
// ⚠ WHAT NO TEMPLATE CAN DO (owner GO s10.3, beneath configuration). The meaning of a record (self-declared, document-
// supported, recorded by Competen Learning, formative, independently decided, expired, superseded, revoked) is decided in
// code from the record's OWNER, never by a template. A template only words it, and a label for anything that is not an
// independent decision may not say "verified" without "not". Templates cannot add records, sections the catalogue does not
// know, private reflections, AI conversations or another person's records. Photographs are "off": no image is ever fetched.
//
// This module imports nothing of Professional (individual-professional-harness R2): the HQ door reads it too.

export const DOCUMENTS_PATH = "individual.professional_documents";

export const SECTION_CODES = [
  "summary", "education", "qualifications", "registrations", "employment", "specialties", "learning_cpd", "competencies",
  "assessments_evidence", "verified_achievements", "evaluations", "research", "teaching", "quality_improvement", "career_interests",
] as const;
export type SectionCode = (typeof SECTION_CODES)[number];
export const SECTION_TITLE: Record<SectionCode, string> = {
  summary: "Professional summary", education: "Education", qualifications: "Qualifications", registrations: "Registration and licensing",
  employment: "Employment history", specialties: "Specialties", learning_cpd: "Learning and CPD", competencies: "Competencies",
  assessments_evidence: "Assessments and evidence", verified_achievements: "Independently decided achievements", evaluations: "Professional development evaluations",
  research: "Research and publications", teaching: "Teaching", quality_improvement: "Quality improvement", career_interests: "Career interests",
};

/** The meaning of a record, decided from its owner (never by a template). */
export const TRUST_CODES = ["self_declared", "document_supported", "platform_recorded", "formative", "institution", "independent"] as const;
export type Trust = (typeof TRUST_CODES)[number];
export const VALIDITY_CODES = ["current", "expired", "superseded", "revoked", "not_applicable"] as const;
export type Validity = (typeof VALIDITY_CODES)[number];
export type Labels = Record<Trust | Exclude<Validity, "current" | "not_applicable">, string>;
export const DEFAULT_LABELS: Labels = {
  self_declared: "Self-declared", document_supported: "Self-declared, document attached", platform_recorded: "Recorded by Competen Learning",
  formative: "Formative, not verification", institution: "Issued by an organisation", independent: "Independently verified",
  expired: "Expired", superseded: "Superseded", revoked: "Revoked",
};

export type Format = "docx" | "pdf";
export type DocType = {
  code: string; label: string; description: string; sections: SectionCode[]; on: SectionCode[]; formats: Format[]; templates: string[];
  /** Record-selection rules: whether expired, superseded or revoked items are offered at all, and whether self-declared are. */
  rules: { offerLapsed: boolean; offerSelfDeclared: boolean };
};
export type Template = {
  code: string; name: string; version: number; description: string; docTypes: string[] | "all";
  page: { size: "A4" | "Letter"; orientation: "portrait" | "landscape"; margins: { top: number; right: number; bottom: number; left: number } };
  type: { face: "sans" | "serif"; base: number; headingScale: number; lineSpacing: number };
  colours: { accent: string; text: string; muted: string };
  branding: { showCompetenMark: boolean; footerText: string };
  header: { showHeadline: boolean; showContact: boolean };
  footer: { pageNumbers: boolean; generatedDate: boolean };
  photo: "off";
  dateFormat: "d-mmm-yyyy" | "mmm-yyyy" | "yyyy-mm-dd";
  sectionTitles: Partial<Record<SectionCode, string>>;
  labels: Labels;
};
export type DocumentsConfig = { types: DocType[]; templates: Template[] };

const T = (over: Partial<Template> & Pick<Template, "code" | "name" | "description">): Template => ({
  version: 1, docTypes: "all",
  page: { size: "A4", orientation: "portrait", margins: { top: 20, right: 18, bottom: 20, left: 18 } },
  type: { face: "sans", base: 10.5, headingScale: 1.35, lineSpacing: 1.25 },
  colours: { accent: "#1F2937", text: "#111827", muted: "#4B5563" },
  branding: { showCompetenMark: false, footerText: "" },
  header: { showHeadline: true, showContact: false },
  footer: { pageNumbers: true, generatedDate: true },
  photo: "off", dateFormat: "mmm-yyyy", sectionTitles: {}, labels: DEFAULT_LABELS,
  ...over,
});

export const DEFAULT_TEMPLATES: Template[] = [
  T({ code: "classic-professional", name: "Classic Professional", description: "Serif headings, generous spacing, a traditional CV.", type: { face: "serif", base: 10.5, headingScale: 1.35, lineSpacing: 1.25 } }),
  T({ code: "modern-minimal", name: "Modern Minimal", description: "Clean sans-serif with an accent rule.", colours: { accent: "#4F46E5", text: "#111827", muted: "#4B5563" } }),
  T({ code: "academic-research", name: "Academic & Research", description: "Serif, compact, with full dates for publications and teaching.", type: { face: "serif", base: 10, headingScale: 1.3, lineSpacing: 1.2 }, dateFormat: "d-mmm-yyyy" }),
  T({ code: "clinical-portfolio", name: "Clinical Portfolio", description: "Evidence labels on every entry, for portfolios and reviews.", colours: { accent: "#0F766E", text: "#111827", muted: "#4B5563" }, dateFormat: "d-mmm-yyyy" }),
  T({ code: "cpd-summary", name: "CPD Summary", description: "Compact listing of learning and CPD.", type: { face: "sans", base: 10, headingScale: 1.3, lineSpacing: 1.2 }, docTypes: ["cpd-learning-report", "short-resume"], dateFormat: "d-mmm-yyyy" }),
  T({ code: "competen-passport", name: "Competen Passport", description: "The Competen Passport layout, with its mark and status wording.", colours: { accent: "#4F46E5", text: "#111827", muted: "#4B5563" },
    branding: { showCompetenMark: true, footerText: "Statuses are as recorded on the date generated. Check current status with the issuer." }, docTypes: ["passport-export", "competency-evidence-summary", "professional-portfolio"], dateFormat: "d-mmm-yyyy" }),
];

const ALL_FORMATS: Format[] = ["docx", "pdf"];
const D = (code: string, label: string, description: string, sections: SectionCode[], on: SectionCode[], templates: string[], rules = { offerLapsed: false, offerSelfDeclared: true }): DocType =>
  ({ code, label, description, sections, on, formats: ALL_FORMATS, templates, rules });
export const DEFAULT_TYPES: DocType[] = [
  D("professional-cv", "Professional CV", "A full professional CV.",
    ["summary", "registrations", "employment", "education", "qualifications", "specialties", "learning_cpd", "competencies", "verified_achievements", "research", "teaching", "quality_improvement", "career_interests"],
    ["summary", "registrations", "employment", "education", "qualifications", "learning_cpd"], ["classic-professional", "modern-minimal", "academic-research", "clinical-portfolio"]),
  D("short-resume", "Short Resume", "One or two pages: the essentials.", ["summary", "employment", "qualifications", "registrations", "learning_cpd"], ["summary", "employment", "qualifications"], ["modern-minimal", "classic-professional", "cpd-summary"]),
  D("passport-export", "Competen Passport Export", "The records you chose, with their status wording.", ["summary", "registrations", "qualifications", "verified_achievements", "competencies", "learning_cpd", "evaluations"], ["registrations", "qualifications", "verified_achievements", "competencies", "learning_cpd"], ["competen-passport"], { offerLapsed: true, offerSelfDeclared: true }),
  D("professional-portfolio", "Professional Portfolio", "Evidence of development and practice, for a review or a portfolio.", ["summary", "employment", "learning_cpd", "competencies", "assessments_evidence", "evaluations", "verified_achievements", "teaching", "research", "quality_improvement"], ["summary", "learning_cpd", "competencies", "assessments_evidence"], ["clinical-portfolio", "competen-passport", "academic-research"], { offerLapsed: true, offerSelfDeclared: true }),
  D("cpd-learning-report", "CPD & Learning Report", "Learning and CPD over a period, as recorded. Not a statement of compliance.", ["summary", "learning_cpd", "assessments_evidence"], ["learning_cpd"], ["cpd-summary", "modern-minimal"]),
  D("competency-evidence-summary", "Competency Evidence Summary", "Competencies with their evidence and any independent decision, kept apart.", ["summary", "competencies", "assessments_evidence", "verified_achievements", "evaluations"], ["competencies", "verified_achievements"], ["competen-passport", "clinical-portfolio"], { offerLapsed: true, offerSelfDeclared: true }),
  D("career-development-summary", "Career Development Summary", "Your path so far and where you want to go.", ["summary", "employment", "education", "specialties", "career_interests", "learning_cpd", "evaluations"], ["summary", "employment", "career_interests"], ["modern-minimal", "classic-professional"]),
];
export const DEFAULT_DOCUMENTS: DocumentsConfig = { types: DEFAULT_TYPES, templates: DEFAULT_TEMPLATES };

// ── VALIDATION (the hard limits) ─────────────────────────────────────────────────────────────────────────────

const CODE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const str = (v: unknown, min: number, max: number) => (typeof v === "string" && v.trim().length >= min && v.trim().length <= max ? v.trim() : null);
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const pick = <T extends string>(v: unknown, opts: readonly T[]): T | null => (typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : null);
const sections = (v: unknown): SectionCode[] | null => Array.isArray(v) && v.every(s => (SECTION_CODES as readonly string[]).includes(s)) && new Set(v).size === v.length ? (v as SectionCode[]) : null;

/** A label for anything that is not an independent decision may not claim verification. */
export function labelHonest(key: keyof Labels, label: string): boolean {
  if (key === "independent" || key === "institution") return label.length >= 3;
  return !/verified/i.test(label) || /\bnot\b|\bun/i.test(label);
}

type V<T> = { ok: true; value: T } | { ok: false; error: string };
export function checkTemplate(t: any): V<Template> {
  const code = typeof t?.code === "string" && CODE.test(t.code) ? t.code : null;
  const name = str(t?.name, 2, 80);
  if (!code || !name) return { ok: false, error: "Each template needs a code (lower-case letters, digits, dashes) and a name." };
  const at = (what: string) => ({ ok: false as const, error: `${name}: ${what}` });
  const size = pick(t?.page?.size, ["A4", "Letter"] as const), orientation = pick(t?.page?.orientation, ["portrait", "landscape"] as const);
  const m = t?.page?.margins ?? {};
  const margins = { top: num(m.top, 8, 40), right: num(m.right, 8, 40), bottom: num(m.bottom, 8, 40), left: num(m.left, 8, 40) };
  if (!size || !orientation || Object.values(margins).some(x => x === null)) return at("page size, orientation and margins (8 to 40 mm) are required.");
  const face = pick(t?.type?.face, ["sans", "serif"] as const), base = num(t?.type?.base, 8, 14), headingScale = num(t?.type?.headingScale, 1, 2), lineSpacing = num(t?.type?.lineSpacing, 1, 2);
  if (!face || base === null || headingScale === null || lineSpacing === null) return at("typeface (sans or serif), base size 8 to 14 pt, heading scale 1 to 2 and line spacing 1 to 2 are required.");
  const c = t?.colours ?? {};
  if (![c.accent, c.text, c.muted].every((x: unknown) => typeof x === "string" && HEX.test(x))) return at("colours must be #RRGGBB.");
  const footerText = typeof t?.branding?.footerText === "string" ? t.branding.footerText.trim() : "";
  if (footerText.length > 200) return at("footer text is at most 200 characters.");
  const dateFormat = pick(t?.dateFormat, ["d-mmm-yyyy", "mmm-yyyy", "yyyy-mm-dd"] as const);
  if (!dateFormat) return at("choose a date format.");
  if (t?.photo !== undefined && t.photo !== "off") return at("photographs are not offered: no image is ever fetched into a document.");
  const docTypes = t?.docTypes === "all" || t?.docTypes === undefined ? "all" : Array.isArray(t.docTypes) && t.docTypes.every((d: unknown) => typeof d === "string" && CODE.test(d)) ? t.docTypes : null;
  if (!docTypes) return at("document types must be \"all\" or a list of type codes.");
  const titles: Partial<Record<SectionCode, string>> = {};
  for (const [k, v] of Object.entries(t?.sectionTitles ?? {})) {
    if (!(SECTION_CODES as readonly string[]).includes(k)) return at(`"${k}" is not a section.`);
    const s = str(v, 2, 60);
    if (!s) return at(`the title for ${k} must be 2 to 60 characters.`);
    titles[k as SectionCode] = s;
  }
  const labels = { ...DEFAULT_LABELS };
  for (const [k, v] of Object.entries(t?.labels ?? {})) {
    if (!(k in DEFAULT_LABELS)) return at(`"${k}" is not an evidence or status label.`);
    const s = str(v, 3, 80);
    if (!s) return at(`the ${k} label must be 3 to 80 characters.`);
    if (!labelHonest(k as keyof Labels, s)) return at(`the ${k} label may not claim verification.`);
    labels[k as keyof Labels] = s;
  }
  return { ok: true, value: {
    code, name, version: Number.isInteger(t?.version) && t.version >= 1 ? t.version : 1, description: str(t?.description, 0, 300) ?? "", docTypes,
    page: { size, orientation, margins: margins as Template["page"]["margins"] }, type: { face, base, headingScale, lineSpacing },
    colours: { accent: c.accent, text: c.text, muted: c.muted }, branding: { showCompetenMark: t?.branding?.showCompetenMark === true, footerText },
    header: { showHeadline: t?.header?.showHeadline !== false, showContact: t?.header?.showContact === true },
    footer: { pageNumbers: t?.footer?.pageNumbers !== false, generatedDate: t?.footer?.generatedDate !== false },
    photo: "off", dateFormat, sectionTitles: titles, labels,
  } };
}

export function checkType(d: any, templateCodes: ReadonlySet<string>): V<DocType> {
  const code = typeof d?.code === "string" && CODE.test(d.code) ? d.code : null;
  const label = str(d?.label, 2, 80);
  if (!code || !label) return { ok: false, error: "Each document type needs a code and a label." };
  const secs = sections(d?.sections), on = sections(d?.on ?? []);
  if (!secs?.length || !on || on.some(s => !secs.includes(s))) return { ok: false, error: `${label}: sections must be known section codes, without repeats, and default-on sections must be among them.` };
  const formats = Array.isArray(d?.formats) && d.formats.length && d.formats.every((f: unknown) => f === "docx" || f === "pdf") ? [...new Set(d.formats as Format[])] : null;
  if (!formats) return { ok: false, error: `${label}: choose DOCX, PDF or both.` };
  const templates = Array.isArray(d?.templates) && d.templates.length && d.templates.every((t: unknown) => typeof t === "string" && templateCodes.has(t)) ? d.templates as string[] : null;
  if (!templates) return { ok: false, error: `${label}: name at least one template that exists.` };
  return { ok: true, value: { code, label, description: str(d?.description, 0, 300) ?? "", sections: secs, on, formats, templates,
    rules: { offerLapsed: d?.rules?.offerLapsed === true, offerSelfDeclared: d?.rules?.offerSelfDeclared !== false } } };
}

const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
/** The content of a template (not its version), independent of key order. */
export const templateHash = (t: Template) => createHash("sha256").update(JSON.stringify(canonical({ ...t, version: 0 }))).digest("hex");

/**
 * Pure: a draft from HQ, validated whole. `published` is what is live now: a template whose content changed keeps its
 * code and gets the next version, so a draft and an export always name exactly the template they used.
 */
export function checkDocumentsDraft(input: any, published: DocumentsConfig = DEFAULT_DOCUMENTS): { ok: true; settings: DocumentsConfig } | { ok: false; error: string } {
  const templates: Template[] = [];
  for (const raw of Array.isArray(input?.templates) ? input.templates : []) {
    const c = checkTemplate(raw);
    if (!c.ok) return c;
    if (templates.some(t => t.code === c.value.code)) return { ok: false, error: `Two templates share the code ${c.value.code}.` };
    const live = published.templates.find(t => t.code === c.value.code);
    const version = !live ? Math.max(1, c.value.version) : templateHash({ ...c.value, version: live.version }) === templateHash(live) ? live.version : live.version + 1;
    templates.push({ ...c.value, version });
  }
  if (!templates.length) return { ok: false, error: "Keep at least one template." };
  const codes = new Set(templates.map(t => t.code));
  const types: DocType[] = [];
  for (const raw of Array.isArray(input?.types) ? input.types : []) {
    const c = checkType(raw, codes);
    if (!c.ok) return c;
    if (types.some(t => t.code === c.value.code)) return { ok: false, error: `Two document types share the code ${c.value.code}.` };
    types.push(c.value);
  }
  if (!types.length) return { ok: false, error: "Keep at least one document type." };
  return { ok: true, settings: { types, templates } };
}

/** Pure: a stored value read back. Anything malformed falls back to the defaults, whole. */
export function resolveDocuments(raw: any): DocumentsConfig {
  if (!raw) return DEFAULT_DOCUMENTS;
  const c = checkDocumentsDraft(raw, { types: [], templates: [] });
  if (!c.ok) return DEFAULT_DOCUMENTS;
  // Versions as stored (the draft check above treats everything as new).
  return { types: c.settings.types, templates: c.settings.templates.map(t => ({ ...t, version: (raw.templates.find((r: any) => r?.code === t.code)?.version as number) ?? 1 })) };
}

/** The published configuration and its WCE row. Unreadable or unpublished: the defaults. Never throws. */
export async function loadDocumentsConfig(admin: any): Promise<DocumentsConfig> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published").eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", DOCUMENTS_PATH).maybeSingle();
    return error ? DEFAULT_DOCUMENTS : resolveDocuments(data?.published ?? null);
  } catch { return DEFAULT_DOCUMENTS; }
}

export const templatesFor = (cfg: DocumentsConfig, type: DocType) => cfg.templates.filter(t => type.templates.includes(t.code) && (t.docTypes === "all" || t.docTypes.includes(type.code)));
