/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-027 — AI learning-link suggestion engine (migration 150 + CGR-023 §7).
// Extracted from the route so the exact code that ships can be exercised directly by a harness — testing a
// replica would prove nothing about what actually runs. The route owns auth/quota/audit; this owns the work.
//
// Contract: reads real unlinked signals + the real competency library, asks the governed gateway for mappings,
// then VALIDATES every returned id against reality before writing. Writes status='proposed' + proposed_by_ai
// only — it structurally cannot confirm or implement (that stays a human governance act on PATCH).

import { generate } from "@/lib/ai/client";

const LINK_TYPES = new Set(["triggered_review", "caused_change", "informed_evidence", "no_action_required"]);
const MAX_SIGNALS = 25;
const MAX_COMPS = 150;

export type SuggestOutcome = {
  ok: boolean;
  error?: string;
  note?: string;
  analysed: number;
  returned: number;
  proposed: number;
  rejected: number;
  skipped: number;
  model?: string;
  rejectReasons: string[];
  suggestions: { id: string; signal: string; competency: string | null; linkType: string }[];
  // Diagnostics: without these, "the model returned []" and "the parse failed" are indistinguishable — both
  // surface as zero proposals, and a silent parse failure would masquerade as a well-behaved model.
  parseStatus: "empty_array" | "parsed" | "recovered_truncated" | "no_array_found" | "json_error";
  rawLength: number;
  rawPreview: string;
};

// The hallucination guard, exported so it can be negative-tested directly. Returns the reasons a suggestion is
// unsafe to write; an empty array means it passed. Nothing reaches the database without clearing this.
export function validateSuggestion(p: any, signalIds: Set<string>, compIds: Set<string>): string[] {
  if (!p || typeof p !== "object") return ["not an object"];
  const reasons: string[] = [];
  if (!signalIds.has(p.incident_id)) reasons.push(`unknown incident_id ${String(p.incident_id).slice(0, 8)}…`);
  if (!compIds.has(p.competency_id)) reasons.push(`unknown competency_id ${String(p.competency_id).slice(0, 8)}…`);
  if (typeof p.rationale !== "string" || p.rationale.trim().length < 10) reasons.push("rationale too thin");
  if (p.link_type && !LINK_TYPES.has(p.link_type)) reasons.push(`bad link_type ${p.link_type}`);
  return reasons;
}

const empty = (patch: Partial<SuggestOutcome>): SuggestOutcome =>
  ({ ok: true, analysed: 0, returned: 0, proposed: 0, rejected: 0, skipped: 0, rejectReasons: [], suggestions: [], parseStatus: "empty_array", rawLength: 0, rawPreview: "", ...patch });

