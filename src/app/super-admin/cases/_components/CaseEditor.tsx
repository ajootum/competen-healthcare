"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { primary, ghost, input, Message } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";
import { screenBlueprint, SCREEN_LABEL } from "@/lib/cases/screen";
import { Problems, useCaseSend } from "./CaseControls";
import { CASE_FACT_KINDS, REASONING_CAPS, STAGE_CATEGORIES, STAGE_CATEGORY_LABEL } from "@/lib/cases/categories";
import { TimelineField } from "./TimelineField";

// THE NO-CODE CASE EDITOR (C2 s8: edit clinical findings and structure, configure decision points and progression,
// define objectives and assessment, link CFCA outcomes, add references and rationales). It edits ONE draft as a
// case-blueprint/1 document. The checks shown live are the same pure functions the server runs at submission --
// the identifier screen, live here, and validateBlueprint (library profile), which the server runs on every save and
// returns -- so what you see is what will be refused. (blueprint.ts holds the server-side view tokens, so it is never
// bundled for a browser.) Ids are made here, never typed.

type Comp = { id: string; label: string; outcomes?: string[] };
type Opt = { id: string; label: string };
/** The catalogue a case is classified by (studio.ts classificationOptions). Null when it could not be read. */
export type ClassOpts = { professions: Opt[]; specialties: Opt[]; cfcaDomains: Opt[]; cpus: Opt[]; proficiency: Opt[] } | null;

// CLASSIFICATION (owner, Stage 5B case classification decision): references to the existing catalogue records, several
// of each, all OPTIONAL while drafting. Completeness is the case policy's and is checked at submission only.
const CLASS_FIELDS = [
  { key: "professions", field: "professionTermIds", legend: "Professions", none: "The catalogue holds no profession terms yet." },
  { key: "specialties", field: "specialtyTermIds", legend: "Clinical specialties or practice contexts", none: "The catalogue holds no specialty terms yet." },
  { key: "cfcaDomains", field: "cfcaDomainIds", legend: "CFCA domains", none: "No shared framework has domains yet." },
  { key: "cpus", field: "cpuIds", legend: "Competency Practice Units (CPUs)", none: "No CPU sits under a shared framework yet." },
  { key: "proficiency", field: "proficiencyLevelIds", legend: "Proficiency levels", none: "No proficiency scale is set up yet." },
] as const;
const KINDS = CASE_FACT_KINDS;
const lbl = "block text-[12.5px] text-gray-700";
const box = "rounded-xl border border-gray-200 bg-white p-4";
const h2 = "text-[14px] font-bold text-gray-900";
const small = "text-[12px] text-gray-500";
const nextId = (prefix: string, used: string[]) => { let n = 1; while (used.includes(`${prefix}${n}`)) n++; return `${prefix}${n}`; };
const blankVoice = () => ({ speaker: "patient", persona: "", style: "", knowsFactIds: [] as string[], knowsStatements: [] as any[], keyQuestions: [] as any[], notKnownReply: null });
const lines = (s: string) => s.split("\n").map(x => x.trim()).filter(Boolean);

