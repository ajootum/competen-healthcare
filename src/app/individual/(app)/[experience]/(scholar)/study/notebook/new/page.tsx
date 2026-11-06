import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel } from "../../../../../../_components/chrome";
import { notebookOffered, notebookSchema } from "@/lib/individual/scholar/personal-notebook-store";
import { BlankPage } from "../../_components/note-editor";
import { noteLinkOptions } from "@/lib/individual/scholar/personal-notebook-options";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// COMPETEN-NOTEBOOK-001 P1: the blank page. The cursor is in the field when it opens, and nothing but words is needed. No AI.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "New note" });
}

export default async function NewNotePage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const policy = await loadIndividualPolicy(ctx.admin);
  const header = <PageHeader accent={SCHOLAR.accent} eyebrow="Private to you" title="New note" />;
  if (!notebookOffered(policy, await notebookSchema(ctx.admin))) return <>{header}<StatePanel title="My Notebook is not available here yet"><p>Your notes and highlights are still in your learning library.</p></StatePanel></>;
  const raw = (await searchParams).draft;
  const draftKey = typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
  return <>{header}<BlankPage userId={ctx.userId} options={await noteLinkOptions(ctx.admin, ctx.userId)} draftKey={draftKey} /></>;
}
