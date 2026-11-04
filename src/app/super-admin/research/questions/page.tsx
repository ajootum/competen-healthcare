import type { Metadata } from "next";
import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { ckriEnabled, loadCkriPolicy } from "@/lib/knowledge/governance";
import { VERSION_STATUS_LABEL } from "@/lib/knowledge/educator";
import { STATUS_FILTERS, filterCatalogue, loadCatalogue, type CatalogueItem, type CatalogueVersion } from "@/lib/knowledge/question-catalogue";
import { loadFormatCorrectness, loadLibraryPerformance, misconceptionPatterns, type FormatResult, type VersionPerformance, MIN_ATTEMPTS, WEAK_DISCRIMINATION } from "@/lib/knowledge/question-performance";
import { DIFFICULTY_LABEL, LIBRARY_DIFFICULTIES, QUALIFICATION_LABEL, QUALIFICATION_LEVELS, metaSummary } from "@/lib/individual/scholar/library-meta";
import { LIBRARY_FORM_OPTIONS } from "@/lib/individual/scholar/question-formats";
import { FORMAT_LABEL } from "@/lib/ai/sqie-monitoring";
import { loadProgrammeOptions } from "@/lib/knowledge/library-admin";
import { BulkLibraryActions, type BulkRow } from "../_components/LibraryControls";
import { BAND_LABEL } from "@/lib/knowledge/question-similarity";
import { SOURCE_KIND_LABEL, looksCited, sourceRefusal } from "@/lib/knowledge/question-source";
import { StatusChip } from "../_components/KnowledgeStatus";
import { ActionButton } from "../_components/ResearchControls";

