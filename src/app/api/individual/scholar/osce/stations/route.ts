// Allow up to 60s: a station may be written by AI from the learner's notes.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { getMaterial, getPassage, insertOsceStation, isUuid, learnerProgramme, listChunks } from "@/lib/individual/scholar/store";
import { servableOsceStation } from "@/lib/individual/scholar/library-questions";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, refusalWords, scholarAiRunner, scholarRisk } from "@/lib/individual/scholar/http";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { passageCitation, runOsceStation, type Passage } from "@/lib/individual/scholar/generation";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { CONTENT_STATUS_LABEL } from "@/lib/individual/scholar/config";
import { recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { osceGate } from "@/lib/individual/scholar/osce-service";
import {
  EMPTY_DEFINITION, OSCE_RECOVERY_NOTE, OSCE_WITHHELD, normaliseSections, osceRecoveryRequest, osceTemplate, stationFromCompetency, stationFromLibrary, stationFromTemplate,
  type OsceStationDraft,
} from "@/lib/individual/scholar/osce";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/osce/stations -- SCHOLAR-PRACTICE-EXAMS-01 (720). A simulated OSCE practice station, from:
//   { source: "template", templateKey }        a Competen practice template (data, not clinically reviewed). No AI.
//   { source: "competency", competencyId }     the learning outcomes of a competency the learner's catalogue offers. No AI.
//   { source: "ai", materialId, chunkId? }     written by AI (activity `questions`) from ONE of the learner's own materials,
//                                              each checklist item quoted from its passage and grounding-checked, or withheld.
//                                              Withheld or too thin: the reply offers evidence recovery (SCHOLAR-OSCE-01 s4).
//   { source: "library", versionId }            a copy of a PUBLISHED, clinically approved Competen station (CKRI osce_station,
//                                              721), exactly as published. Anything else is refused (and the 721 trigger
//                                              refuses it again). No AI.
// Optional `sections`: the response headings (one per line), screened for identifiers. Formative practice only: never an
// observed assessment, never verified competence. Gated by policy (scholar_osce) and by 720 being installed.

const MAX_PASSAGES = 4;
const MAX_PASSAGE_CHARS = 9000;
const MIN_PASSAGE_CHARS = 400;

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await osceGate(ctx.admin, ctx.userId);
  if (policy instanceof NextResponse) return policy;
  const body = await req.json().catch(() => ({}));
  const sections = normaliseSections(body?.sections);
  if (findPatientIdentifiers(sections.join("\n")).length)
    return NextResponse.json({ error: "A heading looks like it identifies a patient. Remove it and try again." }, { status: 422 });

  let draft: OsceStationDraft;
  if (body?.source === "library") {
    const lib = await servableOsceStation(ctx.admin, typeof body?.versionId === "string" ? body.versionId : "");
    if (!lib) return NextResponse.json({ error: "That station is not offered by the Competen station library. Only published, clinically approved stations are." }, { status: 404 });
    draft = stationFromLibrary(lib);
  } else if (body?.source === "template") {
    const t = osceTemplate(body?.templateKey);
    if (!t) return NextResponse.json({ error: "Choose one of the practice templates." }, { status: 400 });
    draft = stationFromTemplate(t, sections);
  } else if (body?.source === "competency") {
    if (!isUuid(body?.competencyId)) return NextResponse.json({ error: "Choose a competency." }, { status: 400 });
    const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
    if (learner.competencies === null) return NextResponse.json({ error: "Your competency catalogue could not be read just now." }, { status: 503 });
    const c = learner.competencies.find(x => x.id === body.competencyId);
    if (!c) return NextResponse.json({ error: "That competency is not in your catalogue." }, { status: 404 });
    // The competency's content status as recorded, never assumed approved because it exists (SCHOLAR-OSCE-01 s5).
    const built = stationFromCompetency({
      id: c.id, code: c.code, title: c.title, outcomes: c.outcomes, contentStatusLabel: CONTENT_STATUS_LABEL[c.contentStatus] ?? CONTENT_STATUS_LABEL.unreviewed,
      profession: c.profession ?? learner.programme?.profession ?? null, domain: c.domain ?? null,
      programme: learner.programme ? { code: learner.programme.code, label: learner.programme.label } : null,
    },
      policy.durationMinutes, sections);
    if (!built.ok) return NextResponse.json({ error: built.reason }, { status: 422 });
    draft = built.draft;
  } else if (body?.source === "ai") {
    return fromNotes(ctx, req, body, sections, policy);
  } else return NextResponse.json({ error: "Choose where the station comes from." }, { status: 400 });

  const saved = await insertOsceStation(ctx.admin, ctx.userId, draft);
  if (!saved.ok) return NextResponse.json({ error: "The station could not be saved just now." }, { status: 500 });
  return NextResponse.json({ id: saved.id, existing: saved.existing });
}

