import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { candidacyStatus, offerPrivateCase, withdrawCaseCandidate } from "@/lib/cases/candidates";
import type { Blueprint } from "@/lib/cases/blueprint";
import { getPassage, getPrivateCase, listQuestions } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { OFFERING_OFF } from "@/lib/cases/offering-switch";
import { caseSourceKey, privateCaseSnapshot, s4CaseBlueprint, verbatimCheck } from "@/lib/individual/scholar/clinical";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// /api/individual/scholar/clinical/cases/[id]/offer -- COMPETEN-SCHOLAR-CLINICAL-REASONING-01 CI1, the Scholar side.
//
// POST { kind?: "case" | "s4" } offers ONE of the student's own cases for the shared library: an explicit, per-case
// action (C-c), only with their candidacy permission granted, behind the case_library flag (candidates.ts). Scholar
// builds the snapshot (C-a): the blueprint with the student's source references removed (B8), the attestation they
// gave, and the verbatim check against their own sections (C-b). The identifier screen and the eligibility decision
// are Holdings' (candidates.ts). No AI, no charge, and the educators never see who offered it.
// DELETE withdraws it again -- never gated: a privacy right does not wait for a launch.

async function snapshotOf(ctx: { admin: unknown; userId: string }, kind: "case" | "s4", id: string): Promise<{ blueprint: Blueprint; sources: string[] } | null> {
  if (kind === "case") {
    const c = await getPrivateCase(ctx.admin, ctx.userId, id);
    if (!c) return null;
    const passages = await Promise.all(c.chunkIds.map(cid => getPassage(ctx.admin, ctx.userId, cid)));
    return { blueprint: c.blueprint as Blueprint, sources: passages.filter(Boolean).map(p => p!.content) };
  }
  const qs = await listQuestions(ctx.admin, ctx.userId, { kind: "case" });
  const steps = qs.ok ? qs.data.filter(q => q.caseId === id).sort((a, b) => (a.caseStep ?? 0) - (b.caseStep ?? 0)) : [];
  const b = s4CaseBlueprint(steps.map(s => ({ stem: s.stem, options: s.options, correctIndex: s.correctIndex, rationale: s.rationale, caseTitle: s.caseTitle })));
  if (!b) return null;
  const passages = await Promise.all([...new Set(steps.map(s => s.chunkId))].map(cid => getPassage(ctx.admin, ctx.userId, cid)));
  return { blueprint: b, sources: passages.filter(Boolean).map(p => p!.content) };
}

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = (await ctx2.params).id;
  // The offer side has its own switch (scholar_case_contribution). Withdrawing below is never gated.
  if ((await loadIndividualPolicy(ctx.admin)).scholarCaseContribution === "off") return NextResponse.json({ error: OFFERING_OFF }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "s4" ? "s4" : "case";
  const status = await candidacyStatus(ctx.admin, ctx.userId);
  if (!status) return NextResponse.json({ error: "Your permission could not be read just now, so nothing was offered." }, { status: 503 });
  if (!status.granted || !status.attestation || !status.attestationVersion) return NextResponse.json({ error: "Allow your cases to be considered for the shared library first." }, { status: 403 });
  const snap = await snapshotOf(ctx, kind, id);
  if (!snap) return NextResponse.json({ error: "That case could not be found." }, { status: 404 });
  const snapshot = privateCaseSnapshot(snap.blueprint, status.attestation, status.attestationVersion);
  const r = await offerPrivateCase(ctx.admin, { userId: ctx.userId, sourceKey: caseSourceKey(kind, id), snapshot, verbatim: verbatimCheck(snapshot, snap.sources) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await audit(ctx, "individual_scholar_case_offered", "case_candidate", r.candidateId, { kind, status: r.status, reasons: r.reasons, duplicate: r.duplicate });
  return NextResponse.json(r);
}

export async function DELETE(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const id = (await ctx2.params).id;
  const kind = new URL(req.url).searchParams.get("kind") === "s4" ? "s4" : "case";
  const r = await withdrawCaseCandidate(ctx.admin, { userId: ctx.userId, sourceKey: caseSourceKey(kind, id), reason: "student" });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  await audit(ctx, "individual_scholar_case_withdrawn", "case_candidate", null, { kind, withdrawn: r.withdrawn });
  return NextResponse.json(r);
}