export async function suggestLearningLinks(
  admin: any,
  opts: { userId?: string | null; hospitalId?: string | null; createdByName?: string | null; dryRun?: boolean } = {},
): Promise<SuggestOutcome> {
  const [incRes, linkRes, compRes] = await Promise.all([
    admin.from("op_incidents").select("id, incident_type, severity, description, created_at").order("created_at", { ascending: false }).limit(300),
    admin.from("competency_learning_links").select("source_id").limit(2000),
    admin.from("framework_competencies").select("id, name, code").order("name").limit(MAX_COMPS),
  ]);
  if (linkRes.error) return empty({ ok: false, error: "Linkage table not found — apply migration 150." });

  const linked = new Set((linkRes.data ?? []).map((l: any) => l.source_id).filter(Boolean));
  const signals = ((incRes.error ? [] : incRes.data ?? []) as any[]).filter((i) => !linked.has(i.id)).slice(0, MAX_SIGNALS);
  const comps = (compRes.error ? [] : compRes.data ?? []) as any[];

  if (!signals.length) return empty({ note: "No unlinked signals to analyse." });
  if (!comps.length) return empty({ note: "No competencies in the library to map to.", analysed: signals.length });

  const signalIds = new Set(signals.map((s) => s.id));
  const compById = new Map<string, string>(comps.map((x) => [x.id, x.code ? `${x.name} (${x.code})` : x.name]));

  const system = [
    "You map healthcare quality signals to the clinical competency whose gap they most likely indicate, for a competency-governance platform.",
    "You are PROPOSING for human review, never deciding. A governance lead confirms or rejects every suggestion.",
    "Rules you must follow exactly:",
    "1. Use ONLY the incident ids and competency ids given to you. Never invent an id. Never map to a competency that is not listed.",
    "2. Propose a link only where the connection is clinically defensible. It is correct and expected to return fewer links than signals — omit anything speculative.",
    "3. Every link needs a specific rationale citing what in the signal points to that competency. Keep each rationale under 200 characters — one or two sentences.",
    "4. link_type must be one of: triggered_review, caused_change, informed_evidence, no_action_required.",
    "5. Return at most 12 links. Prefer the highest-confidence mappings.",
    "Return ONLY a JSON array, no prose, no markdown fences:",
    '[{"incident_id":"<uuid>","competency_id":"<uuid>","link_type":"triggered_review","rationale":"...","confidence":0.0-1.0}]',
  ].join("\n");

  const user = [
    "UNLINKED QUALITY SIGNALS:",
    ...signals.map((s) => `- id=${s.id} | type=${s.incident_type ?? "other"} | severity=${s.severity ?? "—"} | date=${String(s.created_at ?? "").slice(0, 10)} | ${String(s.description ?? "").slice(0, 180)}`),
    "",
    "COMPETENCY LIBRARY (map only to these):",
    ...comps.map((x) => `- id=${x.id} | ${compById.get(x.id)}`),
  ].join("\n");

  // 4000: the first live run produced 6090 chars and was cut off at 2000 tokens. The salvage path handles a cut
  // response, but headroom keeps truncation exceptional rather than routine.
  const result = await generate({ system, user, tier: "reasoning", maxTokens: 4000, context: { userId: opts.userId ?? null, tenantId: opts.hospitalId ?? null, operation: "learning_link_suggest_cgr" } });
  if (!result.ok) {
    return empty({ ok: false, analysed: signals.length, error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The model declined that request." : `Error: ${result.detail ?? "failed"}` });
  }

  let parsed: any[] = [];
  let parseStatus: SuggestOutcome["parseStatus"] = "empty_array";
  const raw = result.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  if (start < 0) {
    parseStatus = "no_array_found";           // model answered in prose — a real failure mode, not an empty result
  } else {
    let strict: any[] | null = null;
    if (end > start) {
      try { const j = JSON.parse(raw.slice(start, end + 1)); if (Array.isArray(j)) strict = j; } catch { /* fall through to salvage */ }
    }
    if (strict) {
      parsed = strict;
      parseStatus = parsed.length ? "parsed" : "empty_array";
    } else {
      // SALVAGE. A response cut off by max_tokens has no closing bracket, and a strict parse of the whole array
      // fails — but every COMPLETE object before the cut is still valid, reviewable work. Discarding all of it
      // (the original bug) reads to a reviewer as "the AI found nothing", which is the opposite of the truth.
      // Walk the array body, take balanced top-level {...} blocks, drop only the incomplete tail.
      const objs: any[] = [];
      let depth = 0, objStart = -1, inStr = false, esc = false;
      for (let i = start + 1; i < raw.length; i++) {
        const ch = raw[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") { if (depth === 0) objStart = i; depth++; }
        else if (ch === "}") {
          depth--;
          if (depth === 0 && objStart >= 0) {
            try { objs.push(JSON.parse(raw.slice(objStart, i + 1))); } catch { /* skip malformed element */ }
            objStart = -1;
          }
        }
      }
      parsed = objs;
      parseStatus = objs.length ? "recovered_truncated" : (end > start ? "json_error" : "no_array_found");
    }
  }
  const diag = { parseStatus, rawLength: raw.length, rawPreview: raw.slice(0, 400) };

  // ── Hallucination guard: nothing is written until its ids are proven real. Reasons are captured so a run
  // that discards everything is diagnosable, not just a number. ──
  let rejected = 0;
  const rejectReasons: string[] = [];
  const compIds = new Set(compById.keys());
  const valid = parsed.filter((p) => {
    const reasons = validateSuggestion(p, signalIds, compIds);
    if (reasons.length) { rejected++; if (rejectReasons.length < 10) rejectReasons.push(reasons.join("; ")); return false; }
    return true;
  });

  const sigById = new Map(signals.map((s) => [s.id, s]));
  let proposed = 0, skipped = 0;
  const suggestions: SuggestOutcome["suggestions"] = [];

  for (const p of valid) {
    const s: any = sigById.get(p.incident_id);
    const conf = typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : null;
    const row = {
      hospital_id: opts.hospitalId ?? null,
      source_type: "incident",
      source_id: p.incident_id,
      source_ref: `${(s?.incident_type ?? "event").replace(/_/g, " ")}${s?.description ? ` — ${String(s.description).slice(0, 60)}` : ""}`,
      signal_date: s?.created_at ? String(s.created_at).slice(0, 10) : null,
      target_type: "competency",
      target_id: p.competency_id,
      target_name: compById.get(p.competency_id) ?? null,
      link_type: p.link_type && LINK_TYPES.has(p.link_type) ? p.link_type : "triggered_review",
      rationale: `${String(p.rationale).trim()}${conf != null ? ` [AI confidence ${Math.round(conf * 100)}%]` : ""}`,
      status: "proposed",          // hard-coded: never confirms or implements
      proposed_by_ai: true,
      created_by: opts.userId ?? null,
      created_by_name: opts.createdByName ?? null,
    };

    if (opts.dryRun) { proposed++; suggestions.push({ id: "(dry-run)", signal: row.source_ref, competency: row.target_name, linkType: row.link_type }); continue; }

    const { data, error } = await admin.from("competency_learning_links").insert(row).select("id").single();
    if (error) {
      if (/duplicate key/i.test(error.message)) skipped++;
      else { rejected++; if (rejectReasons.length < 10) rejectReasons.push(`insert failed: ${error.message}`); }
      continue;
    }
    proposed++;
    suggestions.push({ id: data.id, signal: row.source_ref, competency: row.target_name, linkType: row.link_type });
  }

  return { ok: true, analysed: signals.length, returned: parsed.length, proposed, rejected, skipped, model: result.model, rejectReasons, suggestions, ...diag };
}