// /super-admin/research/questions -- the HQ question library catalogue (SQIE-COMPLETE-01, owner GO 31 Oct 2026).
// A read model over the CKRI knowledge library (migration 442): search and filter the revision questions, open one to see
// every version, its answer key, provenance, rights, review trail, possible duplicates and aggregate performance.
// Same right as the educator page (hq.learning.ckri.educator). It writes nothing itself: editing, review and publication stay
// on the educator, knowledge-review and knowledge-publication pages. SQIE-LIBRARY-EXPANSION-01 (801): a holder of
// hq.quality.knowledge.publish may retire ONE published version here, with a reason (the API and the database check again). Performance is AGGREGATE COUNTS
// per library version (question-performance.ts): no learner identity and no learner content.
// SQIE-CLOSE-2026-11 WS-E: filters by format, programme, qualification level and difficulty, and bulk submit / replace / retire
// (each item checked on its own). WS-G: every learner-derived figure comes from migration 996 -- consenting learners only
// (collective_analytics), cells under the CKRI minimum cohort suppressed -- per version (percent correct, discrimination
// index, first-attempt choices), per format, and the misconception patterns of HQ's own rubrics.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Question library" };
const card = "rounded-xl border border-gray-200 bg-white p-4";
const field = "block w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px]";
const ORIGIN: Record<string, string> = { educator: "Educator-written", ai_draft: "AI draft, educator-reviewed", learner_contribution: "Drafted from a learner offer (learner not named)" };
const EP = "/api/hq/knowledge/educator";
const ROLE: Record<string, string> = { author: "Written by", educator_review: "Educator review", submitted: "Submitted by", clinical_approved: "Clinically approved by", clinical_rejected: "Rejected by", published: "Published by" };
const when = (t: string | null) => (t ? new Date(t).toISOString().slice(0, 10) : "date not recorded");
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Perf({ p, measured, reason, floor }: { p: VersionPerformance | undefined; measured: boolean; reason: string | null; floor: number }) {
  if (!measured) return <span className="text-gray-600">{reason ?? "Not measured."}</span>;
  if (!p || p.suppressed) return <span className="text-gray-600">Fewer than {floor} consenting learners have answered it: not reported (minimum cohort).</span>;
  return (
    <span>
      {p.learners} learner{p.learners === 1 ? "" : "s"} · {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · {p.percentCorrect == null ? "% correct: no data yet" : `${p.percentCorrect}% correct`}{p.firstPercentCorrect != null ? ` (${p.firstPercentCorrect}% at the first attempt)` : ""} · last used {p.lastUsed ?? "never"}
      {" · "}{p.discrimination == null ? "discrimination: not enough learners who also answered other items" : `discrimination ${p.discrimination.toFixed(2)}`}
      {p.flag && <strong className="ml-1 rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-amber-950">Review difficulty/key</strong>}
      {p.discriminationFlag === "negative" && <strong className="ml-1 rounded border border-red-400 bg-red-50 px-1.5 py-0.5 text-red-900">Negative discrimination: check the key</strong>}
      {p.discriminationFlag === "weak" && <strong className="ml-1 rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-amber-950">Weak discrimination (under {WEAK_DISCRIMINATION})</strong>}
      {!p.flag && p.attempts != null && p.attempts < MIN_ATTEMPTS && p.attempts > 0 && <span className="text-gray-600"> (fewer than {MIN_ATTEMPTS} attempts: not enough to judge)</span>}
    </span>
  );
}

/** First-attempt choices of a single best answer item: which distractors learners pick. A cell under the floor is hidden. */
function Choices({ v, p }: { v: CatalogueVersion; p: VersionPerformance | undefined }) {
  if (v.format !== "mcq" || !p || p.suppressed || !p.options) return null;
  return (
    <p><span className="font-semibold text-gray-700">First-attempt choices: </span>{p.options.map((n, i) => `${String.fromCharCode(65 + i)}${i === v.correctIndex ? " (key)" : ""} ${n == null ? "hidden (small cell)" : n}`).join(" · ")}</p>
  );
}

function FormatTable({ f }: { f: FormatResult }) {
  const formats = [...new Set(f.rows.map(r => r.format))].sort();
  const cell = (format: string, source: "personal" | "library") => {
    const r = f.rows.find(x => x.format === format && x.source === source);
    if (!r) return <span className="text-gray-500">none</span>;
    if (r.suppressed) return <span className="text-gray-600">fewer than {f.floor}</span>;
    return <span>{r.percentCorrect == null ? "no data" : `${r.percentCorrect}%`} <span className="text-gray-500">({r.attempts} attempts, {r.learners} learners)</span></span>;
  };
  return (
    <section className={card} aria-labelledby="pf-h">
      <h2 id="pf-h" className="text-[15px] font-bold text-gray-900">Correctness by question format <span className="text-[12px] font-normal text-gray-600">last {f.days} days · consenting learners · minimum cohort {f.floor}</span></h2>
      <p className="text-[12.5px] text-gray-600">Learners who granted collective educational analytics only. A cell describing fewer than {f.floor} learners is not reported. Counts are rounded. Formative practice, not assessment.</p>
      {!f.measured ? <p role="status" className="text-[13px] text-gray-700">{f.reason}</p> : !formats.length ? <p className="text-[13px] text-gray-600">No consenting learner has answered a question in this window.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-[12.5px]">
          <caption className="sr-only">Percent correct by format and source</caption>
          <thead><tr className="text-[11px] uppercase tracking-wide text-gray-500"><th scope="col" className="py-1 pr-3">Format</th><th scope="col" className="pr-3">Personal questions</th><th scope="col">Library copies</th></tr></thead>
          <tbody className="divide-y divide-gray-100 tabular-nums">{formats.map(fm => (
            <tr key={fm}><th scope="row" className="py-1.5 pr-3 font-medium text-gray-900">{FORMAT_LABEL[fm] ?? fm.replace(/_/g, " ")}</th><td className="pr-3">{cell(fm, "personal")}</td><td>{cell(fm, "library")}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

type PerfView = { byVersion: Map<string, VersionPerformance>; measured: boolean; reason: string | null; floor: number };

function Detail({ item, names, matches, perf, canRetire }: {
  item: CatalogueItem; names: Map<string, string>; matches: { item: CatalogueItem; score: number; band: "likely_duplicate" | "similar" }[]; perf: PerfView; canRetire: boolean;
}) {
  return (
    <section className={`${card} space-y-4`} aria-labelledby="d-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 id="d-h" className="text-[16px] font-bold text-gray-900">{item.title}</h2><p className="text-[12.5px] text-gray-600"><code>{item.code}</code> · resource {item.resourceStatus} · {item.versions.length} version{item.versions.length === 1 ? "" : "s"}</p></div>
        <div className="flex flex-wrap gap-2 text-[13px] font-semibold text-teal-800">
          <Link className="underline" href={`/super-admin/research/educator#res-${item.resourceId}`}>Edit or start a new version</Link>
          <Link className="underline" href="/super-admin/research/knowledge-review">Review queue</Link>
          <Link className="underline" href="/super-admin/research/knowledge-publication">Publish or retire resource</Link>
        </div>
      </div>
      <p className="text-[12.5px] text-gray-700">Publishing a newer version supersedes the earlier one. A single published version can be retired with a reason: the resource stays active, learners are no longer given that version, and every earlier attempt, rubric and review record stays.{item.resourceStatus === "active" && !item.served ? <strong> Learners are given no version of this question now: a newer version must be approved and published.</strong> : null}</p>
      {matches.length > 0 && (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-950">
          <p className="font-semibold">Possible duplicates in the library</p>
          <ul className="ml-4 list-disc">{matches.map(m => <li key={m.item.resourceId}><Link className="underline" href={`?r=${m.item.resourceId}`}>{m.item.title}</Link> <code>{m.item.code}</code> · {BAND_LABEL[m.band]} ({Math.round(m.score * 100)}%)</li>)}</ul>
        </div>
      )}
      {item.versions.map(v => <VersionCard key={v.id} v={v} names={names} perf={perf} canRetire={canRetire && item.resourceStatus === "active"} />)}
    </section>
  );
}

function VersionCard({ v, names, perf, canRetire }: { v: CatalogueVersion; names: Map<string, string>; perf: PerfView; canRetire: boolean }) {
  const rights = sourceRefusal(v.content);
  const cited = !v.source || v.source.kind === "own_writing" ? looksCited(`${v.stem} ${v.rationale}`) : false;
  return (
    <article className="space-y-2 rounded-lg border border-gray-200 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Version {v.versionNo}</span><StatusChip status={v.status} /><span className="text-gray-600">{ORIGIN[v.origin] ?? v.origin}{v.required !== null ? ` · ${v.approvals} of ${v.required} clinical approvals` : ""}</span></div>
      <p className="whitespace-pre-wrap font-medium text-gray-900">{v.stem || "(no readable stem)"}</p>
      <p><span className="font-semibold text-gray-700">Format: </span>{v.formatLabel} · <span className="font-semibold text-gray-700">Marking: </span>{v.marking}</p>
      <p><span className="font-semibold text-gray-700">Programme, level, difficulty: </span>{v.meta ? [v.meta.programmes?.length ? `programmes ${v.meta.programmes.join(", ")}` : "every programme", v.meta.level ? QUALIFICATION_LABEL[v.meta.level] : "any level", v.meta.difficulty ? DIFFICULTY_LABEL[v.meta.difficulty] : "difficulty not set (standard)"].join(" · ") : "Not recorded: offered to every programme and level, at standard difficulty"}</p>
      <ol className="space-y-1">{v.options.map((o, i) => (
        <li key={i} className={`rounded border px-2 py-1 ${i === v.correctIndex ? "border-teal-600 bg-teal-50 text-teal-950" : "border-gray-200"}`}>
          <span className="mr-1 font-semibold">{String.fromCharCode(65 + i)}.</span>{o}{i === v.correctIndex && <strong className="ml-2">Correct answer (key)</strong>}
        </li>))}</ol>
      {v.format === "mcq" && v.correctIndex === null && <p role="alert" className="text-[var(--cmp-text-critical)]">No valid answer key is stored on this version.</p>}
      {v.format !== "mcq" && <p><span className="font-semibold text-gray-700">Answer key: </span>{v.keyText || <strong className="text-[var(--cmp-text-critical)]">No valid answer key is stored on this version.</strong>}</p>}
      <p><span className="font-semibold text-gray-700">Rubric: </span>{v.rubric ? [v.rubric.level ?? "level not set", v.rubric.objective, v.rubric.keyPoints.length ? "key points: " + v.rubric.keyPoints.join("; ") : null, v.rubric.misconceptions.length ? "misconceptions: " + v.rubric.misconceptions.join("; ") : null].filter(Boolean).join(" · ") : "None recorded"}</p>
      <p><span className="font-semibold text-gray-700">Rationale: </span><span className="whitespace-pre-wrap">{v.rationale || "none"}</span></p>
      <p><span className="font-semibold text-gray-700">Competencies: </span>{v.competencyIds.length ? v.competencyIds.map(c => names.get(c) ?? c).join(", ") : "none set"}</p>
      <p><span className="font-semibold text-gray-700">Provenance: </span>{ORIGIN[v.origin] ?? v.origin}{v.aiProvenance ? ` · model ${v.aiProvenance.model ?? "unknown"}, prompt ${v.aiProvenance.prompt_version ?? "unknown"}` : ""}</p>
      <p>
        <span className="font-semibold text-gray-700">Source and rights: </span>
        {v.source ? <>{SOURCE_KIND_LABEL[v.source.kind]}{v.source.reference ? ` · ${v.source.reference}` : ""}{v.source.licence ? ` · licence ${v.source.licence}` : ""}{v.source.permissionNote ? ` · ${v.source.permissionNote}` : ""}</> : "Not declared (written before source rights were recorded)"}
        {rights && <strong className="ml-1 text-[var(--cmp-text-critical)]"> Cannot be published: {rights}</strong>}
        {cited && <strong className="ml-1 text-amber-950"> The text looks like it cites a source but declares none.</strong>}
      </p>
      <div><p className="font-semibold text-gray-700">Review and approval trail</p>
        <ul className="ml-4 list-disc">{v.trail.map((t, i) => <li key={i}>{ROLE[t.role]} {t.name} · {when(t.at)}{t.comment ? ` · “${t.comment}”` : ""}</li>)}</ul></div>
      <p><span className="font-semibold text-gray-700">Performance (consenting learners, aggregate): </span><Perf p={perf.byVersion.get(v.id)} measured={perf.measured} reason={perf.reason} floor={perf.floor} /></p>
      <Choices v={v} p={perf.byVersion.get(v.id)} />
      {canRetire && v.state === "published" && <ActionButton endpoint={EP} body={{ action: "retire_version", versionId: v.id }} label="Retire this version" note="Reason (10 to 500 characters)" done="Retired. Learners are no longer given this version; every earlier attempt and record stays. Until a newer version is published, learners are given none." />}
    </article>
  );
}

export default async function QuestionLibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireHqCapability("hq.learning.ckri.educator");
  const sp = await searchParams;
  const [on, cat, ckri, programmes] = await Promise.all([ckriEnabled(ctx.admin), loadCatalogue(ctx.admin), loadCkriPolicy(ctx.admin), loadProgrammeOptions(ctx.admin)]);
  const f = { q: pick(sp.q), status: pick(sp.status), origin: pick(sp.origin), competency: pick(sp.competency), topic: pick(sp.topic), duplicates: pick(sp.dup) === "1",
    format: pick(sp.format), programme: pick(sp.programme), level: pick(sp.level), difficulty: pick(sp.difficulty) };
  const rules = { minCohort: ckri.minCohort, roundTo: ckri.roundTo };
  const openId = pick(sp.r);
  const header = (
    <header>
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings · Knowledge &amp; Research Intelligence</p>
      <h1 className="text-xl font-bold text-gray-900">Question library</h1>
      <p className="mt-1 text-sm text-gray-600">Every revision question in the governed library, in every format: status, answer key, rubric, marking rule, provenance, rights, review trail, possible duplicates and aggregate performance. Actions are on the educator, review and publication pages; a publisher can retire a single version here.</p>
    </header>
  );
  if (!cat) return <div className="max-w-5xl space-y-6">{header}<p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">The library could not be read (or migration 442 is not applied here).</p></div>;

  const byLatest = new Map(cat.items.map(i => [i.latest.id, i]));
  const dupIds = new Set(cat.pairs.flatMap(p => [p.a, p.b]));
  const rows = filterCatalogue(cat.items, f, dupIds);
  const open = openId ? cat.items.find(i => i.resourceId === openId) ?? null : null;
  const matches = open ? cat.pairs.flatMap(p => (p.a === open.latest.id ? [{ id: p.b, p }] : p.b === open.latest.id ? [{ id: p.a, p }] : []))
    .flatMap(({ id, p }) => { const it = byLatest.get(id); return it ? [{ item: it, score: p.score, band: p.band }] : []; }) : [];
  // Performance: the served versions for the list, every version for the opened item. Aggregate counts only.
  // WS-G: through migration 996 only (consented, suppressed). Misconception patterns over the served versions of the list.
  const servedIds = rows.map(i => i.served?.id).filter((x): x is string => !!x);
  const wanted = open ? [...new Set([...open.versions.map(v => v.id), ...servedIds])] : servedIds;
  const [perf, formats] = await Promise.all([loadLibraryPerformance(ctx.admin, wanted, rules), loadFormatCorrectness(ctx.admin, rules)]);
  const patterns = perf.measured ? misconceptionPatterns(rows.flatMap(i => (i.served ? [{ versionId: i.served.id, misconceptions: i.served.rubric?.misconceptions ?? [] }] : [])), perf.byVersion) : [];
  const canRetire = ctx.capabilities.includes("hq.quality.knowledge.publish");
  const bulkRows: BulkRow[] = rows.map(i => ({
    resourceId: i.resourceId, title: i.title, code: i.code, draftVersionId: i.latest.state === "draft" ? i.latest.id : null,
    servedVersionId: i.resourceStatus === "active" && i.served ? i.served.id : null, replaceable: i.resourceStatus === "active" && i.latest.state !== "draft",
  }));
  const competencies = [...cat.competencyNames.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="max-w-5xl space-y-6">
      {header}
      {!on && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">CKRI is switched off in this environment. The library is shown read only.</p>}
      <form method="get" className={`${card} grid gap-3 md:grid-cols-3`} aria-label="Search and filter the question library">
        <label className="text-[12.5px] md:col-span-2">Search stem text or code<input name="q" defaultValue={f.q ?? ""} className={field} /></label>
        <label className="text-[12.5px]">Topic<input name="topic" defaultValue={f.topic ?? ""} className={field} /></label>
        <label className="text-[12.5px]">Status<select name="status" defaultValue={f.status ?? ""} className={field}><option value="">Any</option>{STATUS_FILTERS.map(s => <option key={s} value={s}>{s === "submitted" ? "Submitted (in clinical review)" : s === "reviewed" ? "Educator-reviewed" : s === "active" ? "Active (given to learners now)" : s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        <label className="text-[12.5px]">Origin<select name="origin" defaultValue={f.origin ?? ""} className={field}><option value="">Any</option><option value="educator">Educator-written</option><option value="ai_draft">AI draft</option><option value="learner_contribution">From a learner offer</option></select></label>
        <label className="text-[12.5px]">Competency<select name="competency" defaultValue={f.competency ?? ""} className={field}><option value="">Any</option>{competencies.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <label className="text-[12.5px]">Duplicates<select name="dup" defaultValue={f.duplicates ? "1" : ""} className={field}><option value="">Any</option><option value="1">Has possible duplicates</option></select></label>
        <label className="text-[12.5px]">Format<select name="format" defaultValue={f.format ?? ""} className={field}><option value="">Any</option>{LIBRARY_FORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        <label className="text-[12.5px]">Programme<select name="programme" defaultValue={f.programme ?? ""} className={field}><option value="">Any</option><option value="none">Names no programme</option>{(programmes ?? []).map(p => <option key={p.code} value={p.code}>{p.label}</option>)}</select></label>
        <label className="text-[12.5px]">Qualification level<select name="level" defaultValue={f.level ?? ""} className={field}><option value="">Any</option><option value="none">Not set</option>{QUALIFICATION_LEVELS.map(l => <option key={l} value={l}>{QUALIFICATION_LABEL[l]}</option>)}</select></label>
        <label className="text-[12.5px]">Difficulty<select name="difficulty" defaultValue={f.difficulty ?? ""} className={field}><option value="">Any</option><option value="none">Not set</option>{LIBRARY_DIFFICULTIES.map(d => <option key={d} value={String(d)}>{DIFFICULTY_LABEL[d]}</option>)}</select></label>
        <div className="flex items-end gap-3 md:col-span-2"><button type="submit" className="min-h-9 rounded-lg bg-teal-700 px-4 py-1.5 text-[13px] font-semibold text-white pointer-coarse:min-h-[var(--cmp-touch-min)]">Apply</button><Link href="?" className="text-[13px] font-semibold text-teal-800 underline">Clear</Link></div>
      </form>
      {open && <Detail item={open} names={cat.competencyNames} matches={matches} perf={perf} canRetire={canRetire} />}
      {openId && !open && <p role="alert" className="text-[13px] text-[var(--cmp-text-critical)]">That question is not in the library.</p>}
      <section className={card} aria-labelledby="l-h">
        <h2 id="l-h" className="text-[15px] font-bold text-gray-900">{rows.length} of {cat.items.length} question{cat.items.length === 1 ? "" : "s"}</h2>
        {cat.pairsTruncated && <p role="status" className="text-[12.5px] text-amber-950">The duplicate scan was capped (large library): some pairs may not be listed.</p>}
        {rows.length > 0 && <div className="my-2"><BulkLibraryActions rows={bulkRows} canRetire={canRetire} /></div>}
        {rows.length === 0 ? <p className="text-[13px] text-gray-600">{cat.items.length ? "Nothing matches these filters." : "The library has no revision questions yet."}</p> : (
          <ul className="divide-y divide-gray-100 text-[13px]">{rows.map(i => {
            const p = i.served ? perf.byVersion.get(i.served.id) : undefined;
            const dup = i.versions.some(v => dupIds.has(v.id));
            return (
              <li key={i.resourceId} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 space-y-0.5">
                  <Link className="font-semibold text-teal-800 underline" href={`?r=${i.resourceId}`}>{i.title}</Link> <code className="text-gray-600">{i.code}</code>
                  <p className="line-clamp-2 text-gray-700">{i.latest.stem}</p>
                  <p className="text-[12px] text-gray-600">{i.latest.formatLabel}{metaSummary(i.latest.meta) ? ` · ${metaSummary(i.latest.meta)}` : ""} · Version {i.latest.versionNo} of {i.versions.length} · {ORIGIN[i.latest.origin] ?? i.latest.origin} · {i.latest.source ? SOURCE_KIND_LABEL[i.latest.source.kind] : "source not declared"}{i.resourceStatus === "retired" ? " · resource retired" : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip status={i.latest.status} />
                  {i.served && i.served.id !== i.latest.id && <span className="text-[12px] text-gray-600">v{i.served.versionNo} {VERSION_STATUS_LABEL.published.toLowerCase()}</span>}
                  {dup && <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-950">Possible duplicate</span>}
                  {p?.flag && <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-950">Review difficulty/key</span>}
                  {p?.discriminationFlag && <span className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-950">{p.discriminationFlag === "negative" ? "Negative discrimination" : "Weak discrimination"}</span>}
                </div>
              </li>
            );
          })}</ul>
        )}
      </section>
      <FormatTable f={formats} />
      <section className={card} aria-labelledby="mp-h">
        <h2 id="mp-h" className="text-[15px] font-bold text-gray-900">Misconception patterns <span className="text-[12px] font-normal text-gray-600">published questions shown above · consenting learners</span></h2>
        <p className="text-[12.5px] text-gray-600">The misconceptions the library's own rubrics name, weighted by how many consenting learners got those questions wrong at their first attempt. Questions under the minimum cohort ({perf.floor}) are left out. Nothing a learner wrote is read.</p>
        {!perf.measured ? <p role="status" className="text-[13px] text-gray-700">{perf.reason}</p> : !patterns.length ? <p className="text-[13px] text-gray-600">No pattern to report: no published question shown above names a misconception and has enough consenting learners.</p> : (
          <ol className="ml-4 list-decimal text-[13px]">{patterns.map(m => <li key={m.misconception}>{m.misconception} <span className="text-gray-600">· {m.missedLearners} learner{m.missedLearners === 1 ? "" : "s"} missed · {m.versions} question{m.versions === 1 ? "" : "s"}</span></li>)}</ol>
        )}
      </section>
    </div>
  );
}
