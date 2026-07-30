export const maxDuration = 60;

import { NextResponse } from "next/server";
import { getCaller, isResponse, requireRole, ADMIN_ROLES, EDUCATOR_ROLES } from "@/lib/api-auth";
import { aiStatus } from "@/lib/ai/config";
import { checkAiQuota } from "@/lib/ai/quota";
import { suggestLearningLinks } from "@/lib/cgr/suggest-links";
/* eslint-disable @typescript-eslint/no-explicit-any */

// CGR-027 — AI-PROPOSED learning links (migration 150 + CGR-023 §7 human-in-the-loop).
// Thin by design: this route owns authorization, quota and audit; the suggestion work — grounding, generation
// and the hallucination guard — lives in @/lib/cgr/suggest-links so the shipped logic can be exercised directly.
// The engine writes status='proposed' + proposed_by_ai only; confirmation stays a human act on PATCH (admins).

export async function POST() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const gate = requireRole(c, [...new Set([...EDUCATOR_ROLES, ...ADMIN_ROLES])]);
  if (gate) return gate;

  const quota = await checkAiQuota(c.admin, c.userId);
  if (!quota.ok) return NextResponse.json({ error: `AI rate limit reached (${quota.limit}/hour).` }, { status: 429 });
  if (!aiStatus().configured) return NextResponse.json({ error: "AI is not configured." }, { status: 503 });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const r = await suggestLearningLinks(c.admin, { userId: c.userId, hospitalId: c.hospitalId, createdByName: me?.full_name ?? null });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: /not configured/i.test(r.error ?? "") ? 503 : 500 });

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "learning_links_ai_suggested",
    entity_type: "learning_link", entity_id: null, entity_name: `${r.proposed} proposed`,
    hospital_id: c.hospitalId,
    new_value: { analysed: r.analysed, returned: r.returned, proposed: r.proposed, rejected: r.rejected, skipped: r.skipped, model: r.model },
  }).then((x: any) => x, () => {});

  return NextResponse.json({
    ok: true, analysed: r.analysed, returned: r.returned, proposed: r.proposed, rejected: r.rejected,
    skipped: r.skipped, model: r.model, note: r.note, suggestions: r.suggestions,
  });
}
