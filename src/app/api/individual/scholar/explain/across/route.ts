// Allow up to 60s for AI generation -- the same ceiling the personal AI uses.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { recordScholarOutcome } from "@/lib/individual/scholar/outcome";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { competencyChunks, isUuid, librarySchema, savedLearningRows, searchCandidates, toPassages } from "@/lib/individual/scholar/store";
import { AI_ERROR, SCHOLAR_AI_AUDIT_ACTION, aiPreflight, audit, meteredRefusal, scholarAiRunner, scholarRisk, scholarRiskGate, withinRequestRisk } from "@/lib/individual/scholar/http";
import { rankChunks, spreadAcrossMaterials, toTsQuery } from "@/lib/individual/scholar/retrieval";
import { ASK_LIBRARY_LABEL, ASK_RESEARCH_LABEL, EXPLAIN_REFUSAL, RESEARCH_WITHHELD, askPartWithheld, isExplainMode, passageCitation, passageTag, runAskAcross, savedLearningPassage, type ExplainMode, type Passage } from "@/lib/individual/scholar/generation";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { AI_LABEL, QUESTION_MAX, RETRIEVAL_LIMIT } from "@/lib/individual/scholar/config";
import { ASK_SOURCE_LABEL, internalSearched, offeredAskSources, parseAskSources, researchSearched, type AskSource, type Searched } from "@/lib/individual/scholar/ask-sources";
import { externalReferences, learnResearch, researchEvidence, scholarResearchOperational, type LearnResearch } from "@/lib/individual/scholar/learn-research";
import { keyTermsOf, liveSources } from "@/lib/individual/scholar/evidence-recovery";
import { qualityOf } from "@/lib/individual/scholar/source-quality";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/explain/across -- SCHOLAR-ASK-SOURCES-01, owner GO 5 Nov 2026.
//
// Ask across your library when the learner chose more than their materials for this one question. Materials alone stays on
// the existing explain route. Nothing new retrieves here: the materials search and passage rules are that route's, saved
// learning is the Personal Learning Library's own search (820), Competen Library is the evidence-recovery tier's approved
// content, and research is the Research & Evidence Engine through learnResearch, with its gates and per-learner limits.
//
// Learner material and external evidence stay apart in the prompt, the checks and the reply: [S n] for what is the learner's,
// [C n] for Competen Library, [E n] for research, each its own part with its own check. A part that fails its check is
// withheld alone. A source found but not read is listed as found, never as evidence. Not stored (owner ruling D10), and the
// audit row records ids, counts and codes, never the question text.

