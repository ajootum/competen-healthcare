/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { reviewQueue } from "./clinical-review-hq";
import { CLINICAL_STATE_LABEL, loadClinicalReviews } from "./clinical-review";
import { contentHashes } from "./review-batch";
import { checksFor } from "./criteria-checks";
import { applyLayout, asLayout, byRowOrder, groupByArea, sectionOrder, type LayoutTree } from "./layout-order";
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
  /** FRAMEWORK-DESIGN-STUDIO-02 (760), a framework pack only: the Area of the competency's domain (null: none). */
  area?: string | null;
  versionId: string | null; fingerprint: string | null; state: string; approvals: number; required: number;
  description: string | null; outcomes: string[];
  groups: { label: string; criteria: PackCriterion[] }[];
  checks: string[];
};
export type Pack = { title: string; scope: string; generatedAt: string; generatedBy: string | null; items: PackCompetency[];
  /** FRAMEWORK-DESIGN-STUDIO-01 (750), a framework pack only: which order is shown ("draft" = the pending layout draft,
   *  not yet published), whether a layout draft is pending, and when it was saved. Absent before 750. */
  layout?: { shown: "published" | "draft"; pending: boolean; savedAt: string | null } };

export const PACK_NOTICE = "Paper is for reading and notes. A decision counts only when it is recorded in Competen, in Clinical review, against the version shown here. If the content has changed since this pack was made, its fingerprint will not match and it needs a fresh review.";
const PREFIX: Record<string, string> = { clinical_skills: "S", knowledge: "K", knowledge_application: "A" };

