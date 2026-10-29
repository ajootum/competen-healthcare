/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { reviewQueue } from "./clinical-review-hq";
import { CLINICAL_STATE_LABEL, loadClinicalReviews } from "./clinical-review";
import { contentHashes } from "./review-batch";
import { checksFor } from "./criteria-checks";
export { checksFor };

// ── THE CLINICAL REVIEW PACK ── owner, 29 Oct 2026 ─────────────────────────────────────────────────────────────────
//
// A printable (PDF, through the browser) and editable (Word) copy of competencies for a PAPER review: each with its
// criteria grouped by component in source wording, its exact content version and fingerprint, points worth checking,
// and a blank decision block.
//
// ⚠ PAPER IS FOR READING AND NOTES, NEVER THE APPROVAL. A decision counts only when the reviewer records it in Competen
// against the version shown (migration 395). Every page says so, and every competency carries its version and its
// content fingerprint, so a note on paper maps to exactly one version. If the content changed since the pack was made,
// the fingerprint no longer matches and the system asks for a fresh review.
//
// Two packs, from the existing reads only: the REVIEWER's (their current queue, reviewQueue, so only what they may
// decide) and a FRAMEWORK's (for its authors: every competency at its current content, with its review state).

export type PackCriterion = { n: string; text: string; sourceRef: string | null };
export type PackCompetency = {
  competencyId: string; code: string | null; name: string; domain: string; framework: string;
  versionId: string | null; fingerprint: string | null; state: string; approvals: number; required: number;
  description: string | null; outcomes: string[];
  groups: { label: string; criteria: PackCriterion[] }[];
  checks: string[];
};
export type Pack = { title: string; scope: string; generatedAt: string; generatedBy: string | null; items: PackCompetency[] };

export const PACK_NOTICE = "Paper is for reading and notes. A decision counts only when it is recorded in Competen, in Clinical review, against the version shown here. If the content has changed since this pack was made, its fingerprint will not match and it needs a fresh review.";
const PREFIX: Record<string, string> = { clinical_skills: "S", knowledge: "K", knowledge_application: "A" };

/** Pure: criteria grouped by component, in registry order, numbered S1, K1, A1... Unclassified last. */
export function groupCriteria(criteria: { component: string | null; text: string; sourceRef: string | null }[], components: Record<string, string>): PackCompetency["groups"] {
  const order = [...Object.keys(components), ...new Set(criteria.map(c => c.component ?? "").filter(c => c && !(c in components))), ""];
  return order.map(code => {
    const items = criteria.filter(c => (c.component ?? "") === code);
    return { label: code ? components[code] ?? code : "Not classified", criteria: items.map((c, i) => ({ n: `${PREFIX[code] ?? "C"}${i + 1}`, text: c.text, sourceRef: c.sourceRef })) };
  }).filter(g => g.criteria.length);
}

const shortHash = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : "not recorded");
async function componentLabels(admin: any): Promise<Record<string, string>> {
  const { data } = await admin.from("competency_assessment_component").select("code, label").order("sort_order");
  return Object.fromEntries(((data ?? []) as any[]).map(c => [c.code, c.label]));
}
async function contentOf(admin: any, ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const { data } = await admin.from("framework_competencies").select("id, code, description, learning_outcomes").in("id", ids);
  return new Map<string, any>(((data ?? []) as any[]).map(c => [c.id, c]));
}

/** The reviewer's pack: exactly their current queue (current versions only, in their scope, independent). */
export async function loadReviewerPack(admin: any, reviewer: { id: string; name: string | null }): Promise<Pack | null> {
  const q = await reviewQueue(admin, reviewer.id);
  if (!q) return null;
  const items = q.items.filter(i => i.kind === "competency");
  const [components, content] = await Promise.all([componentLabels(admin), contentOf(admin, items.map(i => i.competencyId))]);
  const hashes = await contentHashes(admin, items.map(i => i.competencyId));
  return {
    title: "Clinical review pack", scope: `Waiting for ${reviewer.name ?? "you"} · ${items.length} competenc${items.length === 1 ? "y" : "ies"}`,
    generatedAt: new Date().toISOString(), generatedBy: reviewer.name,
    items: items.map(i => {
      const criteria = i.criteria ?? [], c = content.get(i.competencyId);
      return {
        competencyId: i.competencyId, code: c?.code ?? null, name: i.title, domain: i.domain, framework: i.home, versionId: i.versionId,
        fingerprint: hashes?.get(i.competencyId) ?? null, state: CLINICAL_STATE_LABEL.in_review, approvals: i.approvals, required: i.required,
        description: c?.description ?? i.snapshot.description, outcomes: Array.isArray(c?.learning_outcomes) ? c.learning_outcomes : i.snapshot.outcomes,
        groups: groupCriteria(criteria, components), checks: checksFor(criteria, components),
      };
    }),
  };
}

