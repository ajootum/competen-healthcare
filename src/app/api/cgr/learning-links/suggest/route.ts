export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getCaller, isResponse, requireRole, ADMIN_ROLES, EDUCATOR_ROLES } from "@/lib/api-auth";
import { generate } from "@/lib/ai/client";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
/* eslint-disable @typescript-eslint/no-explicit-any */

// CGR-027 — AI-PROPOSED learning links (migration 150 + CGR-023 §7 human-in-the-loop).
// The AI reads real unlinked quality signals and the real competency library and proposes which signal maps to
// which competency, with a rationale. It writes ONLY status='proposed' + proposed_by_ai=true — confirmation
// stays a human governance act on the PATCH route (ADMIN_ROLES). This route can never confirm or implement.
//
// HALLUCINATION GUARD (the load-bearing part): the model is given ids and asked to return ids, but every
// returned incident_id and competency_id is validated against the real sets before insert. Anything invented is
// DROPPED and COUNTED, never written — and the count is returned so the caller sees the model's miss rate
// rather than a silently-filtered success.

const LINK_TYPES = new Set(["triggered_review", "caused_change", "informed_evidence", "no_action_required"]);
const MAX_SIGNALS = 25;
const MAX_COMPS = 150;

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const gate = requireRole(c, [...new Set([...EDUCATOR_ROLES, ...ADMIN_ROLES])]);
  if (gate) return gate;

  const quota = await checkAiQuota(c.admin, c.userId);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  // Real grounding: unlinked signals + the real competency library.
  const [incRes, linkRes, compRes] = await Promise.all([
    c.admin.from("op_incidents").select("id, incident_type, severity, description, created_at").order("created_at", { ascending: false }).limit(300),
    c.admin.from("competency_learning_links").select("source_id").limit(2000),
    c.admin.from("framework_competencies").select("id, name, code").order("name").limit(MAX_COMPS),
  ]);
  if (linkRes.error) return NextResponse.json({ error: "Linkage table not found — apply migration 150." }, { status: 503 });

  const linked = new Set((linkRes.data ?? []).map((l: any) => l.source_id).filter(Boolean));
  const signals = ((incRes.error ? [] : incRes.data ?? []) as any[]).filter((i) => !linked.has(i.id)).slice(0, MAX_SIGNALS);
  const comps = (compRes.error ? [] : compRes.data ?? []) as any[];

  if (!signals.length) return NextResponse.json({ ok: true, proposed: 0, rejected: 0, skipped: 0, note: "No unlinked signals to analyse." });
  if (!comps.length) return NextResponse.json({ ok: true, proposed: 0, rejected: 0, skipped: 0, note: "No competencies in the library to map to." });

  const signalIds = new Set(signals.map((s) => s.id));
  const compById = new Map(comps.map((x) => [x.id, x.code ? `${x.name} (${x.code})` : x.name]));

  const system = [
    "You map healthcare quality signals to the clinical competency whose gap they most likely indicate, for a competency-governance platform.",
    "You are PROPOSING for human review, never deciding. A governance lead confirms or rejects every suggestion.",
    "Rules you must follow exactly:",
    "1. Use ONLY the incident ids and competency ids given to you. Never invent an id. Never map to a competency that is not listed.",
    "2. Propose a link only where the connection is clinically defensible. It is correct and expected to return fewer links than signals — omit anything speculative.",
    "3. Every link needs a specific rationale citing what in the signal points to that competency. Generic rationales are not acceptable.",
    "4. link_type must be one of: triggered_review, caused_change, informed_evidence, no_action_required.",
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

  const result = await generate({ system, user, tier: "reasoning", maxTokens: 2000, context: { userId: c.userId, tenantId: c.hospitalId, operation: "learning_link_suggest_cgr" } });
  if (!result.ok) return NextResponse.json({ error: result.error === "not_configured" ? "AI is not configured." : result.error === "refusal" ? "The model declined that request." : `Error: ${result.detail ?? "failed"}` }, { status: result.error === "not_configured" ? 503 : 500 });

  // Defensive parse — tolerate fences or stray prose around the array.
  let parsed: any[] = [];
  try {
    const raw = result.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = raw.indexOf("["), end = raw.lastIndexOf("]");
    parsed = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : [];
  } catch { parsed = []; }
  if (!Array.isArray(parsed)) parsed = [];

  // ── Hallucination guard: validate every id against reality before anything is written. ──
  let rejected = 0;
  const valid = parsed.filter((p) => {
    const okIds = p && typeof p === "object" && signalIds.has(p.incident_id) && compById.has(p.competency_id);
    const okBody = typeof p?.rationale === "string" && p.rationale.trim().length >= 10 && (!p.link_type || LINK_TYPES.has(p.link_type));
    if (!okIds || !okBody) { rejected++; return false; }
    return true;
  });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const sigById = new Map(signals.map((s) => [s.id, s]));

  let proposed = 0, skipped = 0;
  const inserted: any[] = [];
  for (const p of valid) {
    const s = sigById.get(p.incident_id);
    const conf = typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : null;
    const row = {
      hospital_id: c.hospitalId,
      source_type: "incident",
      source_id: p.incident_id,
      source_ref: `${(s?.incident_type ?? "event").replace(/_/g, " ")}${s?.description ? ` — ${String(s.description).slice(0, 60)}` : ""}`,
      signal_date: s?.created_at ? String(s.created_at).slice(0, 10) : null,
      target_type: "competency",
      target_id: p.competency_id,
      target_name: compById.get(p.competency_id) ?? null,
      link_type: p.link_type && LINK_TYPES.has(p.link_type) ? p.link_type : "triggered_review",
      rationale: `${String(p.rationale).trim()}${conf != null ? ` [AI confidence ${Math.round(conf * 100)}%]` : ""}`,
      status: "proposed",          // hard-coded: this route can never confirm or implement
      proposed_by_ai: true,
      created_by: c.userId,
      created_by_name: me?.full_name ?? null,
    };
    const { data, error } = await c.admin.from("competency_learning_links").insert(row).select("id").single();
    if (error) { if (/duplicate key/i.test(error.message)) skipped++; else rejected++; continue; }
    proposed++;
    inserted.push({ id: data.id, signal: row.source_ref, competency: row.target_name, linkType: row.link_type });
  }

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "learning_links_ai_suggested",
    entity_type: "learning_link", entity_id: null, entity_name: `${proposed} proposed`,
    hospital_id: c.hospitalId,
    new_value: { analysed: signals.length, returned: parsed.length, proposed, rejected, skipped, model: result.model },
  }).then((r: any) => r, () => {});

  return NextResponse.json({
    ok: true, analysed: signals.length, returned: parsed.length, proposed, rejected, skipped,
    model: result.model, suggestions: inserted,
  });
}