/** Pure: criteria grouped by component, in the section order (the framework's, else the registry's), numbered S1, K1, A1... Unclassified last. */
export function groupCriteria(criteria: { component: string | null; text: string; sourceRef: string | null }[], components: Record<string, string>, sections?: readonly string[] | null): PackCompetency["groups"] {
  const known = sections?.length ? [...new Set([...sections.filter(c => c in components), ...Object.keys(components)])] : Object.keys(components);
  const order = [...known, ...new Set(criteria.map(c => c.component ?? "").filter(c => c && !(c in components))), ""];
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

/**
 * A framework's pack for its authors: every competency at its current content, with its clinical review state.
 * FRAMEWORK-DESIGN-STUDIO-01: opts.layout "draft" previews the pending layout draft's order (750). Without one, or
 * before 750, the live (published) order is shown, and pack.layout says which.
 */
export async function loadFrameworkPack(admin: any, frameworkId: string, by: string | null, opts: { layout?: "draft" | "published" } = {}): Promise<Pack | null> {
  const { data: f, error } = await admin.from("frameworks")
    .select("id, name, code, hospital_id, framework_domains(id, name, sort_order, framework_competencies(id, code, name, description, learning_outcomes, sort_order))").eq("id", frameworkId).maybeSingle();
  if (error || !f || f.hospital_id !== null) return null;
  // 750: absent columns read as "no layout", never as a failure of the pack.
  const lay = await admin.from("frameworks").select("layout_draft, layout_draft_at, component_order").eq("id", frameworkId).maybeSingle();
  const layRow = lay?.error ? null : lay?.data ?? null;
  const draft = asLayout(layRow?.layout_draft), useDraft = opts.layout === "draft" && !!draft;
  // 760: Areas group the pack. Absent table or column = no Areas, the pack exactly as before.
  const [ar, da] = await Promise.all([
    admin.from("framework_areas").select("id, name, sort_order").eq("framework_id", frameworkId),
    admin.from("framework_domains").select("id, area_id").eq("framework_id", frameworkId),
  ]);
  const areasOk = !ar?.error && !da?.error;
  const areaOf = new Map<string, string | null>(areasOk ? ((da.data ?? []) as any[]).map(x => [x.id, x.area_id ?? null]) : []);
  const allComps = (f.framework_domains ?? []).flatMap((d: any) => d.framework_competencies ?? []);
  const ids: string[] = allComps.map((c: any) => c.id);
  const [components, reviews, hashes, skills] = await Promise.all([
    componentLabels(admin), loadClinicalReviews(admin, ids), contentHashes(admin, ids),
    ids.length ? admin.from("competency_skills").select("id, competency_id, name, sort_order, component_code, source_ref").in("competency_id", ids).order("sort_order").limit(20000) : Promise.resolve({ data: [] }),
  ]);
  if (reviews === null || hashes === null || skills.error) return null;
  // One order for everything shown: the live order with its stable tie-break, or the pending layout over it.
  const rowsOf = (cid: string) => ((skills.data ?? []) as any[]).filter(k => k.competency_id === cid).sort(byRowOrder);
  const tree: LayoutTree = {
    componentOrder: Array.isArray(layRow?.component_order) ? layRow.component_order : null, registry: Object.keys(components),
    ...(areasOk ? { areas: ((ar.data ?? []) as any[]).map(a => ({ id: a.id, name: a.name ?? "", sortOrder: a.sort_order ?? null })) } : {}),
    domains: (f.framework_domains ?? []).map((d: any) => ({ id: d.id, name: d.name ?? "", sortOrder: d.sort_order ?? null, ...(areasOk ? { areaId: areaOf.get(d.id) ?? null } : {}),
      competencies: (d.framework_competencies ?? []).map((c: any) => ({ id: c.id, name: c.name ?? "", sortOrder: c.sort_order ?? null,
        criteria: rowsOf(c.id).map(k => ({ id: String(k.id ?? ""), name: k.name ?? "", sortOrder: k.sort_order ?? null, component: k.component_code ?? null })) })) })),
  };
  const shown = applyLayout(tree, useDraft ? draft : null);
  const sections = sectionOrder(tree, useDraft ? draft : null);
  const compRow = new Map<string, any>(allComps.map((c: any) => [c.id, c]));
  // Area by Area (in Area order, then the domains with none), each domain in its order. No Areas: the domain order.
  const comps = groupByArea(shown).flatMap(g => g.domains.flatMap(d => d.competencies.map(c => ({ ...compRow.get(c.id), domain: d.name, area: g.area?.name ?? null, order: c.criteria.map(k => k.id) }))));
  return {
    ...(layRow ? { layout: { shown: useDraft ? ("draft" as const) : ("published" as const), pending: !!draft, savedAt: draft ? layRow.layout_draft_at ?? null : null } } : {}),
    title: "Clinical review pack", scope: `${f.name}${f.code ? ` (${f.code})` : ""} · ${comps.length} competencies`, generatedAt: new Date().toISOString(), generatedBy: by,
    items: comps.map((c: any) => {
      const byId = new Map(rowsOf(c.id).map(k => [String(k.id ?? ""), k]));
      const criteria = (c.order as string[]).map(id => byId.get(id)).filter(Boolean).map((k: any) => ({ component: k.component_code ?? null, text: k.name, sourceRef: k.source_ref ?? null }));
      const r = reviews.get(c.id);
      return {
        competencyId: c.id, code: c.code ?? null, name: c.name, domain: c.domain, framework: f.name, ...(areasOk ? { area: c.area } : {}),
        versionId: r?.state === "in_review" || r?.state === "approved" || r?.state === "changes_requested" ? r.versionId : null, fingerprint: hashes.get(c.id) ?? null,
        state: r ? CLINICAL_STATE_LABEL[r.state] : "Clinical state not readable", approvals: r?.approvals ?? 0, required: r?.required ?? 1,
        description: c.description ?? null, outcomes: Array.isArray(c.learning_outcomes) ? c.learning_outcomes : [],
        groups: groupCriteria(criteria, components, sections), checks: checksFor(criteria, components),
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
    body.push(p(`${c.area ? `${c.area} · ` : ""}${c.domain} · ${c.framework}`, { color: "4B5563" }));
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