/** A framework's pack for its authors: every competency at its current content, with its clinical review state. */
export async function loadFrameworkPack(admin: any, frameworkId: string, by: string | null): Promise<Pack | null> {
  const { data: f, error } = await admin.from("frameworks")
    .select("id, name, code, hospital_id, framework_domains(id, name, sort_order, framework_competencies(id, code, name, description, learning_outcomes, sort_order))").eq("id", frameworkId).maybeSingle();
  if (error || !f || f.hospital_id !== null) return null;
  const doms = [...(f.framework_domains ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
  const comps = doms.flatMap((d: any) => [...(d.framework_competencies ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((c: any) => ({ ...c, domain: d.name })));
  const ids = comps.map((c: any) => c.id);
  const [components, reviews, hashes, skills] = await Promise.all([
    componentLabels(admin), loadClinicalReviews(admin, ids), contentHashes(admin, ids),
    ids.length ? admin.from("competency_skills").select("competency_id, name, sort_order, component_code, source_ref").in("competency_id", ids).order("sort_order").limit(20000) : Promise.resolve({ data: [] }),
  ]);
  if (reviews === null || hashes === null || skills.error) return null;
  return {
    title: "Clinical review pack", scope: `${f.name}${f.code ? ` (${f.code})` : ""} · ${comps.length} competencies`, generatedAt: new Date().toISOString(), generatedBy: by,
    items: comps.map((c: any) => {
      const criteria = ((skills.data ?? []) as any[]).filter(k => k.competency_id === c.id).map(k => ({ component: k.component_code ?? null, text: k.name, sourceRef: k.source_ref ?? null }));
      const r = reviews.get(c.id);
      return {
        competencyId: c.id, code: c.code ?? null, name: c.name, domain: c.domain, framework: f.name,
        versionId: r?.state === "in_review" || r?.state === "approved" || r?.state === "changes_requested" ? r.versionId : null, fingerprint: hashes.get(c.id) ?? null,
        state: r ? CLINICAL_STATE_LABEL[r.state] : "Clinical state not readable", approvals: r?.approvals ?? 0, required: r?.required ?? 1,
        description: c.description ?? null, outcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes : [],
        groups: groupCriteria(criteria, components), checks: checksFor(criteria, components),
      };
    }),
  };
}

/** Pure: the version line every competency carries, so a paper note maps to exactly one version. */
export const versionLine = (c: PackCompetency) =>
  `Version ${c.versionId ? c.versionId.slice(0, 8) : "not yet put forward"} · fingerprint ${shortHash(c.fingerprint)} · ${c.state} · ${c.approvals} of ${c.required} approval${c.required === 1 ? "" : "s"}`;

/** The editable Word copy. */
export async function renderPackDocx(pack: Pack): Promise<Buffer> {
  const font = "Arial";
  const run = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) => new TextRun({ text, font, size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color ?? "1F2937" });
  const p = (text: string, o: Parameters<typeof run>[1] & { after?: number; before?: number } = {}) => new Paragraph({ children: [run(text, o)], spacing: { after: o.after ?? 60, before: o.before ?? 0 } });
  const cell = (lines: string[], w: number, span = 1) => new TableCell({ width: { size: w, type: WidthType.PERCENTAGE }, columnSpan: span, children: lines.map(line => p(line, { after: 120 })) });
  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [run(pack.title, { bold: true, size: 36, color: "0F5E5A" })], spacing: { after: 80 } }),
    p(pack.scope, { color: "4B5563" }),
    p(`Prepared ${new Date(pack.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" })}${pack.generatedBy ? ` for ${pack.generatedBy}` : ""}.`, { color: "4B5563" }),
    p(PACK_NOTICE, { italics: true, color: "92400E", after: 200 }),
  ];
  for (const c of pack.items) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: body.length > 4, spacing: { before: 200, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "0F766E", space: 2 } },
      children: [run(`${c.code ? `${c.code}  ` : ""}${c.name}`, { bold: true, size: 28, color: "0F5E5A" })] }));
    body.push(p(`${c.domain} · ${c.framework}`, { color: "4B5563" }));
    body.push(p(versionLine(c), { size: 18, color: "4B5563", after: 120 }));
    if (c.description) body.push(p(c.description, { after: 100 }));
    if (c.outcomes.length) { body.push(p("Learning outcomes", { bold: true, before: 60 })); for (const o of c.outcomes) body.push(new Paragraph({ bullet: { level: 0 }, children: [run(o)] })); }
    for (const g of c.groups) {
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 40 }, children: [run(`${g.label} (${g.criteria.length})`, { bold: true, size: 22 })] }));
      for (const k of g.criteria) body.push(new Paragraph({ spacing: { after: 40 }, children: [run(`${k.n}  `, { bold: true, color: "0F766E" }), run(k.text)] }));
    }
    if (c.checks.length) { body.push(p("Worth checking", { bold: true, before: 120, color: "92400E" })); for (const x of c.checks) body.push(new Paragraph({ bullet: { level: 0 }, children: [run(x, { color: "92400E" })] })); }
    body.push(p("Reviewer notes and recommendation (record the decision in Competen)", { bold: true, before: 160 }));
    body.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell(["☐ Recommend approval"], 50), cell(["☐ Changes needed"], 50)] }),
      new TableRow({ children: [cell(["Comments:", "", "", ""], 100, 2)], cantSplit: true }),
      new TableRow({ children: [cell(["Reviewer:"], 50), cell(["Date:"], 50)] }),
    ] }));
  }
  const doc = new Document({
    creator: "Competen", title: pack.title, description: pack.scope,
    sections: [{ properties: {}, children: body,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("Competen clinical review pack · page ", { size: 16, color: "6B7280" }), new TextRun({ children: [PageNumber.CURRENT], font, size: 16, color: "6B7280" })] })] }) } }],
  });
  return Packer.toBuffer(doc);
}