async function fromNotes(ctx: Parameters<typeof aiPreflight>[0], req: Request, body: any, sections: string[], policy: { durationMinutes: number; checklistMin: number; checklistMax: number }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!isUuid(body?.materialId)) return NextResponse.json({ error: "Choose one of your materials." }, { status: 400 });
  const material = await getMaterial(ctx.admin, ctx.userId, body.materialId);
  if (!material.ok) return NextResponse.json({ error: "Your materials could not be read just now." }, { status: 503 });
  if (!material.data) return NextResponse.json({ error: "That material could not be found." }, { status: 404 });
  const chunks = await listChunks(ctx.admin, ctx.userId, material.data.id);
  if (!chunks.ok) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  // The sections: from the one chosen (and those after it), or from the start of the material.
  let from = 0;
  if (body?.chunkId !== undefined && body?.chunkId !== null && body?.chunkId !== "") {
    from = isUuid(body.chunkId) ? chunks.data.findIndex(c => c.id === body.chunkId) : -1;
    if (from < 0) return NextResponse.json({ error: "That section is not in this material." }, { status: 404 });
  }
  const picked: string[] = [];
  let chars = 0;
  for (const c of chunks.data.slice(from)) {
    if (picked.length >= MAX_PASSAGES || chars + c.content.length > MAX_PASSAGE_CHARS) break;
    picked.push(c.id); chars += c.content.length;
  }
  if (!picked.length && chunks.data[from]) picked.push(chunks.data[from].id);
  const passages = (await Promise.all(picked.map(id => getPassage(ctx.admin, ctx.userId, id)))).filter((p): p is Passage => !!p);
  if (!passages.length) return NextResponse.json({ error: "Your notes could not be read just now." }, { status: 503 });
  const recover = (reason: string) => osceRecoveryRequest({ materialId: material.data!.id, title: material.data!.title, chunkId: passages[0]?.chunkId ?? null }, reason);
  if (passages.reduce((n, p) => n + p.content.length, 0) < MIN_PASSAGE_CHARS)
    return NextResponse.json({ error: "There is not enough in these notes for a practice station. Choose a longer section, or use the practice template.", recovery: recover("thin_notes"), recoveryNote: OSCE_RECOVERY_NOTE }, { status: 422 });
  if (findPatientIdentifiers(passages.map(p => p.content).join("\n")).length)
    return NextResponse.json({ error: "These notes look as if they identify a patient, so they are not sent to AI. Remove the details and upload them again." }, { status: 422 });

  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  if (!standing.available) return NextResponse.json({ error: `${standing.message ?? "New AI help is not available right now."} The practice template and competency stations need no AI.`, continuity: true }, { status: 409 });
  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  const ai = scholarAiRunner(ctx, req, "questions", await scholarRisk(ctx.admin, ctx.userId, { text: null, passages }));
  const r = await runOsceStation(ctx.userId, { passages, min: policy.checklistMin, max: policy.checklistMax }, ai.run);
  const refusal = ai.refusal();
  if (refusal) return NextResponse.json({ error: `${refusalWords(refusal).message} The practice template and competency stations need no AI.`, continuity: true }, { status: 409 });
  await recordScholarOutcome(ctx.admin, ai, {
    operation: "individual_scholar_osce_station", outputKind: "other", promptVersion: r.ok ? r.promptVersion : null,
    ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`] }
      : r.check.ok ? { outcome: "accepted" as const, accepted: 1, reasons: [...new Set(r.check.dropped)] }
        : { outcome: "rejected" as const, rejected: 1, reasons: [r.check.reason, ...new Set(r.check.dropped)] }),
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_osce_station", null, {
    material_id: material.data.id, chunk_ids: passages.map(p => p.chunkId), action_id: ai.actionId,
    outcome: !r.ok ? `error:${r.error}` : r.check.ok ? "stored" : `withheld:${r.check.reason}`, dropped: r.ok ? r.check.dropped.slice(0, 14) : [],
    model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
  });
  if (!r.ok) return NextResponse.json({ error: "A station could not be written just now. Try again shortly, or use the practice template." }, { status: 502 });
  const check = r.check;
  if (!check.ok) return NextResponse.json({ error: OSCE_WITHHELD[check.reason], withheld: { reason: check.reason }, ...(check.reason === "identifier" ? {} : { recovery: recover(check.reason), recoveryNote: OSCE_RECOVERY_NOTE }) }, { status: 422 });
  const programme = await learnerProgramme(ctx.admin, ctx.userId);
  const prog = programme.ok ? programme.data : null;
  const saved = await insertOsceStation(ctx.admin, ctx.userId, {
    title: check.title, scenario: check.scenario, candidateInstructions: check.candidateInstructions, durationMinutes: policy.durationMinutes,
    sections, checklist: check.items, source: "ai", templateKey: null, contentStatus: "AI-generated from your notes, not clinically reviewed",
    competencyId: null, materialId: material.data.id, chunkId: passages[0].chunkId, model: r.model, promptVersion: r.promptVersion,
    ...EMPTY_DEFINITION, profession: prog?.profession ?? null, programmeCode: prog?.code ?? null, programmeLabel: prog?.label ?? null,
    topic: material.data.title.replace(/\s+/g, " ").trim().slice(0, 160) || null,
    // Where it came from, kept on the station: the material and every passage the checklist was checked against.
    references: passages.map(p => ({ kind: "notes" as const, materialId: material.data!.id, chunkId: p.chunkId, citation: passageCitation(p).slice(0, 200) })),
    libraryResourceId: null, libraryVersionId: null,
  });
  if (!saved.ok) return NextResponse.json({ error: "The station could not be saved just now." }, { status: 500 });
  return NextResponse.json({ id: saved.id, existing: false, dropped: check.dropped.length });
}