const MAX_SELECTED = 10;
const SEARCH_FAILED = "Your chosen sources could not be searched just now. Try again shortly.";
const NOTHING = "None of the sources you chose had an answer to this. Try other sources or different words.";

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const [body, policy] = await Promise.all([req.json().catch(() => ({})), loadIndividualPolicy(ctx.admin)]);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  const mode: Exclude<ExplainMode, "tutor"> | null = body?.mode === undefined || body?.mode === null ? "explain" : isExplainMode(body.mode) && body.mode !== "tutor" ? body.mode as Exclude<ExplainMode, "tutor"> : null;
  if (!mode) return NextResponse.json({ error: "Unknown way of explaining." }, { status: 400 });
  // What the student typed goes to the model and, as keywords, perhaps to a research source: screened first, as everywhere.
  if (findPatientIdentifiers(question).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });

  // Only what is operational now. A source that cannot run is reported as not searched, never quietly dropped.
  const requested = parseAskSources(body?.sources);
  if (!requested.length) return NextResponse.json({ error: "Choose at least one place to look." }, { status: 400 });
  const researchOn = requested.includes("research") ? await scholarResearchOperational(ctx.admin).catch(() => false) : false;
  const offered = offeredAskSources({ savedReady: requested.includes("saved") ? await librarySchema(ctx.admin, ctx.userId) : false, sourceModes: policy.scholarResearch.modes, researchOperational: researchOn });
  const chosen = requested.filter(s => offered.includes(s));
  const has = (s: AskSource) => chosen.includes(s);
  const notRun: Searched[] = requested.filter(s => !chosen.includes(s)).map(source => ({ source, state: "not_run", count: 0, note: "it is not available at the moment" }));

  // ── materials: the explain route's search, its passage rules and its scopes ──
  let materials: Passage[] = [];
  let materialsFailed = false;
  if (has("materials")) {
    const picked = Array.isArray(body?.materialIds) ? [...new Set((body.materialIds as unknown[]).filter(isUuid))].slice(0, MAX_SELECTED) : [];
    if (Array.isArray(body?.materialIds) && !picked.length) return NextResponse.json({ error: "Choose at least one of your materials." }, { status: 400 });
    const tsq = toTsQuery(question);
    if (isUuid(body?.competencyId)) {
      const linked = await competencyChunks(ctx.admin, ctx.userId, body.competencyId);
      if (!linked.ok) materialsFailed = true;
      else if (linked.data.length) {
        const found = tsq ? await searchCandidates(ctx.admin, ctx.userId, tsq, { chunkIds: linked.data.map(c => c.id) }) : null;
        const ranked = found?.ok && found.data.length ? rankChunks(question, found.data, 40) : [];
        materials = await toPassages(ctx.admin, ctx.userId, spreadAcrossMaterials(ranked.length ? ranked : linked.data, RETRIEVAL_LIMIT));
      }
    } else if (tsq) {
      const found = await searchCandidates(ctx.admin, ctx.userId, tsq, picked.length ? { materialIds: picked } : null);
      if (!found.ok) materialsFailed = true;
      else {
        const ranked = rankChunks(question, found.data, 40);
        if (ranked.length) materials = await toPassages(ctx.admin, ctx.userId, spreadAcrossMaterials(ranked, RETRIEVAL_LIMIT));
      }
    }
  }

  // ── saved learning: the Personal Learning Library's own search, the learner's rows only ──
  // Any of the question's key terms, since a learner's full question rarely appears word for word.
  const savedRead = has("saved") ? await savedLearningRows(ctx.admin, ctx.userId, keyTermsOf(question).slice(0, 8).join(" or ") || question, 3) : null;
  const saved = savedRead?.ok ? savedRead.data.map(savedLearningPassage).filter(p => p.content.trim().length > 0) : [];
  const savedFailed = !!savedRead && !savedRead.ok;

  // ── Competen Library: approved content only, the evidence-recovery tier's source. Nothing leaves Competen ──
  const libraryItems = has("library") ? await liveSources(ctx, policy, "ask-across").library(question, materials).catch(() => null) : [];
  const libraryFailed = libraryItems === null;
  const library = (libraryItems ?? []).filter(l => l.approved && l.text.trim()).slice(0, 5);

  const passages = [...materials, ...saved];
  const originOf = new Map<string, "materials" | "saved">([...materials.map(p => [p.chunkId, "materials"] as const), ...saved.map(p => [p.chunkId, "saved"] as const)]);
  const savedPath = new Map((savedRead?.ok ? savedRead.data : []).map(s => [s.id, s.kind === "artefact" ? `saved?version=${s.id}` : "saved"]));

  const pre = await aiPreflight(ctx);
  if (pre) return pre;

  const risk = await scholarRisk(ctx.admin, ctx.userId, { text: question, passages });
  const ai = scholarAiRunner(ctx, req, mode, risk);

  // ── research: discovery is not generation. The request's risk decides first, so a refused request sends nothing out ──
  let research: LearnResearch | null = null;
  if (has("research")) {
    const gate = await scholarRiskGate(ctx, mode, risk);
    if (gate) return meteredRefusal(gate)!;
    research = await learnResearch(ctx, policy.scholarResearch, { question, topics: [], title: null }, ai.actionId, null, qualityOf(policy.scholarRecovery));
  }
  const evidence = research ? researchEvidence(research) : [];
  const references = research ? externalReferences(research) : [];
  const libraryRefs = library.map((l, i) => ({ tag: `C${i + 1}`, title: l.title, code: l.code, status: l.status, kind: l.kind }));

  const reply = (shownMain: boolean, withheldMain: boolean, libraryShown: boolean, libraryWithheld: boolean, researchShown: boolean, researchWithheld: boolean): Searched[] => [
    ...(has("materials") ? [internalSearched("materials", { failed: materialsFailed, found: materials.length, shown: shownMain && materials.length > 0, withheld: withheldMain })] : []),
    ...(has("saved") ? [internalSearched("saved", { failed: savedFailed, found: saved.length, shown: shownMain && saved.length > 0, withheld: withheldMain })] : []),
    ...(has("library") ? [internalSearched("library", { failed: libraryFailed, found: library.length, shown: libraryShown, withheld: libraryWithheld })] : []),
    ...(research ? [researchSearched({ state: research.state, evidence: evidence.length, items: research.items.length, shown: researchShown, withheld: researchWithheld })] : []),
    ...notRun,
  ];
  const found = references.filter(r => !r.evidence).map(r => ({ title: r.title, journal: r.journal, year: r.year, provider: r.provider, url: r.url }));

  // Nothing to ground an answer on means no AI call, as on the explain route. What research found, unread, is still listed.
  if (!passages.length && !library.length && !evidence.length) {
    if (materialsFailed && chosen.length === 1) return NextResponse.json({ error: SEARCH_FAILED }, { status: 503 });
    await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_explain_across", null, { action_id: ai.actionId, question_chars: question.length, mode, chosen, outcome: "nothing_to_ground", research: research?.state ?? null });
    return NextResponse.json({ notInNotes: true, message: NOTHING, searched: reply(false, false, false, false, false, false), research: found.length ? { label: ASK_RESEARCH_LABEL, text: null, withheld: null, used: [], found } : null });
  }

  const r = await runAskAcross(ctx.userId, { question, mode, passages, library: library.map(l => ({ title: l.title, text: l.text, status: l.status })), research: evidence }, ai.run);
  const refused = meteredRefusal(ai.refusal());
  if (refused) return refused;
  // What the external parts say is classified by the published rules, as Learn's research part is.
  let libraryPart = r.ok ? r.library : null;
  let researchPart = r.ok ? r.research : null;
  const [libraryWithin, researchWithin] = await withinRequestRisk(ctx.admin, mode, risk, [libraryPart?.ok ? libraryPart.text : "", researchPart?.ok ? researchPart.text : ""]);
  if (libraryPart?.ok && !libraryWithin) libraryPart = { ok: false, reason: "risk_raised" };
  if (researchPart?.ok && !researchWithin) researchPart = { ok: false, reason: "risk_raised" };

  const shown = (r.ok && r.check.ok ? 1 : 0) + (libraryPart?.ok ? 1 : 0) + (researchPart?.ok ? 1 : 0);
  const kept = r.ok ? 1 + (library.length ? 1 : 0) + (evidence.length ? 1 : 0) : 0;
  await recordScholarOutcome(ctx.admin, ai, {
    operation: "individual_scholar_explain_across", outputKind: "explanation", promptVersion: r.ok ? r.promptVersion : null, configVersion: `mode:${mode};sources:${chosen.join("+")}`,
    ...(!r.ok ? { outcome: "error" as const, reasons: [`error_${r.error}`] }
      : shown === 0 ? { outcome: "rejected" as const, rejected: kept, reasons: [r.check.ok ? "no_part" : r.check.reason] }
        : { outcome: shown < kept ? "partial" as const : "accepted" as const, accepted: shown, rejected: kept - shown }),
  });
  await audit(ctx, SCHOLAR_AI_AUDIT_ACTION, "individual_scholar_explain_across", null, {
    action_id: ai.actionId, question_chars: question.length, mode, chosen, chunk_ids: passages.map(p => p.chunkId),
    library_items: library.length, research: research ? { state: research.state, items: research.items.length, evidence: evidence.length } : null,
    outcome: r.ok ? (r.check.ok ? "shown" : `withheld:${r.check.reason}`) : `error:${r.error}`,
    library_outcome: libraryPart ? (libraryPart.ok ? "shown" : `withheld:${libraryPart.reason}`) : null, research_outcome: researchPart ? (researchPart.ok ? "shown" : `withheld:${researchPart.reason}`) : null,
    model: r.ok ? r.model : null, prompt_version: r.ok ? r.promptVersion : null,
  });
  if (!r.ok) return NextResponse.json({ error: AI_ERROR[r.error].error, code: AI_ERROR[r.error].code }, { status: AI_ERROR[r.error].status });

  const mainOk = r.check.ok;
  const withheldMain = !r.check.ok && r.check.reason !== "not_in_notes" && passages.length > 0;
  const cited = r.check.ok ? r.check.cited : [];
  const sources = passages.map((p, i) => ({
    tag: passageTag(i), chunkId: p.chunkId, materialId: p.materialId, materialTitle: p.materialTitle, excerpt: p.content.slice(0, 400),
    origin: originOf.get(p.chunkId) ?? "materials", savedPath: savedPath.get(p.chunkId), citation: originOf.get(p.chunkId) === "saved" ? p.materialTitle : passageCitation(p),
  })).filter((_, i) => cited.includes(i + 1));
  const libraryCited = libraryPart?.ok ? libraryPart.cited : [];
  const researchCited = researchPart?.ok ? researchPart.cited : [];
  const used = references.filter(x => x.evidence && researchCited.includes(Number((x.tag ?? "").slice(1))))
    .map(x => ({ tag: x.tag, title: x.title, journal: x.journal, year: x.year, provider: x.provider, url: x.url, excerpt: x.excerpt }));
  // Evidence the model did not use was read but not relied on, so it is not cited as support: it is listed with what was only found.
  const unused = references.filter(x => x.evidence && !researchCited.includes(Number((x.tag ?? "").slice(1)))).map(x => ({ title: x.title, journal: x.journal, year: x.year, provider: x.provider, url: x.url }));
  const message = shown === 0 ? (r.check.ok ? NOTHING : r.check.reason === "not_in_notes" ? NOTHING : EXPLAIN_REFUSAL[r.check.reason]) : undefined;

  return NextResponse.json({
    answer: mainOk && r.check.ok ? r.check.text : null, label: AI_LABEL, message, sources, mode,
    library: library.length ? {
      label: ASK_LIBRARY_LABEL, text: libraryPart?.ok ? libraryPart.text : null, withheld: libraryPart && !libraryPart.ok ? askPartWithheld(ASK_SOURCE_LABEL.library, libraryPart.reason) : null,
      items: libraryRefs.filter((_, i) => libraryCited.includes(i + 1)),
    } : null,
    research: research && references.length ? {
      label: ASK_RESEARCH_LABEL, text: researchPart?.ok ? researchPart.text : null, withheld: researchPart && !researchPart.ok ? RESEARCH_WITHHELD[researchPart.reason] : null,
      used, found: [...unused, ...found],
    } : null,
    searched: reply(mainOk, withheldMain, !!libraryPart?.ok, !!libraryPart && !libraryPart.ok, !!researchPart?.ok, !!researchPart && !researchPart.ok),
    provenance: { model: r.model, promptVersion: r.promptVersion }, passageIds: passages.map(p => p.chunkId), actionId: ai.actionId,
  });
}