export function CaseEditor({ versionId, initial, competencies, dimensions, initialProblems, classification }: { versionId: string; initial: any; competencies: Comp[]; dimensions: string[]; initialProblems: string[]; classification: ClassOpts }) {
  const [b, setB] = useState<any>(() => JSON.parse(JSON.stringify(initial)));
  const [structural, setStructural] = useState<string[]>(initialProblems);
  const [dirty, setDirty] = useState(false);
  const { busy, msg, send } = useCaseSend();
  const up = (f: (x: any) => void) => { setDirty(true); setB((prev: any) => { const next = JSON.parse(JSON.stringify(prev)); f(next); return next; }); };
  const problems = useMemo(() => [...screenBlueprint(b).map(k => `It contains ${SCREEN_LABEL[k]}.`), ...structural], [b, structural]);
  const factIds: string[] = b.facts.map((f: any) => f.id);
  const allIds = [...factIds, ...b.stages.map((s: any) => s.id), ...b.decisionPoints.map((d: any) => d.id)];
  const factLabel = (id: string) => b.facts.find((f: any) => f.id === id)?.label || id;
  const optionsOfStage = (sid: string) => b.decisionPoints.filter((d: any) => d.stageId === sid).flatMap((d: any) => d.options.map((o: any) => o));
  const toggle = (arr: string[], id: string, on: boolean) => (on ? [...new Set([...arr, id])] : arr.filter(x => x !== id));
  // The single legacy profession field folds into the list the editor shows, and stays its first (studio.ts saveDraft).
  const listOf = (field: string): string[] => field === "professionTermIds"
    ? [...new Set([...(b.metadata.professionTermIds ?? []), ...(b.metadata.professionTermId ? [b.metadata.professionTermId] : [])])]
    : (b.metadata[field] ?? []);
  const setList = (field: string, ids: string[]) => up(x => { x.metadata[field] = ids; if (field === "professionTermIds") x.metadata.professionTermId = ids[0] ?? null; });
  const compById = new Map(competencies.map(c => [c.id, c]));

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white/95 p-3 backdrop-blur">
        <button type="button" className={primary} disabled={busy} onClick={() => send({ action: "save", versionId, content: b }, "Draft saved.", j => { setStructural(Array.isArray(j?.problems) ? j.problems : []); setDirty(false); })}>Save draft</button>
        <span className={`text-[12.5px] ${problems.length || dirty ? "text-amber-900" : "text-[var(--cmp-text-success)]"}`}>{dirty ? "Unsaved changes: save to re-check the case" : problems.length ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to do before clinical review` : "Ready to submit for clinical review"}</span>
        <Message msg={msg} />
      </div>
      <Problems items={problems} />

      <section className={box} aria-labelledby="ed-basics">
        <h2 id="ed-basics" className={h2}>The case</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className={lbl}>Title<input className={`${input} mt-1 block w-full`} value={b.title ?? ""} onChange={e => up(x => { x.title = e.target.value; })} /></label>
          <label className={lbl}>Level<select className={`${input} mt-1 block w-full`} value={b.metadata.level} onChange={e => up(x => { x.metadata.level = e.target.value; })}><option value="foundation">Foundation</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
          <label className={lbl}>Complexity (1 to 5)<input type="number" min={1} max={5} className={`${input} mt-1 block w-full`} value={b.metadata.complexity} onChange={e => up(x => { x.metadata.complexity = Math.min(5, Math.max(1, Number(e.target.value) || 1)); })} /></label>
          <label className={lbl}>Clinical risk<select className={`${input} mt-1 block w-full`} value={b.metadata.risk} onChange={e => up(x => { x.metadata.risk = e.target.value; })}><option value="standard">Standard</option><option value="high">High (may need more approvals)</option></select></label>
          <label className={`${lbl} sm:col-span-2`}>Summary, for educators and the catalogue (never shown to a learner)<textarea rows={2} className={`${input} mt-1 block w-full`} value={b.summary ?? ""} onChange={e => up(x => { x.summary = e.target.value; })} /></label>
          <label className={`${lbl} sm:col-span-2`}>Learner opening (no spoilers)<textarea rows={2} className={`${input} mt-1 block w-full`} value={b.learnerIntro ?? ""} onChange={e => up(x => { x.learnerIntro = e.target.value; })} /></label>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-class">
        <h2 id="ed-class" className={h2}>Classification</h2>
        <p className={small}>From the existing catalogue. Choose as many as apply. Optional while you draft: the case policy says what a case needs before it can be submitted.</p>
        {classification === null ? (
          <p role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">The catalogue could not be read just now, so classification cannot be changed. What the case already carries is kept when you save.</p>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {CLASS_FIELDS.map(f => {
              const opts = classification[f.key];
              const chosen = listOf(f.field);
              const orphans = chosen.filter(id => !opts.some(o => o.id === id));
              return (
                <fieldset key={f.key} className="max-h-44 overflow-y-auto rounded-lg border border-gray-100 p-2">
                  <legend className="text-[12.5px] font-semibold text-gray-800">{f.legend}{chosen.length ? ` (${chosen.length})` : ""}</legend>
                  {opts.length === 0 && <p className={small}>{f.none}</p>}
                  {opts.map(o => <label key={o.id} className="block text-[12.5px] pointer-coarse:py-1"><input type="checkbox" className="mr-1" checked={chosen.includes(o.id)} onChange={e => setList(f.field, toggle(chosen, o.id, e.target.checked))} />{o.label}</label>)}
                  {orphans.length > 0 && <p className="mt-1 text-[12px] text-amber-900">{orphans.length} chosen {orphans.length === 1 ? "entry is" : "entries are"} no longer in the catalogue. <button type="button" className="underline" onClick={() => setList(f.field, chosen.filter(id => !orphans.includes(id)))}>Remove</button></p>}
                </fieldset>
              );
            })}
          </div>
        )}
      </section>

      <section className={box} aria-labelledby="ed-patient">
        <h2 id="ed-patient" className={h2}>The patient (synthetic, coarse)</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className={lbl}>Age band (for example 60-69)<input className={`${input} mt-1 block w-full`} value={b.patient?.ageBand ?? ""} onChange={e => up(x => { x.patient = { ...(x.patient ?? {}), ageBand: e.target.value }; })} /></label>
          <label className={lbl}>Sex<select className={`${input} mt-1 block w-full`} value={b.patient?.sex ?? "unspecified"} onChange={e => up(x => { x.patient = { ...(x.patient ?? {}), sex: e.target.value }; })}><option value="unspecified">Unspecified</option><option value="female">Female</option><option value="male">Male</option></select></label>
          <label className={lbl}>Setting<input className={`${input} mt-1 block w-full`} value={b.patient?.setting ?? ""} onChange={e => up(x => { x.patient = { ...(x.patient ?? {}), setting: e.target.value }; })} /></label>
          <label className={lbl}>Presenting complaint<input className={`${input} mt-1 block w-full`} value={b.patient?.presentingComplaint ?? ""} onChange={e => up(x => { x.patient = { ...(x.patient ?? {}), presentingComplaint: e.target.value }; })} /></label>
          <label className={`${lbl} sm:col-span-2`}>Background, one item per line<textarea rows={3} className={`${input} mt-1 block w-full`} value={(b.patient?.background ?? []).join("\n")} onChange={e => up(x => { x.patient = { ...(x.patient ?? {}), background: lines(e.target.value) }; })} /></label>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-facts">
        <h2 id="ed-facts" className={h2}>Clinical findings ({b.facts.length})</h2>
        <p className={small}>Every value is a governed fact. AI may phrase a reveal, never change a value.</p>
        <div className="mt-2 space-y-2">
          {b.facts.map((f: any, i: number) => (
            <fieldset key={f.id} className="grid gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-6">
              <legend className="sr-only">Finding {i + 1}</legend>
              <label className={lbl}>Kind<select className={`${input} mt-1 block w-full`} value={f.kind} onChange={e => up(x => { x.facts[i].kind = e.target.value; })}>{KINDS.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
              <label className={lbl}>Finding<input className={`${input} mt-1 block w-full`} value={f.label} onChange={e => up(x => { x.facts[i].label = e.target.value; })} /></label>
              <label className={lbl}>Value<input className={`${input} mt-1 block w-full`} value={f.value} onChange={e => up(x => { x.facts[i].value = e.target.value; })} /></label>
              <label className={lbl}>Unit<input className={`${input} mt-1 block w-full`} value={f.unit ?? ""} onChange={e => up(x => { x.facts[i].unit = e.target.value || null; })} /></label>
              <label className={lbl}>Revealed<select className={`${input} mt-1 block w-full`} value={f.revealedAt} onChange={e => up(x => { x.facts[i].revealedAt = e.target.value; })}>
                <option value="start">At the start</option><option value="request">Only when asked for</option>{b.stages.map((s: any) => <option key={s.id} value={s.id}>On reaching {s.title}</option>)}</select></label>
              <div className="flex items-end gap-2">
                <label className="text-[12.5px] text-gray-700"><input type="checkbox" className="mr-1" checked={f.safetyCritical} onChange={e => up(x => { x.facts[i].safetyCritical = e.target.checked; })} />Safety-critical</label>
                <button type="button" className={ghost} aria-label={`Remove finding ${f.label || i + 1}`} onClick={() => up(x => { x.facts.splice(i, 1); })}>Remove</button>
              </div>
            </fieldset>
          ))}
          <button type="button" className={ghost} onClick={() => up(x => { x.facts.push({ id: nextId("f", allIds), kind: "observation", label: "", value: "", unit: null, revealedAt: "start", safetyCritical: false }); })}>Add a finding</button>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-stages">
        <h2 id="ed-stages" className={h2}>Stages and decisions</h2>
        <div className="mt-2 space-y-3">
          {b.stages.map((s: any, si: number) => (
            <div key={s.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className={lbl}>Stage title<input className={`${input} mt-1 block w-64`} value={s.title} onChange={e => up(x => { x.stages[si].title = e.target.value; })} /></label>
                <label className={lbl}>Category (optional)<select className={`${input} mt-1 block w-48`} value={s.category ?? ""} onChange={e => up(x => { if (e.target.value) x.stages[si].category = e.target.value; else delete x.stages[si].category; })}><option value="">None</option>{STAGE_CATEGORIES.map(c => <option key={c} value={c}>{STAGE_CATEGORY_LABEL[c]}</option>)}</select></label>
                {s.category === "reflection" && <label className={`${lbl} min-w-[16rem] flex-1`}>Reflection prompt (shown to the learner at the end)<input className={`${input} mt-1 block w-full`} maxLength={1000} value={s.narrativeHint ?? ""} onChange={e => up(x => { x.stages[si].narrativeHint = e.target.value || null; })} /></label>}
                <button type="button" className={ghost} disabled={b.stages.length < 2} onClick={() => up(x => { const id = x.stages[si].id; x.stages.splice(si, 1); x.decisionPoints = x.decisionPoints.filter((d: any) => d.stageId !== id); x.progression = x.progression.filter((t: any) => t.from !== id && t.to !== id); })}>Remove stage</button>
              </div>
              <fieldset className="mt-2"><legend className={small}>Findings this stage reveals when reached</legend>
                {b.facts.map((f: any) => <label key={f.id} className="mr-3 inline-block text-[12.5px]"><input type="checkbox" className="mr-1" checked={s.reveals.includes(f.id)} onChange={e => up(x => { x.stages[si].reveals = toggle(x.stages[si].reveals, f.id, e.target.checked); })} />{f.label || f.id}</label>)}
              </fieldset>
              {b.decisionPoints.map((d: any, di: number) => d.stageId !== s.id ? null : (
                <div key={d.id} className="mt-3 rounded-lg bg-gray-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className={`${lbl} sm:col-span-3`}>Decision prompt<textarea rows={2} className={`${input} mt-1 block w-full`} value={d.prompt} onChange={e => up(x => { x.decisionPoints[di].prompt = e.target.value; })} /></label>
                    <label className={lbl}>Answer form<select className={`${input} mt-1 block w-full`} value={d.kind} onChange={e => up(x => { const dp = x.decisionPoints[di]; dp.kind = e.target.value; if (dp.kind === "handover") { dp.options = []; dp.handover = dp.handover ?? { elements: [] }; } else { delete dp.handover; if (!dp.options?.length) dp.options = [{ id: "o1", text: "", correct: true, rationale: "" }, { id: "o2", text: "", correct: false, rationale: "" }]; } })}><option value="single">One choice</option><option value="multiple">Several choices</option><option value="free_text">Written answer</option><option value="handover">SBAR handover</option></select></label>
                    <label className={lbl}>Reasoning dimension<select className={`${input} mt-1 block w-full`} value={d.dimension ?? ""} onChange={e => up(x => { x.decisionPoints[di].dimension = e.target.value; })}><option value="">Choose</option>{dimensions.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
                    <label className={lbl}>Hint (guided mode)<input className={`${input} mt-1 block w-full`} value={d.hint ?? ""} onChange={e => up(x => { x.decisionPoints[di].hint = e.target.value || null; })} /></label>
                    {d.kind !== "free_text" && d.kind !== "handover" && <label className="flex items-end gap-2 pb-1 text-[12.5px] text-gray-700"><input type="checkbox" className="mr-1" checked={d.askReason === true} onChange={e => up(x => { if (e.target.checked) x.decisionPoints[di].askReason = true; else delete x.decisionPoints[di].askReason; })} />Ask the learner to explain their choice (never changes the marking)</label>}
                    <label className={`${lbl} sm:col-span-3`}>Why (the decision&apos;s rationale)<textarea rows={2} className={`${input} mt-1 block w-full`} value={d.rationale ?? ""} onChange={e => up(x => { x.decisionPoints[di].rationale = e.target.value || null; })} /></label>
                  </div>
                  {d.kind === "free_text" ? (
                    <label className={`${lbl} mt-2`}>Expected answer (server-side only)<textarea rows={2} className={`${input} mt-1 block w-full`} value={d.expectedResponse ?? ""} onChange={e => up(x => { x.decisionPoints[di].expectedResponse = e.target.value; })} /></label>
                  ) : d.kind === "handover" ? (
                    <div className="mt-2 space-y-2">
                      <p className={small}>The learner writes a handover in four boxes (Situation, Background, Assessment, Recommendation). It is marked by code: each box written, then the points below mentioned. These points are server-side only.</p>
                      {(d.handover?.elements ?? []).map((el: any, ei: number) => (
                        <div key={el.id} className="grid gap-2 sm:grid-cols-6">
                          <label className={`${lbl} sm:col-span-2`}>Point a good handover mentions<input className={`${input} mt-1 block w-full`} value={el.label} onChange={e => up(x => { x.decisionPoints[di].handover.elements[ei].label = e.target.value; })} /></label>
                          <label className={lbl}>In which box<select className={`${input} mt-1 block w-full`} value={el.section ?? ""} onChange={e => up(x => { if (e.target.value) x.decisionPoints[di].handover.elements[ei].section = e.target.value; else delete x.decisionPoints[di].handover.elements[ei].section; })}><option value="">Anywhere</option><option value="situation">Situation</option><option value="background">Background</option><option value="assessment">Assessment</option><option value="recommendation">Recommendation</option></select></label>
                          <label className={`${lbl} sm:col-span-2`}>Words that count (comma-separated)<input className={`${input} mt-1 block w-full`} value={(el.terms ?? []).join(", ")} onChange={e => up(x => { x.decisionPoints[di].handover.elements[ei].terms = e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean); })} /></label>
                          <div className="flex items-end"><button type="button" className={ghost} aria-label={`Remove point ${ei + 1}`} onClick={() => up(x => { x.decisionPoints[di].handover.elements.splice(ei, 1); })}>Remove</button></div>
                        </div>
                      ))}
                      <button type="button" className={ghost} onClick={() => up(x => { const used = (x.decisionPoints[di].handover?.elements ?? []).map((q: any) => q.id); if (!x.decisionPoints[di].handover) x.decisionPoints[di].handover = { elements: [] }; x.decisionPoints[di].handover.elements.push({ id: nextId("e", used), label: "", terms: [] }); })}>Add a point</button>
                      <label className={lbl}>Pass mark (percent of the marks, default 70)<input type="number" min={1} max={100} className={`${input} mt-1 block w-24`} value={d.handover?.passMark ? Math.round(d.handover.passMark * 100) : ""} onChange={e => up(x => { if (e.target.value) x.decisionPoints[di].handover.passMark = Math.min(100, Math.max(1, Number(e.target.value))) / 100; else delete x.decisionPoints[di].handover.passMark; })} /></label>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {d.options.map((o: any, oi: number) => (
                        <div key={o.id} className="grid gap-2 sm:grid-cols-6">
                          <label className={`${lbl} sm:col-span-2`}>Option<input className={`${input} mt-1 block w-full`} value={o.text} onChange={e => up(x => { x.decisionPoints[di].options[oi].text = e.target.value; })} /></label>
                          <label className={`${lbl} sm:col-span-3`}>Rationale<input className={`${input} mt-1 block w-full`} value={o.rationale ?? ""} onChange={e => up(x => { x.decisionPoints[di].options[oi].rationale = e.target.value; })} /></label>
                          <div className="flex items-end gap-2">
                            <label className="text-[12.5px]"><input type={d.kind === "single" ? "radio" : "checkbox"} name={`key-${d.id}`} className="mr-1" checked={o.correct} onChange={e => up(x => { const ops = x.decisionPoints[di].options; if (d.kind === "single") ops.forEach((p: any, k: number) => { p.correct = k === oi; }); else ops[oi].correct = e.target.checked; })} />Key</label>
                            <button type="button" className={ghost} aria-label={`Remove option ${oi + 1}`} onClick={() => up(x => { x.decisionPoints[di].options.splice(oi, 1); })}>Remove</button>
                          </div>
                        </div>
                      ))}
                      <button type="button" className={ghost} onClick={() => up(x => { const used = x.decisionPoints.filter((p: any) => p.stageId === s.id).flatMap((p: any) => p.options.map((q: any) => q.id)); x.decisionPoints[di].options.push({ id: nextId("o", used), text: "", correct: false, rationale: "" }); })}>Add an option</button>
                    </div>
                  )}
                  <fieldset className="mt-2"><legend className={small}>Findings the learner may ask for here</legend>
                    {b.facts.map((f: any) => <label key={f.id} className="mr-3 inline-block text-[12.5px]"><input type="checkbox" className="mr-1" checked={d.permittedReveals.includes(f.id)} onChange={e => up(x => { x.decisionPoints[di].permittedReveals = toggle(x.decisionPoints[di].permittedReveals, f.id, e.target.checked); })} />{f.label || f.id}</label>)}
                  </fieldset>
                  <button type="button" className={`${ghost} mt-2`} onClick={() => up(x => { const id = x.decisionPoints[di].id; x.decisionPoints.splice(di, 1); x.stages[si].decisionPointIds = x.stages[si].decisionPointIds.filter((y: string) => y !== id); x.safetyCriteria = x.safetyCriteria.filter((c: any) => c.decisionPointId !== id); })}>Remove decision</button>
                </div>
              ))}
              <button type="button" className={`${ghost} mt-2`} onClick={() => up(x => { const id = nextId("d", allIds); x.decisionPoints.push({ id, stageId: s.id, kind: "single", dimension: "decision", prompt: "", permittedReveals: [], options: [{ id: "o1", text: "", correct: true, rationale: "" }, { id: "o2", text: "", correct: false, rationale: "" }] }); x.stages[si].decisionPointIds.push(id); })}>Add a decision to this stage</button>
            </div>
          ))}
          <button type="button" className={ghost} onClick={() => up(x => { const sid = nextId("s", allIds); const did = nextId("d", [...allIds, sid]); x.stages.push({ id: sid, title: `Stage ${x.stages.length + 1}`, reveals: [], decisionPointIds: [did] }); x.decisionPoints.push({ id: did, stageId: sid, kind: "single", dimension: "decision", prompt: "", permittedReveals: [], options: [{ id: "o1", text: "", correct: true, rationale: "" }, { id: "o2", text: "", correct: false, rationale: "" }] }); })}>Add a stage</button>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-prog">
        <h2 id="ed-prog" className={h2}>Progression</h2>
        <p className={small}>No transitions: the stages run in order. With transitions, a stage with none ends the case, and only a stage with one single-choice decision can branch on its answer.</p>
        <div className="mt-2 space-y-2">
          {b.progression.map((t: any, ti: number) => (
            <div key={ti} className="grid gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-4">
              <label className={lbl}>From<select className={`${input} mt-1 block w-full`} value={t.from} onChange={e => up(x => { x.progression[ti].from = e.target.value; x.progression[ti].onOptions = []; })}>{b.stages.map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
              <fieldset className="text-[12.5px]"><legend className={small}>When the answer is</legend>
                <label className="mr-2 inline-block"><input type="checkbox" className="mr-1" checked={!!t.isDefault} onChange={e => up(x => { x.progression[ti].isDefault = e.target.checked; if (e.target.checked) x.progression[ti].onOptions = []; })} />anything else</label>
                {!t.isDefault && optionsOfStage(t.from).map((o: any) => <label key={o.id} className="mr-2 inline-block"><input type="checkbox" className="mr-1" checked={(t.onOptions ?? []).includes(o.id)} onChange={e => up(x => { x.progression[ti].onOptions = toggle(x.progression[ti].onOptions ?? [], o.id, e.target.checked); })} />{o.text || o.id}</label>)}
              </fieldset>
              <label className={lbl}>Go to<select className={`${input} mt-1 block w-full`} value={t.to} onChange={e => up(x => { x.progression[ti].to = e.target.value; })}>{b.stages.map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
              <fieldset className="text-[12.5px]"><legend className={small}>Consequence findings revealed</legend>
                {b.facts.map((f: any) => <label key={f.id} className="mr-2 inline-block"><input type="checkbox" className="mr-1" checked={t.consequenceFactIds.includes(f.id)} onChange={e => up(x => { x.progression[ti].consequenceFactIds = toggle(x.progression[ti].consequenceFactIds, f.id, e.target.checked); })} />{f.label || f.id}</label>)}
                <button type="button" className={`${ghost} ml-2`} onClick={() => up(x => { x.progression.splice(ti, 1); })}>Remove</button>
              </fieldset>
            </div>
          ))}
          <button type="button" className={ghost} onClick={() => up(x => { x.progression.push({ from: x.stages[0].id, isDefault: true, onOptions: [], to: x.stages[x.stages.length - 1].id, consequenceFactIds: [] }); })}>Add a transition</button>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-lo">
        <h2 id="ed-lo" className={h2}>Learning objectives and CFCA outcomes</h2>
        <div className="mt-2 space-y-2">
          {b.learningObjectives.map((l: any, li: number) => (
            <div key={l.id} className="rounded-lg border border-gray-100 p-2">
              <label className={lbl}>Objective<input className={`${input} mt-1 block w-full`} value={l.text} onChange={e => up(x => { x.learningObjectives[li].text = e.target.value; })} /></label>
              <label className={`${lbl} mt-1`}>Measurable outcomes, one per line<textarea rows={2} className={`${input} mt-1 block w-full`} value={(l.outcomes ?? []).join("\n")} onChange={e => up(x => { x.learningObjectives[li].outcomes = lines(e.target.value); })} /></label>
              <fieldset className="mt-1 max-h-36 overflow-y-auto"><legend className={small}>CFCA competencies it serves (the original identifiers)</legend>
                {competencies.map(c => <label key={c.id} className="block text-[12.5px]"><input type="checkbox" className="mr-1" checked={l.competencyIds.includes(c.id)} onChange={e => up(x => {
                  const o = x.learningObjectives[li];
                  o.competencyIds = toggle(o.competencyIds, c.id, e.target.checked);
                  if (!e.target.checked) o.outcomeRefs = (o.outcomeRefs ?? []).filter((r: any) => r.competencyId !== c.id);
                })} />{c.label}</label>)}
              </fieldset>
              {l.competencyIds.some((id: string) => (compById.get(id)?.outcomes ?? []).some(t => t.trim())) && (
                <fieldset className="mt-1"><legend className={small}>The competencies&apos; recorded learning outcomes this objective addresses</legend>
                  {l.competencyIds.flatMap((id: string) => (compById.get(id)?.outcomes ?? []).map((t, index) => ({ id, t, index }))).filter((o: any) => o.t.trim()).map((o: any) => {
                    const on = (l.outcomeRefs ?? []).some((r: any) => r.competencyId === o.id && r.index === o.index);
                    return <label key={`${o.id}-${o.index}`} className="block text-[12.5px] pointer-coarse:py-1"><input type="checkbox" className="mr-1" checked={on} onChange={e => up(x => {
                      const lo = x.learningObjectives[li];
                      const rest = (lo.outcomeRefs ?? []).filter((r: any) => !(r.competencyId === o.id && r.index === o.index));
                      lo.outcomeRefs = e.target.checked ? [...rest, { competencyId: o.id, index: o.index }] : rest;
                    })} />{o.t}</label>;
                  })}
                </fieldset>
              )}
              <button type="button" className={`${ghost} mt-1`} onClick={() => up(x => { x.learningObjectives.splice(li, 1); })}>Remove objective</button>
            </div>
          ))}
          <button type="button" className={ghost} onClick={() => up(x => { x.learningObjectives.push({ id: nextId("lo", x.learningObjectives.map((y: any) => y.id)), text: "", competencyIds: [], outcomes: [] }); })}>Add an objective</button>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-safety">
        <h2 id="ed-safety" className={h2}>Safety criteria (machine-checked)</h2>
        <div className="mt-2 space-y-2">
          {b.safetyCriteria.map((c: any, ci: number) => {
            const dp = b.decisionPoints.find((d: any) => d.id === c.decisionPointId);
            return (
              <div key={c.id} className="grid gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-3">
                <label className={lbl}>What must not be missed<input className={`${input} mt-1 block w-full`} value={c.text} onChange={e => up(x => { x.safetyCriteria[ci].text = e.target.value; })} /></label>
                <label className={lbl}>At decision<select className={`${input} mt-1 block w-full`} value={c.decisionPointId} onChange={e => up(x => { x.safetyCriteria[ci].decisionPointId = e.target.value; x.safetyCriteria[ci].mustSelect = []; x.safetyCriteria[ci].mustNotSelect = []; })}>{b.decisionPoints.filter((d: any) => d.kind !== "free_text").map((d: any) => <option key={d.id} value={d.id}>{d.prompt || d.id}</option>)}</select></label>
                <fieldset className="text-[12.5px]"><legend className={small}>Must choose / must not choose</legend>
                  {(dp?.options ?? []).map((o: any) => (
                    <span key={o.id} className="mr-3 inline-block">{o.text || o.id}:
                      <label className="ml-1"><input type="checkbox" checked={(c.mustSelect ?? []).includes(o.id)} onChange={e => up(x => { x.safetyCriteria[ci].mustSelect = toggle(x.safetyCriteria[ci].mustSelect ?? [], o.id, e.target.checked); })} /> must</label>
                      <label className="ml-1"><input type="checkbox" checked={(c.mustNotSelect ?? []).includes(o.id)} onChange={e => up(x => { x.safetyCriteria[ci].mustNotSelect = toggle(x.safetyCriteria[ci].mustNotSelect ?? [], o.id, e.target.checked); })} /> must not</label>
                    </span>
                  ))}
                  <button type="button" className={`${ghost} ml-2`} onClick={() => up(x => { x.safetyCriteria.splice(ci, 1); })}>Remove</button>
                </fieldset>
              </div>
            );
          })}
          <button type="button" className={ghost} disabled={!b.decisionPoints.some((d: any) => d.kind !== "free_text")} onClick={() => up(x => { const dp = x.decisionPoints.find((d: any) => d.kind !== "free_text"); x.safetyCriteria.push({ id: nextId("sc", x.safetyCriteria.map((y: any) => y.id)), text: "", decisionPointId: dp.id, mustSelect: [], mustNotSelect: [] }); })}>Add a safety criterion</button>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-reasoning">
        <h2 id="ed-reasoning" className={h2}>Differentials, management and expected reasoning (optional)</h2>
        <p className={small}>Differentials appear to the learner on reaching a stage categorised Differentials (their reasoning once it is behind them); management principles once a Management stage is finished; everything at the end of the case. Expected reasoning is shown at the end only.</p>
        <div className="mt-2 space-y-2">
          {(b.differentials ?? []).map((d: any, i: number) => (
            <div key={i} className="grid gap-2 rounded-lg border border-gray-100 p-2 sm:grid-cols-5">
              <label className={lbl}>Differential<input className={`${input} mt-1 block w-full`} maxLength={REASONING_CAPS.differentialLabel} value={d.label} onChange={e => up(x => { x.differentials[i].label = e.target.value; })} /></label>
              <label className={`${lbl} sm:col-span-3`}>Reasoning (for and against)<input className={`${input} mt-1 block w-full`} maxLength={REASONING_CAPS.differentialReasoning} value={d.reasoning} onChange={e => up(x => { x.differentials[i].reasoning = e.target.value; })} /></label>
              <div className="flex items-end"><button type="button" className={ghost} onClick={() => up(x => { x.differentials.splice(i, 1); if (!x.differentials.length) delete x.differentials; })}>Remove</button></div>
            </div>
          ))}
          <button type="button" className={ghost} disabled={(b.differentials ?? []).length >= REASONING_CAPS.differentials} onClick={() => up(x => { x.differentials = [...(x.differentials ?? []), { label: "", reasoning: "" }]; })}>Add a differential</button>
          <label className={`${lbl} mt-2`}>Management principles, one per line<textarea rows={3} className={`${input} mt-1 block w-full`} value={(b.managementPrinciples ?? []).join("\n")} onChange={e => up(x => { const l = lines(e.target.value); if (l.length) x.managementPrinciples = l; else delete x.managementPrinciples; })} /></label>
          <label className={lbl}>Expected reasoning (what a strong line of reasoning covers)<textarea rows={3} className={`${input} mt-1 block w-full`} maxLength={REASONING_CAPS.expectedReasoning} value={b.expectedReasoning ?? ""} onChange={e => up(x => { if (e.target.value) x.expectedReasoning = e.target.value; else delete x.expectedReasoning; })} /></label>
        </div>
      </section>

      <section className={box} aria-labelledby="ed-feedback">
        <h2 id="ed-feedback" className={h2}>Feedback, references and variation</h2>
        <div className="mt-2 grid gap-3">
          <label className={lbl}>Debrief<textarea rows={3} className={`${input} mt-1 block w-full`} value={b.feedback?.debrief ?? ""} onChange={e => up(x => { x.feedback = { ...(x.feedback ?? { onSafetyEvent: "" }), debrief: e.target.value }; })} /></label>
          <label className={lbl}>When a safety criterion is broken<textarea rows={2} className={`${input} mt-1 block w-full`} value={b.feedback?.onSafetyEvent ?? ""} onChange={e => up(x => { x.feedback = { ...(x.feedback ?? { debrief: "" }), onSafetyEvent: e.target.value }; })} /></label>
          <label className={lbl}>References, one per line<textarea rows={3} className={`${input} mt-1 block w-full`} value={b.references.map((r: any) => r.citation).join("\n")} onChange={e => up(x => { x.references = lines(e.target.value).map(citation => ({ citation, url: null })); })} /></label>
          <div>
            <p className={small}>Variation: values a delivered case may pick for non-safety-critical findings. Inside these, a varied case is still the approved version.</p>
            {b.variation.rules.map((r: any, ri: number) => (
              <div key={ri} className="mt-1 flex flex-wrap items-end gap-2">
                <label className={lbl}>Finding<select className={`${input} mt-1`} value={r.factId} onChange={e => up(x => { x.variation.rules[ri].factId = e.target.value; })}>{b.facts.filter((f: any) => !f.safetyCritical).map((f: any) => <option key={f.id} value={f.id}>{factLabel(f.id)}</option>)}</select></label>
                <label className={lbl}>Allowed values (comma-separated)<input className={`${input} mt-1`} value={(r.values ?? []).join(", ")} onChange={e => up(x => { x.variation.rules[ri] = { factId: r.factId, values: e.target.value.split(",").map((v: string) => v.trim()).filter(Boolean) }; })} /></label>
                <button type="button" className={ghost} onClick={() => up(x => { x.variation.rules.splice(ri, 1); })}>Remove</button>
              </div>
            ))}
            <button type="button" className={`${ghost} mt-1`} disabled={!b.facts.some((f: any) => !f.safetyCritical)} onClick={() => up(x => { const f = x.facts.find((y: any) => !y.safetyCritical); x.variation.rules.push({ factId: f.id, values: [f.value] }); })}>Add a variation rule</button>
          </div>
          <fieldset className="text-[12.5px]"><legend className={small}>What AI may do around the governed facts</legend>
            <label className="mr-3"><input type="checkbox" className="mr-1" checked={b.aiBoundary.patientVoice} onChange={e => up(x => { x.aiBoundary.patientVoice = e.target.checked; })} />Voice the patient</label>
            <label className="mr-3"><input type="checkbox" className="mr-1" checked={b.aiBoundary.phraseReveals} onChange={e => up(x => { x.aiBoundary.phraseReveals = e.target.checked; })} />Phrase reveals</label>
            <label><input type="checkbox" className="mr-1" checked={b.aiBoundary.explain} onChange={e => up(x => { x.aiBoundary.explain = e.target.checked; })} />Explain after answering</label>
          </fieldset>
          {b.aiBoundary.patientVoice && (
            <fieldset className="rounded-lg border border-gray-200 p-3 text-[12.5px]"><legend className={small}>Talk to the patient: who the AI voices, and what they know (server-side only, approved with this version)</legend>
              <p className={small}>The learner can type questions and the AI answers in this person&apos;s voice, using only what is listed here and only once the learner has been shown it. It never reveals a finding they have not asked for, a later stage, or the diagnosis. A voice is needed for the panel to appear.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className={lbl}>Who speaks<select className={`${input} mt-1 block w-full`} value={b.voice?.speaker ?? "patient"} onChange={e => up(x => { x.voice = { ...(x.voice ?? blankVoice()), speaker: e.target.value }; })}><option value="patient">The patient</option><option value="caregiver">A caregiver</option></select></label>
                <label className={`${lbl} sm:col-span-2`}>How they speak<input className={`${input} mt-1 block w-full`} maxLength={400} value={b.voice?.style ?? ""} onChange={e => up(x => { x.voice = { ...(x.voice ?? blankVoice()), style: e.target.value }; })} /></label>
                <label className={`${lbl} sm:col-span-3`}>Who they are (persona)<textarea rows={2} className={`${input} mt-1 block w-full`} maxLength={600} value={b.voice?.persona ?? ""} onChange={e => up(x => { x.voice = { ...(x.voice ?? blankVoice()), persona: e.target.value }; })} /></label>
                <label className={`${lbl} sm:col-span-3`}>Reply when asked something they would not know<input className={`${input} mt-1 block w-full`} maxLength={200} value={b.voice?.notKnownReply ?? ""} onChange={e => up(x => { x.voice = { ...(x.voice ?? blankVoice()), notKnownReply: e.target.value || null }; })} /></label>
              </div>
              <fieldset className="mt-2"><legend className={small}>Findings this person can speak to (only once the learner has been shown them)</legend>
                {b.facts.map((f: any) => <label key={f.id} className="mr-3 inline-block text-[12.5px]"><input type="checkbox" className="mr-1" checked={(b.voice?.knowsFactIds ?? []).includes(f.id)} onChange={e => up(x => { x.voice = { ...(x.voice ?? blankVoice()) }; x.voice.knowsFactIds = toggle(x.voice.knowsFactIds ?? [], f.id, e.target.checked); })} />{f.label || f.id}</label>)}
              </fieldset>
              <div className="mt-2 space-y-2"><p className={small}>Other things only this person would say (how they feel, home life), known from the start or from a stage onward</p>
                {(b.voice?.knowsStatements ?? []).map((s: any, si: number) => (
                  <div key={s.id} className="grid gap-2 sm:grid-cols-6">
                    <label className={`${lbl} sm:col-span-4`}>They say<input className={`${input} mt-1 block w-full`} maxLength={300} value={s.text} onChange={e => up(x => { x.voice.knowsStatements[si].text = e.target.value; })} /></label>
                    <label className={lbl}>Known from<select className={`${input} mt-1 block w-full`} value={s.from} onChange={e => up(x => { x.voice.knowsStatements[si].from = e.target.value; })}><option value="start">The start</option>{b.stages.map((st: any) => <option key={st.id} value={st.id}>{st.title || st.id}</option>)}</select></label>
                    <div className="flex items-end"><button type="button" className={ghost} aria-label={`Remove statement ${si + 1}`} onClick={() => up(x => { x.voice.knowsStatements.splice(si, 1); })}>Remove</button></div>
                  </div>
                ))}
                <button type="button" className={ghost} onClick={() => up(x => { x.voice = { ...(x.voice ?? blankVoice()) }; x.voice.knowsStatements = [...(x.voice.knowsStatements ?? []), { id: nextId("v", (x.voice.knowsStatements ?? []).map((q: any) => q.id)), text: "", from: "start" }]; })}>Add a statement</button>
              </div>
              <div className="mt-2 space-y-2"><p className={small}>Key questions a good history asks (used to review the learner&apos;s questions after the case, by code)</p>
                {(b.voice?.keyQuestions ?? []).map((k: any, ki: number) => (
                  <div key={k.id} className="grid gap-2 sm:grid-cols-6">
                    <label className={`${lbl} sm:col-span-3`}>Question<input className={`${input} mt-1 block w-full`} maxLength={160} value={k.label} onChange={e => up(x => { x.voice.keyQuestions[ki].label = e.target.value; })} /></label>
                    <label className={`${lbl} sm:col-span-2`}>Words that show it was asked (comma-separated)<input className={`${input} mt-1 block w-full`} value={(k.terms ?? []).join(", ")} onChange={e => up(x => { x.voice.keyQuestions[ki].terms = e.target.value.split(",").map((t: string) => t.trim()).filter(Boolean); })} /></label>
                    <div className="flex items-end"><button type="button" className={ghost} aria-label={`Remove question ${ki + 1}`} onClick={() => up(x => { x.voice.keyQuestions.splice(ki, 1); })}>Remove</button></div>
                  </div>
                ))}
                <button type="button" className={ghost} onClick={() => up(x => { x.voice = { ...(x.voice ?? blankVoice()) }; x.voice.keyQuestions = [...(x.voice.keyQuestions ?? []), { id: nextId("q", (x.voice.keyQuestions ?? []).map((q: any) => q.id)), label: "", terms: [] }]; })}>Add a key question</button>
              </div>
            </fieldset>
          )}
          {/* LEARNING-CLOSE-2026-11 CE-04C: the authored deterioration timeline, approved with the version. */}
          <TimelineField value={b.timeline} input={input} small={small} ghost={ghost}
            onChange={t => up(x => { if (t) x.timeline = t; else delete x.timeline; })} />
        </div>
      </section>
    </div>
  );
}
