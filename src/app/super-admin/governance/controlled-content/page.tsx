import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { listGovernedVersions, listLibrary, nameMap } from "@/lib/assessment/studio/read";
import { loadGovernanceIndex } from "@/lib/competency/governance-workspace";
import { loadPublicationView } from "@/lib/competency/framework-publication";
import { loadFrameworkAuthors } from "@/lib/competency/governance-history";
import { SCOPE, frameworkStatus, nextActionFramework, studioRows, type ControlledRow } from "../unified";
import ControlledContentView, { type Section } from "./ControlledContentView";

// UNIFIED-GOVERNANCE-V1 section 5 -- Controlled Content. One index of everything that is governed: one row per item, one
// status, one obvious next action, one link. Each section appears only for a person who may see it; a section they may not
// see is absent and says nothing. Reads only through the existing readers. Nothing is decided here.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Controlled content" };

const STUDIO_VIEW = "hq.assessment.studio.view";
const FRAMEWORK_CAPS = ["hq.quality.competency.author", "hq.quality.competency.publish", "hq.quality.clinical.approve"];

export default async function ControlledContentPage() {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.platform.home.view"));
  const has = (c: string) => ctx.capabilities.includes(c);
  const sections: Section[] = [];

  if (ctx.isOwner || has(STUDIO_VIEW)) {
    try {
      const [versions, library] = await Promise.all([listGovernedVersions(ctx.admin), listLibrary(ctx.admin)]);
      const names = await nameMap(ctx.admin, versions.flatMap((v) => v.authoredBy));
      const rows = studioRows(versions, library.map((l) => ({ id: l.id, code: l.code, name: l.name, versions: l.versions })), names);
      sections.push({ id: "studio", title: "Checklists and Studio definitions", rows, error: null });
    } catch {
      sections.push({ id: "studio", title: "Checklists and Studio definitions", rows: [], error: "The checklist definitions could not be read just now. Nothing is shown rather than a partial list." });
    }
  }

  if (ctx.isOwner || FRAMEWORK_CAPS.some(has)) {
    const me = { canAuthor: has(FRAMEWORK_CAPS[0]), canPublish: has(FRAMEWORK_CAPS[1]), canReview: has(FRAMEWORK_CAPS[2]) };
    let rows: ControlledRow[] | null = null;
    try {
      const index = await loadGovernanceIndex(ctx.admin, ctx.userId, me);
      const base = index
        ? index.map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.pubStatus, version: r.version, pending: r.pending !== null }))
        : ((await loadPublicationView(ctx.admin))?.rows ?? null)?.map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.status, version: r.version, pending: r.pending !== null })) ?? null;
      if (base) {
        const authors = (await loadFrameworkAuthors(ctx.admin, base.map((b) => b.id))) ?? {};
        rows = base.map((b) => ({
          key: `framework:${b.id}`, section: "framework", title: b.name, code: b.code ?? "", type: "Competency framework", scope: SCOPE, version: b.version,
          status: frameworkStatus(b.status), authors: authors[b.id] ?? [], next: nextActionFramework(b.status, b.pending), href: `/super-admin/competencies/governance/${b.id}`,
        }));
      }
    } catch { rows = null; }
    sections.push({
      id: "framework", title: "Competency frameworks", rows: rows ?? [],
      error: rows === null ? "The competency frameworks could not be read just now. Nothing is shown rather than a partial list." : null,
    });
  }

  return <ControlledContentView sections={sections} />;
}
