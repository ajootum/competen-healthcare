import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { generate } from "@/lib/ai/client";
import { OBJECT_SCHEMAS, schemaFor, validateDefinition } from "@/lib/config/schema";

// AI Configuration Copilot (NCP-014) — converts natural language into ONE governed configuration artifact mapped
// to the registry schema, then schema-validates it. It NEVER writes to production: it returns a proposal the user
// reviews and authors through the normal Studio path (create + define → governance + dependency gate + versioning).
// Uses the shared grounded generate() wrapper (Anthropic SDK). Super-admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const KEYRE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

// Compact contract the model must honour — derived from the canonical schema so the two never drift.
function schemaHint(): string {
  return OBJECT_SCHEMAS.map(s => {
    const fields = s.definition.map(f => `${f.key}${f.required ? "*" : ""}:${f.type}${f.enum ? `(${f.enum.join("|")})` : ""}`).join(", ");
    return `- ${s.type}: { ${fields} }`;
  }).join("\n");
}

function extractJson(text: string): any | null {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } }
  return null;
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("The Configuration Copilot is platform super-admin only");
  const userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const prompt = String(b.prompt ?? "").trim();
  if (!prompt) return badRequest("Describe what you want to configure");
  if (prompt.length > 2000) return badRequest("Prompt too long (2000 char max)");

  const system = [
    "You are the Competen Configuration Copilot for a metadata-driven, no-code healthcare configuration platform.",
    "Convert the user's request into EXACTLY ONE governed configuration object mapped to the registry.",
    "Respond with STRICT JSON only — no markdown, no commentary — of the form:",
    '{ "object_type": <TYPE>, "object_key": <key>, "display_name": <string>, "description": <string>, "definition": <object>, "rationale": <one sentence> }',
    "",
    `object_type must be one of: ${OBJECT_SCHEMAS.map(s => s.type).join(", ")}.`,
    "object_key must match /^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$/ and be descriptive and namespaced (e.g. workspace.ward.falls_rate).",
    "definition MUST conform to the contract for the chosen type (fields marked * are required; values in (parentheses) are the only allowed enum values):",
    schemaHint(),
    "",
    "Pick the single most appropriate object_type. Keep definitions minimal but valid and realistic for a UK healthcare setting. Never invent fields outside the contract.",
  ].join("\n");

  const res = await generate({ system, user: prompt, tier: "heavy", maxTokens: 1500, context: { userId, operation: "config_copilot" } });
  if (!res.ok) {
    if (res.error === "not_configured") return NextResponse.json({ error: "AI is not configured on this environment (no ANTHROPIC_API_KEY). The Copilot needs a model provider." }, { status: 503 });
    return NextResponse.json({ error: res.error === "refusal" ? "The model declined this request." : `Generation failed: ${res.detail ?? "unknown"}` }, { status: 502 });
  }

  const parsed = extractJson(res.text);
  if (!parsed || typeof parsed !== "object") return NextResponse.json({ error: "The model did not return valid JSON.", raw: res.text.slice(0, 800) }, { status: 422 });

  const object_type = String(parsed.object_type ?? "").toUpperCase();
  const object_key = String(parsed.object_key ?? "").trim().toLowerCase();
  const display_name = String(parsed.display_name ?? "").trim();
  const definition = parsed.definition ?? {};
  const problems: string[] = [];
  if (!schemaFor(object_type)) problems.push(`Unknown object_type "${object_type}"`);
  if (!KEYRE.test(object_key)) problems.push("object_key is not a valid lowercase dotted key");
  if (!display_name) problems.push("missing display_name");
  const issues = schemaFor(object_type) ? validateDefinition(object_type, definition) : [];
  const errorCount = issues.filter(i => i.severity === "error").length;

  return NextResponse.json({
    ok: problems.length === 0 && errorCount === 0,
    artifact: { object_type, object_key, display_name, description: String(parsed.description ?? "").trim(), definition },
    rationale: String(parsed.rationale ?? "").trim(),
    problems, issues, valid: problems.length === 0 && errorCount === 0,
    model: res.model, usage: res.usage,
  });
}
